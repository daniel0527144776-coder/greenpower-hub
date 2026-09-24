// A deep sweep for the ONE bug shape this project keeps producing:
// two places that answer the same question and disagree.
//
//   node test/deep-scan.mjs
//
// Every real defect found here in the last month had that shape, and in every case each side
// looked correct on its own, so nothing failed:
//
//   packCost written four times          -> audits approved prices set by a different model
//   Math.round(V / 3.7) in four files    -> 72V packs costed a cell short per string
//   totalSpent on the card vs the list   -> ₪14,600 on one screen and ₪0 on the other
//   stock on a repair vs on a sale       -> a sold pack ate 120 cells and the books said nothing
//
// So this does not test features. It seeds ONE set of records and then asks the same question
// through every path the hub offers, and reports any pair that disagrees.
//
// It is deliberately slow and deliberately noisy: it prints what it compared even when it
// agrees, because a sweep that only speaks when it fails is one nobody trusts.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const findings = [];
const notes = [];
function agree(question, a, b, labelA, labelB) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) notes.push(`  ✓ ${question}  (${labelA} = ${labelB} = ${JSON.stringify(a)})`);
  else findings.push({ question, [labelA]: a, [labelB]: b });
  return same;
}

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4371, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4371/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

// ---------------------------------------------------------------- one set of records
const seeded = await page.evaluate(() => {
  const iso = (d) => new Date(d).toISOString();
  const M = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  const day = (n) => iso(new Date(new Date().getFullYear(), new Date().getMonth(), n, 12, 0));

  Store.set('customers', [
    { name: 'דוד לוי', phone: '0501111111', totalSpent: 0, visitCount: 0, firstVisit: day(1), lastVisit: day(9) },
    { name: 'שרה כהן', phone: '0502222222', totalSpent: 0, visitCount: 0, firstVisit: day(2), lastVisit: day(8) },
  ]);
  // Two repairs and one sale, all in the same month, all for customers who exist.
  Store.set('jobs', [
    { id: 'jA', customerName: 'דוד לוי', customerPhone: '0501111111', date: day(3),
      price: 1200, cost: 700, profit: 500, jobs: ['full'], voltage: 48, capacity: 20, cellType: 'EVE 50E' },
    { id: 'jB', customerName: 'שרה כהן', customerPhone: '0502222222', date: day(5),
      price: 450, cost: 150, profit: 300, jobs: ['bms'], voltage: 48, capacity: 20 },
  ]);
  Store.set('orders', [
    { id: 'oA', customer: 'דוד לוי', phone: '0501111111', date: day(7), status: 'נמסר',
      items: [{ name: '48V 20Ah', cat: 'סוללות אופניים - 48V CLASSIC', qty: 1, price: 1400 }], total: 1400 },
    { id: 'oQ', customer: 'שרה כהן', phone: '0502222222', date: day(8), status: 'הצעה',
      items: [{ name: '48V 20Ah', cat: 'סוללות אופניים - 48V CLASSIC', qty: 1, price: 1400 }], total: 1400 },
  ]);
  Store.set('incomes', []);
  Store.set('expenses', []);
  Store.set('worktime', []);
  return { month: M, repairs: 1200 + 450, soldDelivered: 1400, quoteNotIncome: 1400 };
});

// ---------------------------------------------------------------- 1. money, four ways
const money = await page.evaluate((M) => {
  const jobs = Store.get('jobs') || [], orders = Store.get('orders') || [];
  const inMonth = (d) => String(d).slice(0, 7) === M;
  return {
    // the raw records, added up here
    rawRepairs: jobs.filter((j) => inMonth(j.date)).reduce((s, j) => s + (+j.price || 0), 0),
    rawSales: orders.filter((o) => inMonth(o.date) && saleIsIncome(o)).reduce((s, o) => s + (+o.total || 0), 0),
    // what the hub's own definition says is income
    saleIsIncomeDelivered: saleIsIncome(orders.find((o) => o.id === 'oA')),
    saleIsIncomeQuote: saleIsIncome(orders.find((o) => o.id === 'oQ')),
    // what the customer ledger attributes
    ledgerDavid: (typeof customerLedger === 'function')
      ? customerLedger({ name: 'דוד לוי', phone: '0501111111' }) : null,
    ledgerSara: (typeof customerLedger === 'function')
      ? customerLedger({ name: 'שרה כהן', phone: '0502222222' }) : null,
  };
}, seeded.month);

agree('חבילה שנמסרה נחשבת הכנסה', money.saleIsIncomeDelivered, true, 'הלוח', 'הצפוי');
agree('הצעת מחיר שלא שולמה אינה הכנסה', money.saleIsIncomeQuote, false, 'הלוח', 'הצפוי');
agree('סך התיקונים החודש', money.rawRepairs, seeded.repairs, 'מהרשומות', 'הצפוי');
agree('סך המכירות שנמסרו החודש', money.rawSales, seeded.soldDelivered, 'מהרשומות', 'הצפוי');

