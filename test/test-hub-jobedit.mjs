// Drives the real hub page in Chromium and exercises edit/delete on a saved repair and a
// saved sale. Exits non-zero on any failure. --selftest breaks one expectation on purpose
// to prove the checks can go red.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// playwright is a dependency of the React site, not of this folder, and there is no
// reason to install a second copy. `import` cannot take a Windows drive path
// (ERR_UNSUPPORTED_ESM_URL_SCHEME) — createRequire can, and playwright's entry is CJS.
// CI installs playwright; locally nothing is installed for the hub, so fall back to the
// copy the retail site already carries rather than duplicating a browser download.
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const HUB = process.argv.includes('--source')
  ? 'F:\\מחול\\Green Power\\כלים-קלוד\\אתר מעבדה\\‏‏תיקיה חדשה\\לוח בקרה מרכזי.html'
  : path.join(DIST, 'index.html');
const SELFTEST = process.argv.includes('--selftest');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = url === '/' ? HUB : path.join(DIST, decodeURIComponent(url));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(4199, r));

let fails = 0;
const check = (label, ok, got) => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); fails++; } };

const JOB = {
  id: 'j1', date: '2026-08-01T09:00:00.000Z', dateDisplay: '1.8.2026, 12:00',
  customerName: 'דני', customerPhone: '050-1111111', customerNotes: 'לא טוען',
  isBusiness: false, businessName: '', vehicle: 'bike', voltage: '48', capacity: '20',
  cellType: '', jobs: ['bms'], price: 500, cost: 200, profit: 300, hours: 1,
  bmsBrand: 'daly', bmsAmps: '60', photoBefore: null, photoAfter: null,
  warrantyMonths: 6, warrantyEnd: '2027-01-28T09:00:00.000Z',
};
const QUICK = { id: 'j2', date: '2026-08-05T09:00:00.000Z', dateDisplay: '5.8.2026', customerName: 'רון', customerPhone: '050-2222222', customerNotes: 'החלפת BMS', jobs: [], quickRepair: 'החלפת BMS', price: 300, cost: 0, profit: 300, voltage: '', capacity: '', vehicle: '', warrantyMonths: 6, warrantyEnd: '2027-02-01T09:00:00.000Z' };
const CUSTOMERS = [
  { id: 'c1', name: 'דני', phone: '050-1111111', totalSpent: 500, visitCount: 1, firstVisit: JOB.date, lastVisit: JOB.date },
  { id: 'c2', name: 'רון', phone: '050-2222222', totalSpent: 300, visitCount: 1, firstVisit: QUICK.date, lastVisit: QUICK.date },
];
// An item whose catalog row no longer exists — the case that used to vanish on edit.
const ORDER = { id: 'o1', date: '2026-08-02T09:00:00.000Z', customer: 'שרה', phone: '050-3333333', bms: '', isBusiness: false, status: 'שולם', total: 300, items: [{ name: 'דגם שנמחק מהקטלוג', cat: 'קטגוריה שנעלמה', qty: 2, unit: 150 }] };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('dialog', d => d.accept());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(([j, q, c, o]) => {
  localStorage.setItem('gp_jobs', j); localStorage.setItem('gp_customers', c); localStorage.setItem('gp_orders', o);
  void q;
}, [JSON.stringify([JOB, QUICK]), '', JSON.stringify(CUSTOMERS), JSON.stringify([ORDER])]);
await page.goto('http://127.0.0.1:4199/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openJobEditor === 'function');

console.log('\n1. the sales list offers edit + delete on a repair');
const rowHtml = await page.evaluate(() => { renderOrders(); return document.getElementById('ordersList').innerHTML; });
check('repair row has an edit button', rowHtml.includes("openJobEditor('j1'"));
check('repair row has a delete button', rowHtml.includes("deleteJob('j1'"));
check('sale row still has its own', rowHtml.includes("openOrderEditor('o1'") && rowHtml.includes("deleteOrder('o1'"));

console.log('\n2. editing a repair: price, date, warranty, job types');
const edit = await page.evaluate(() => {
  openJobEditor('j1', 'orders');
  document.getElementById('jePrice').value = '650';
  document.getElementById('jeCost').value = '250';
  document.getElementById('jeDate').value = '2026-07-15';
  document.getElementById('jeWarranty').value = '12';
  document.getElementById('jeReason').value = 'לא מחזיק טעינה';
  document.querySelector('[data-jek="rows"]').classList.add('checked');
  saveJobEdit('j1');
  const j = JSON.parse(localStorage.getItem('gp_jobs')).find(x => x.id === 'j1');
  const c = JSON.parse(localStorage.getItem('gp_customers')).find(x => x.phone === '050-1111111');
  return { j, c };
});
check('price saved', edit.j.price === 650, edit.j.price);
check('profit recomputed from price - cost', edit.j.profit === 400, edit.j.profit);
check('date moved to July', edit.j.date.slice(0, 7) === '2026-07', edit.j.date);
check('dateDisplay follows the date', /15/.test(edit.j.dateDisplay), edit.j.dateDisplay);
check('warranty end re-derived from the new date', edit.j.warrantyEnd.slice(0, 7) === '2027-07', edit.j.warrantyEnd);
check('job types kept + added', edit.j.jobs.includes('bms') && edit.j.jobs.includes('rows'), edit.j.jobs);
check('reason saved', edit.j.reason === 'לא מחזיק טעינה', edit.j.reason);
check('customer total follows the price delta (500 -> 650)', edit.c.totalSpent === 650, edit.c.totalSpent);
check('visit count unchanged', edit.c.visitCount === 1, edit.c.visitCount);

console.log('\n3. moving a repair to a different customer');
const moved = await page.evaluate(() => {
  openJobEditor('j1', 'orders');
  document.getElementById('jePhone').value = '050-9999999';
  document.getElementById('jeName').value = 'משה';
  saveJobEdit('j1');
  const cs = JSON.parse(localStorage.getItem('gp_customers'));
  return { old: cs.find(x => x.phone === '050-1111111'), neu: cs.find(x => x.phone === '050-9999999') };
});
check('old customer loses the money', moved.old.totalSpent === 0, moved.old.totalSpent);
check('old customer loses the visit', moved.old.visitCount === 0, moved.old.visitCount);
check('new customer record created with it', moved.neu && moved.neu.totalSpent === 650 && moved.neu.visitCount === 1, moved.neu);

console.log('\n4. a quick-pricer repair (no voltage, no vehicle) edits too');
const quick = await page.evaluate(() => {
  openJobEditor('j2', 'orders');
  const hasQuickField = !!document.getElementById('jeQuick');
  document.getElementById('jeQuick').value = 'החלפת BMS + איזון';
  document.getElementById('jePrice').value = '380';
  saveJobEdit('j2');
  const j = JSON.parse(localStorage.getItem('gp_jobs')).find(x => x.id === 'j2');
  const c = JSON.parse(localStorage.getItem('gp_customers')).find(x => x.phone === '050-2222222');
  return { hasQuickField, j, c };
});
check('free-text work description offered for a quick repair', quick.hasQuickField);
check('description saved', quick.j.quickRepair === 'החלפת BMS + איזון', quick.j.quickRepair);
check('customer total follows (300 -> 380)', quick.c.totalSpent === 380, quick.c.totalSpent);

console.log('\n5. the customer card shows the repair without "undefined"');
const card = await page.evaluate(() => { openCustomerDetails(1); return document.getElementById('modalBody').innerHTML; });
check('no undefined in the row', !card.includes('undefined'), card.includes('undefined'));
check('card offers edit + delete', card.includes("openJobEditor('j2'") && card.includes("deleteJob('j2'"));
await page.evaluate(() => closeModal());

console.log('\n6. deleting a repair takes its money with it');
const del = await page.evaluate(() => {
  deleteJob('j2', 'orders');
  return { jobs: JSON.parse(localStorage.getItem('gp_jobs')).map(j => j.id),
           c: JSON.parse(localStorage.getItem('gp_customers')).find(x => x.phone === '050-2222222') };
});
check('job removed', !del.jobs.includes('j2'), del.jobs);
check('customer total back to 0', del.c.totalSpent === 0, del.c.totalSpent);
check('visit count back to 0', del.c.visitCount === 0, del.c.visitCount);

console.log('\n7. editing a sale keeps a line whose catalog row is gone');
const sale = await page.evaluate(() => {
  openOrderEditor('o1');
  document.getElementById('ordName').value = 'שרה כהן';
  document.getElementById('ordDate').value = '2026-06-20';
  saveOrder();
  return JSON.parse(localStorage.getItem('gp_orders')).find(o => o.id === 'o1');
});
check('the orphaned line survived', sale.items.length === 1, sale.items);
check('its price survived', sale.total === (SELFTEST ? 999 : 300), sale.total);
check('name edited', sale.customer === 'שרה כהן', sale.customer);
check('date edited', sale.date.slice(0, 7) === '2026-06', sale.date);
check('status untouched by the edit', sale.status === 'שולם', sale.status);

console.log('\n8. deleting a sale');
const delSale = await page.evaluate(() => { deleteOrder('o1'); return JSON.parse(localStorage.getItem('gp_orders')).length; });
check('sale removed', delSale === 0, delSale);

console.log('\n9. the sales page organises a realistic pile');
// 90 sales + 90 repairs spread over 5 months, a third of the sales left as open quotes.
const org = await page.evaluate(() => {
  const orders = [], jobs = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(2026, 3 + (i % 5), 1 + (i % 27), 12).toISOString();
    orders.push({ id: 'so' + i, date: d, customer: 'לקוח ' + i, phone: '050-000' + i, isBusiness: false,
      status: i % 3 === 0 ? 'הצעה' : 'שולם', total: 100, items: [{ name: 'פריט', cat: 'סוללות אופניים - 48V PRO', qty: 1, unit: 100 }] });
    jobs.push({ id: 'sj' + i, date: d, customerName: 'מתקן ' + i, customerPhone: '052-000' + i,
      jobs: ['bms'], price: 200, cost: 50, profit: 150, voltage: '48', capacity: '20', vehicle: 'bike' });
  }
  // one needle to find by search
  jobs[0].customerName = 'אברהם ייחודי';
  localStorage.setItem('gp_orders', JSON.stringify(orders));
  localStorage.setItem('gp_jobs', JSON.stringify(jobs));
  setSalesFilter('all');
  const statBoxes = document.querySelectorAll('#salesStats .stat-box').length;
  const monthHeaders = (document.getElementById('ordersList').innerHTML.match(/price-cat/g) || []).length;
  const rows = document.querySelectorAll('#ordersList .list-item').length;
  const more = document.getElementById('ordersList').innerHTML.includes('salesShowMore');
  const pendingShown = document.getElementById('salesPending').style.display !== 'none';
  const chips = [...document.querySelectorAll('#salesFilterBar .sub-tab')].map(e => e.textContent);
  return { statBoxes, monthHeaders, rows, more, pendingShown, chips };
});
check('month summary shows three figures', org.statBoxes === 3, org.statBoxes);
check('four filter chips incl. open quotes', org.chips.length === 4 && org.chips[3].includes('הצעות'), org.chips);
check('open-quotes banner is showing', org.pendingShown);
check('list is capped, not all 180 rows', org.rows === 60, org.rows);
check('a "show more" button appears', org.more);
check('rows are grouped under month headers', org.monthHeaders >= 2, org.monthHeaders);

