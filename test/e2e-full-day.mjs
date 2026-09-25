// End to end: a whole working day through the hub, in order, against the LIVE site.
//
//   node test/e2e-full-day.mjs                  (live)
//   node test/e2e-full-day.mjs --local          (the dist in this checkout)
//   node test/e2e-full-day.mjs --selftest       (proves it can go red)
//
// The unit suites each prove one thing in isolation. This proves the day joins up: import the
// accountant's books, merge the duplicates they create, look up a price, quote a repair, sell
// something, and check the money that comes out the other end is the money that went in.
//
// Every step asserts against a figure derived somewhere else in the app, never a number typed
// here — that is the rule the whole repo is built on, and a hardcoded expectation is how
// verify-prices once failed against a correct site.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const LOCAL = process.argv.includes('--local');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

let srv = null, BASE = 'https://hub.energylabgreen.com/';
if (LOCAL) {
  srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(DIST, rel);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200); r.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(4348, r));
  BASE = 'http://localhost:4348/index.html';
}

// The real books when this machine has them; a stand-in of the same shape otherwise, because
// CI cannot see the tools root.
const REAL = path.join(HERE, '..', '..', 'accounting-import.json');
let PAYLOAD, REALDATA = false;
try { PAYLOAD = fs.readFileSync(REAL, 'utf8'); JSON.parse(PAYLOAD); REALDATA = true; } catch {
  PAYLOAD = JSON.stringify({
    customers: [
      { name: 'כפול', phone: '0501234567', firstVisit: '2021-01-01T00:00:00.000Z' },
      { name: 'כפול', firstVisit: '2021-01-01T00:00:00.000Z' },
      ...Array.from({ length: 40 }, (_, i) => ({ name: 'לקוח ' + i, phone: '05' + String(20000000 + i), firstVisit: '2021-01-01T00:00:00.000Z' })),
    ],
    incomes: Array.from({ length: 40 }, (_, i) => ({ amount: 500 + i, date: new Date(2021, i % 12, 1 + (i % 27)).toISOString(), customer: 'לקוח ' + i, phone: '05' + String(20000000 + i) })),
  });
}
console.log(`  target: ${BASE}`);
console.log(`  books : ${REALDATA ? 'the real accounting-import.json' : 'a generated stand-in'}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
// A native dialog is invisible in the WebView on his phone — raising one at all is the defect.
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 40000 });
await page.evaluate(() => {
  localStorage.clear();
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  init();
});
const build = await page.evaluate(() => (typeof HUB_BUILD !== 'undefined' ? HUB_BUILD : '?'));
console.log(`  build : ${build}\n`);

// ---------------------------------------------------------------- 1. the books come in
const imported = await page.evaluate(async (p) => {
  openAccountingImport();
  document.getElementById('acctJson').value = p;
  importAccounting();
  await new Promise((r) => setTimeout(r, 900));
  const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none';
  const cust = JSON.parse(localStorage.getItem('gp_customers') || '[]');
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  return { cust: cust.length, books: cust.filter((c) => c.src === 'books').length, inc: inc.length,
           incTotal: inc.reduce((s, r) => s + (+r.amount || 0), 0) };
}, PAYLOAD);
check('the accountant\'s customers arrive', imported.books > 0 && imported.books === imported.cust, imported);
check('and their income history with them', imported.inc > 0, imported);

if (SELFTEST) {
  // Break the joint the whole day hangs on, BEFORE the checks that would notice: attribution is
  // BY PHONE, so a merge that loses the survivor's number orphans everything filed under it.
  //
  // (A first version of this deleted `altPhones` instead and the suite stayed GREEN — on the
  // real books only שמואל חנוך gets an altPhone and he is classified unsafe, so the safe-merge
  // path never produces one. It broke something this path does not use, which is the same lie
  // as a check that cannot fail.)
  await page.evaluate(() => {
    const real = window.mergeDupeGroup;
    window.mergeDupeGroup = function (key) {
      const r = real(key);
      const cs = Store.get('customers') || [];
      const hit = cs.find((c) => String(c.name || '').trim().toLowerCase() === key);
      if (hit) { hit.phone = ''; Store.set('customers', cs); }
      return r;
    };
  });
}

// ---------------------------------------------------------------- 2. the duplicates it creates
const merged = await page.evaluate(async () => {
  const idx0 = customerSpendIndex();
  const moneyBefore = (Store.get('customers') || []).reduce((s, c) => s + idx0(c).spent, 0);
  const before = (Store.get('customers') || []).length;
  const groups = findCustomerDupes();
  const safe = groups.filter((g) => g.safe);
  for (const g of safe) mergeDupeGroup(g.key);
  renderCustomers();
  const idx = customerSpendIndex();
  const cs = Store.get('customers') || [];
  let disagree = 0;
  for (const c of cs) if (Math.round(idx(c).spent) !== Math.round(customerLedger(c).spent)) disagree++;
  return { groups: groups.length, safe: safe.length, before, after: cs.length,
           moneyBefore, moneyAfter: cs.reduce((s, c) => s + idx(c).spent, 0), disagree };
});
check('duplicate names are detected', merged.groups > 0, merged);
check('merging removes exactly the records it absorbed', merged.after === merged.before - merged.safe, merged);
// The one that would be silent: attribution is by phone, so a careless merge orphans money.
check('NOT ONE SHEKEL moves when they are merged',
  Math.round(merged.moneyBefore) === Math.round(merged.moneyAfter), merged);
check('the list and the customer card still agree', merged.disagree === 0, merged.disagree);

// ---------------------------------------------------------------- 3. looking a price up
const price = await page.evaluate(() => {
  navigateTo('home');
  const el = document.getElementById('homePrice');
  el.value = '72V 30';
  homePriceSearch();
  const out = document.getElementById('homePriceOut');
  const row = PRICING.find((p) => /72V 30Ah/.test(p.name) && /PRO/.test(p.cat));
  return { rows: out.querySelectorAll('.price-item').length,
           matchesCatalogue: !!row && out.innerText.includes(row.retail.toLocaleString('he-IL')) };
});
check('a size typed on the home page finds packs', price.rows > 0, price.rows);
check('and the price shown is the catalogue price', price.matchesCatalogue, price);

// ---------------------------------------------------------------- 4. the price list
const cat = await page.evaluate(() => {
  navigateTo('catalog');
  const list = document.getElementById('catalogList');
  const volts = [...list.querySelectorAll('.price-volt')].map((e) => e.innerText.trim());
  const heads = [...list.querySelectorAll('.price-cat')];
  const i = Math.floor(heads.length / 2);
  const label = heads[i].innerText.replace(/^[▾▸]\s*/, '').trim();
  catOpenCats = new Set(); renderCatalog();
  [...document.getElementById('catalogList').querySelectorAll('.price-cat')][i].click();
  return { volts, cats: heads.length, clicked: label, opened: [...catOpenCats][0] || '' };
});
check('the batteries are grouped by voltage', cat.volts.length >= 5 && cat.volts.every((v) => /^\d+V$/.test(v)), cat.volts);
check('and pressing a category opens that category', cat.clicked === cat.opened, cat);

// ---------------------------------------------------------------- 5. a repair, quoted and saved
const repair = await page.evaluate(async () => {
  navigateTo('calc');
  document.getElementById('custName').value = 'לקוח E2E';
  document.getElementById('custPhone').value = '0500000777';
  document.getElementById('voltage').value = '72';
  document.getElementById('capacity').value = '30';
  toggleJob('bms');
  recalc();
  const quoted = parseFloat((document.getElementById('finalPrice').textContent || '').replace(/[^\d]/g, ''));
  saveJob();
  await new Promise((r) => setTimeout(r, 400));
  const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none';
  const jobs = Store.get('jobs') || [];
  const mine = jobs.find((j) => j.customerPhone === '0500000777');
  return { quoted, saved: !!mine, price: mine ? mine.price : 0, warranty: mine ? mine.warrantyMonths : null };
});
check('the calculator quotes a repair', repair.quoted > 0, repair);
check('saving it records the quoted price, not another one', repair.saved && repair.price === repair.quoted, repair);
// 6 for a repair, 12 for a build — the split the whole site states.
check('and a repair carries the repair warranty', repair.warranty === 6, repair.warranty);

const landed = await page.evaluate(() => {
  const idx = customerSpendIndex();
  const c = (Store.get('customers') || []).find((x) => x.phone === '0500000777');
  navigateTo('warranties');
  const w = document.getElementById('page-warranties').innerText;
  return { onCard: c ? Math.round(idx(c).spent) : -1, inWarranties: /לקוח E2E/.test(w) };
});
check('the repair reaches the customer card', landed.onCard === repair.price, landed);
check('and the warranty register', landed.inWarranties, landed);

// ---------------------------------------------------------------- 6. a sale, and the shelf
const sale = await page.evaluate(async () => {
  Store.set('inventory', [{ id: 'i1', name: 'DALY 60A', qty: 10, low: 3 }]);
  const o = { id: 'e2e1', date: new Date().toISOString(), customer: 'לקוח E2E', phone: '0500000777',
    items: [{ name: 'DALY 60A', cat: 'BMS', qty: 2, unit: 180 }], total: 360, status: 'שולם' };
  const orders = Store.get('orders') || []; orders.unshift(o); Store.set('orders', orders);
  const fresh = Store.get('orders') || [];
  takeOrderStock(fresh[0]); Store.set('orders', fresh);
  await new Promise((r) => setTimeout(r, 200));
  const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none';
  const idx = customerSpendIndex();
  const c = (Store.get('customers') || []).find((x) => x.phone === '0500000777');
  return { stock: (Store.get('inventory') || [])[0].qty, onCard: c ? Math.round(idx(c).spent) : -1 };
});
check('a sale takes its stock off the shelf', sale.stock === 8, sale);
check('and joins the same customer card as the repair', sale.onCard === repair.price + 360, sale);

// ---------------------------------------------------------------- 7. the money reconciles
const money = await page.evaluate(() => {
  navigateTo('finances');
  const inc = Store.get('incomes') || [];
  const jobs = Store.get('jobs') || [];
  const sales = (Store.get('orders') || []).filter(saleIsIncome);
  const expected = inc.reduce((s, r) => s + (+r.amount || 0), 0)
                 + jobs.reduce((s, j) => s + (+j.price || 0), 0)
                 + sales.reduce((s, o) => s + (+o.total || 0), 0);
  const shown = document.getElementById('page-finances').innerText;
  const m = shown.match(/סה"כ הכנסות\s*₪([\d,]+)/);
  return { expected: Math.round(expected), shown: m ? Number(m[1].replace(/,/g, '')) : null };
});
check('the finances page totals every source of income', money.shown === money.expected, money);

// ---------------------------------------------------------------- 8. the rest of the day
const rest = await page.evaluate(async () => {
  navigateTo('diag'); toggleDiag('range');
  const diag = document.querySelectorAll('#diagList ol li').length;
  navigateTo('calcs');
  document.getElementById('dimHolder').value = 'custom';
  document.getElementById('dimPitchAlong').value = '19';
  document.getElementById('dimPitchAcross').value = '21.4';
  // His 390 x 135 is the CELL block, so no BMS allowance comes off its length (2026-09-25:
  // the allowance moved from the height to the length). Set, not inherited — it passed
  // locally on leftover state and failed on CI's fresh page.
  document.getElementById('dimExtra').value = '0'; dimExtraTouched = true;
  calcPackDims();
  ['opL', 'opW', 'opH'].forEach((id, i) => { document.getElementById(id).value = [390, 135, 100][i]; });
  document.getElementById('opV').value = '72';
  const fit = oldPackFit();
  return { diag, cells: fit && fit.fits ? fit.N : 0, cfg: fit && fit.fits ? fit.S + 'S' + fit.P + 'P' : '' };
});
check('fault diagnosis lists ordered checks', rest.diag >= 4, rest.diag);
// His own measured pack: 390x135 on the 19/21.4 bracket is 20S6P, 120 cells.
check('the old-pack calculator reproduces his measured 72V pack', rest.cells === 120 && rest.cfg === '20S6P', rest);

const sticker = await page.evaluate(async () => {
  navigateTo('stickers');
  await new Promise((r) => setTimeout(r, 3500));
  const f = document.getElementById('stickerFrame');
  let doc = null; try { doc = f && f.contentDocument; } catch (e) { doc = null; }
  return { framed: !!doc, editor: !!(doc && doc.getElementById('sticker-to-capture')),
           url: (f && f.getAttribute('src')) || null, chars: doc ? doc.body.innerHTML.length : 0 };
});
check('the sticker editor opens inside the app', sticker.framed && sticker.editor, sticker);
// The phone has no browser: anything that navigates away opens a block screen.
check('and it never leaves the page to do it', sticker.url === null, sticker.url);

if (SELFTEST) {
  console.log('\n[selftest] the merge was made to drop the absorbed record\'s phone number.');
  console.log('[selftest] "NOT ONE SHEKEL moves" must have gone red — that is the whole point of altPhones.');
}

check('no page errors anywhere in the day', errs.length === 0, errs);
check('no native dialogs anywhere in the day', dialogs.length === 0, dialogs);

await browser.close(); if (srv) srv.close();
process.exit(finish());