// The one that matters: does the money attributed to a customer equal what he actually paid?
const davidPaid = 1200 + 1400;   // one repair + one delivered sale
const saraPaid = 450;            // one repair; her quote is not money
if (money.ledgerDavid != null) {
  const v = typeof money.ledgerDavid === 'object' ? (money.ledgerDavid.total ?? money.ledgerDavid.spent) : money.ledgerDavid;
  agree('כמה דוד לוי שילם בפועל', v, davidPaid, 'כרטיס הלקוח', 'הרשומות');
}
if (money.ledgerSara != null) {
  const v = typeof money.ledgerSara === 'object' ? (money.ledgerSara.total ?? money.ledgerSara.spent) : money.ledgerSara;
  agree('כמה שרה כהן שילמה בפועל', v, saraPaid, 'כרטיס הלקוח', 'הרשומות');
}

// ---------------------------------------------------------------- 2. stock, two ways
const stock = await page.evaluate(() => {
  const seed = () => Store.set('inventory', [
    { name: 'EVE 50E', qty: 1000 }, { name: 'BMS 13S 60A', qty: 10 }, { name: 'BMS 20S 100A', qty: 10 },
  ]);
  const snap = () => Object.fromEntries(getInventory().map((r) => [r.name, r.qty]));
  const out = {};
  for (const [V, Ah] of [[48, 20], [60, 30], [72, 40]]) {
    seed();
    inventoryDeduct('EVE 50E', seriesForV(V) * Math.ceil(Ah / 5), 'בנייה');
    inventoryTake('BMS ' + seriesForV(V) + 'S ' + (V >= 72 ? 100 : 60) + 'A', 1, 'בנייה');
    const byRepair = snap();
    seed();
    const row = PRICING.find((x) => x.name === V + 'V ' + Ah + 'Ah' && /אופניים.*CLASSIC/.test(x.cat));
    takeOrderStock({ id: 'x', customer: 'ל', status: 'נמסר',
      items: [{ name: row.name, cat: row.cat, qty: 1, price: row.retail }] });
    out[V + 'V ' + Ah + 'Ah'] = { byRepair, bySale: snap() };
  }
  return out;
});
for (const [k, v] of Object.entries(stock)) {
  agree(`מלאי אחרי ${k}`, v.bySale, v.byRepair, 'מכירה', 'תיקון');
}

// ---------------------------------------------------------------- 3. cost, two ways
const cost = await page.evaluate(() => {
  const out = [];
  for (const it of PRICING) {
    if (!/סוללות/.test(it.cat)) continue;
    const a = estimateBatteryCost(it, false);
    const p = batteryCostParts(it, false);
    if (a == null || p == null) continue;
    if (Math.round(p.total) !== a) out.push({ row: it.cat + ' / ' + it.name, estimate: a, breakdown: Math.round(p.total) });
    if (out.length > 5) break;
  }
  return out;
});
agree('העלות שמוצגת מול פירוט העלות, על כל שורות הסוללות', cost, [], 'הפרשים', 'הצפוי');

// ---------------------------------------------------------------- 4. anything that returns nothing
const holes = await page.evaluate(() => {
  const bad = [];
  for (const it of PRICING) {
    if (!/סוללות/.test(it.cat)) continue;
    // productCost, not estimateBatteryCost: the question is what the catalogue SHOWS. The four
    // hand-kept RC/drill packs have no cell recipe and are costed off their price range.
    const c = productCost(it, false);
    if (c == null || !isFinite(c) || c <= 0) bad.push({ row: it.cat + ' / ' + it.name, cost: c });
  }
  return bad.slice(0, 8);
});
agree('לכל סוללה בקטלוג יש עלות', holes, [], 'שורות בלי עלות', 'הצפוי');

// ---------------------------------------------------------------- report
console.log('\n' + '='.repeat(70));
console.log('סריקה עמוקה — מחפשת שני מקומות שעונים אותה שאלה אחרת');
console.log('='.repeat(70));
notes.forEach((n) => console.log(n));
if (errs.length) findings.push({ question: 'שגיאות בדף', errors: errs });
console.log('\n' + '-'.repeat(70));
if (!findings.length) {
  console.log('נמצאו 0 סתירות.');
} else {
  console.log(`נמצאו ${findings.length} סתירות:\n`);
  findings.forEach((f, i) => console.log(`${i + 1}. ${f.question}\n   ${JSON.stringify(f, null, 1).replace(/\n/g, '\n   ')}\n`));
}
await browser.close(); srv.close();
process.exit(findings.length ? 1 : 0);