const org2 = await page.evaluate(() => {
  salesShowMore();
  const after = document.querySelectorAll('#ordersList .list-item').length;
  setSalesFilter('quote');
  const quoteRows = [...document.querySelectorAll('#ordersList .list-item')];
  const allQuotes = quoteRows.every(r => r.textContent.includes('הצעה'));
  setSalesFilter('all');
  document.getElementById('salesSearch').value = 'אברהם ייחודי';
  renderOrders();
  const hits = document.querySelectorAll('#ordersList .list-item').length;
  document.getElementById('salesSearch').value = '';
  renderOrders();
  return { after, allQuotes, quoteRows: quoteRows.length, hits };
});
check('"show more" grows the list', org2.after === 120, org2.after);
check('the quotes filter shows only quotes', org2.allQuotes && org2.quoteRows > 0, org2);
check('search narrows to the one match', org2.hits === 1, org2.hits);

// The quick pricer was deleted 2026-08-17 (Daniel). Assert it is GONE rather than dropping
// the check — a half-removed feature leaves live onclick handlers calling functions that no
// longer exist, and that fails silently in the console instead of on this page.
const gone = await page.evaluate(() => ({
  card: !!document.getElementById('qpBody'),
  toggle: typeof window.toggleQuickPricer,
  init: typeof window.qpInit,
  handlers: document.body.innerHTML.includes('qpCreateJob') || document.body.innerHTML.includes('qpFillItems'),
  title: (document.querySelector('#page-orders .page-title') || {}).textContent || '',
}));
check('the quick-price card is gone', !gone.card, gone.card);
check('no toggleQuickPricer left', gone.toggle === 'undefined', gone.toggle);
check('no qpInit left', gone.init === 'undefined', gone.init);
check('no dangling qp* onclick handlers', !gone.handlers, gone.handlers);
check('page renamed to מכירות ותיקונים', gone.title.includes('מכירות ותיקונים'), gone.title);

console.log('\n10. a battery SOLD is under warranty, not just one repaired');
// The warranty page read `jobs` and only jobs, so a pack that went out through the sales
// flow carried a 12-month promise that nothing in the hub recorded. Repairs were covered,
// sales were not, and the page gave no sign of the difference.
const war = await page.evaluate(() => {
  const day = 86400000;
  localStorage.setItem('gp_jobs', JSON.stringify([{
    id: 'wj', date: new Date(Date.now() - 10 * day).toISOString(), customerName: 'תיקון דני',
    customerPhone: '050-1', jobs: ['bms'], price: 400,
    warrantyMonths: 6, warrantyEnd: new Date(Date.now() + 170 * day).toISOString() }]));
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'wo1', date: new Date(Date.now() - 5 * day).toISOString(), customer: 'קונה סוללה', phone: '050-2',
      status: 'נמסר', total: 3200, items: [{ name: 'סוללה 60V 20Ah', cat: 'סוללות קורקינטים וקולנועיות - 60V PRO', qty: 1, unit: 3200 }] },
    // A quote is not a sale: nothing was handed over, so nothing is covered.
    { id: 'wo2', date: new Date(Date.now() - 3 * day).toISOString(), customer: 'רק הצעה', phone: '050-3',
      status: 'הצעה', total: 999, items: [{ name: 'סוללה 48V', cat: 'סוללות אופניים - 48V CLASSIC', qty: 1, unit: 999 }] },
    // A lab service carries 6 months, not 12 — same rule the warranty policy is written in.
    { id: 'wo3', date: new Date(Date.now() - 2 * day).toISOString(), customer: 'שירות בלבד', phone: '050-4',
      status: 'שולם', total: 180, items: [{ name: 'שעת עבודה', cat: 'שירותי מעבדה', qty: 1, unit: 180, svc: true }] },
  ]));
  const rows = warrantyEntries();
  setWarrantyTab('active');
  const html = document.getElementById('warrantiesList').innerHTML;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const months = (r) => r ? Math.round((new Date(r.end) - new Date(r.date)) / (30 * day)) : null;
  return { ids: rows.map(r => r.id), html,
           saleMonths: months(byId.wo1), svcMonths: months(byId.wo3), repairMonths: months(byId.wj) };
});
check('the sold battery is in the register', war.ids.includes('wo1'), war.ids);
check('the repair still is', war.ids.includes('wj'), war.ids);
check('a quote is NOT', !war.ids.includes('wo2'), war.ids);
check('the sold battery gets 12 months', war.saleMonths === (SELFTEST ? 99 : 12), war.saleMonths);
check('a lab service gets 6', war.svcMonths === 6, war.svcMonths);
check('the repair keeps its own 6', war.repairMonths === 6, war.repairMonths);
check('the page shows the buyer', war.html.includes('קונה סוללה'), war.html.slice(0, 80));

console.log('\n11. the home page warns about warranties about to run out');
const rem = await page.evaluate(() => {
  const day = 86400000;
  localStorage.setItem('gp_jobs', JSON.stringify([
    { id: 'r1', date: new Date(Date.now() - 160 * day).toISOString(), customerName: 'נגמר בקרוב',
      customerPhone: '050-1', jobs: ['bms'], price: 400,
      warrantyEnd: new Date(Date.now() + 12 * day).toISOString() },
    // Comfortably in the future: must NOT be counted.
    { id: 'r2', date: new Date().toISOString(), customerName: 'רחוק', customerPhone: '050-2',
      jobs: ['bms'], price: 400, warrantyEnd: new Date(Date.now() + 300 * day).toISOString() },
    // Already expired: also must not, or the banner nags about work that is closed.
    { id: 'r3', date: new Date(Date.now() - 400 * day).toISOString(), customerName: 'פג', customerPhone: '050-3',
      jobs: ['bms'], price: 400, warrantyEnd: new Date(Date.now() - 5 * day).toISOString() },
  ]));
  // A SALE expiring soon has to count too — the whole point of warrantyEntries().
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'o9', date: new Date(Date.now() - 355 * day).toISOString(), customer: 'קונה ותיק', phone: '050-4',
      status: 'נמסר', total: 3000, items: [{ name: 'סוללה', cat: 'סוללות אופניים - 48V PRO', qty: 1, unit: 3000 }] },
  ]));
  refreshHome();
  const el = document.getElementById('warrantyReminder');
  return { shown: el.style.display !== 'none', text: el.innerText.replace(/\s+/g, ' ').trim() };
});
check('the banner appears', rem.shown, rem);
check('it counts both the repair and the sale', /\b2\b/.test(rem.text) === !SELFTEST, rem.text);
check('it names them', rem.text.includes('נגמר בקרוב') && rem.text.includes('קונה ותיק'), rem.text);
check('it ignores far-off and expired cover', !rem.text.includes('רחוק') && !rem.text.includes('פג'), rem.text);

check('no JS errors on the page', errors.length === 0, errors);

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
