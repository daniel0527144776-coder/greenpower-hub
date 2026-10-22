// A sale opened again keeps the price it was sold at (2026-10-22).
//
//   node test/test-sale-edit.mjs
//   node test/test-sale-edit.mjs --selftest     (orderItemInfo prices every line off today's list again)
//
// openOrderEditor kept a catalog line's row and quantity and dropped the price it was sold at, and
// saveOrder wrote that row's price of the day. So opening a September sale to correct a phone number
// re-priced every line to the current list and re-saved September's income: the 48V 3A charger, ₪150
// in September and ₪260 since the charger repricing of 2026-10-22, moved the sale up by ₪110 a unit,
// with nothing on the screen to say so. What must hold:
//   - the editor opens on what the sale was sold for, and a save that changes only the phone leaves
//     every line, the total and the month's income as they were;
//   - a line added now takes today's price, beside the old lines at theirs;
//   - moving the sale to the other price list (לקוח עסקי) is asking for that list: every catalog line
//     takes its price there, and moving it back brings the sold prices back.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4386, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4386/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openOrderEditor === 'function' && typeof window.saveOrder === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });
if (SELFTEST) {
  // the old rule: every catalog line at the row's price of the day, whatever it sold for
  await page.evaluate(() => {
    window.orderItemInfo = (it, mode) => (it.custom ? { name: it.name, unit: Number(it.unit) || 0 } : { name: PRICING[it.ci].name, unit: PRICING[it.ci][mode] });
  });
}

const R = await page.evaluate(() => {
  const row = (re, catRe) => PRICING.find((x) => re.test(x.name) && catRe.test(x.cat) && typeof x.retail === 'number');
  const charger = row(/^מטען 48V 3A$/, /^מטענים/);
  const pack = row(/^48V 20Ah$/, /אופניים.*CLASSIC/);
  const added = row(/^מטען 60V 3A$/, /^מטענים/);
  if (!charger || !pack || !added) return { missing: { charger: !!charger, pack: !!pack, added: !!added } };
  // A September sale at September's prices: both rows sold for less than today's list.
  const soldCharger = charger.retail - 110, soldPack = pack.retail - 100;
  const items = [
    { name: charger.name, cat: charger.cat, qty: 2, unit: soldCharger },
    { name: pack.name, cat: pack.cat, qty: 1, unit: soldPack },
    { name: 'סוללה מיוחדת 52V', cat: 'מותאם אישית', qty: 1, unit: 900, custom: true },
  ];
  const total = soldCharger * 2 + soldPack + 900;
  Store.set('jobs', []); Store.set('customers', []);
  Store.set('orders', [{ id: 'oSep', date: '2026-09-10T10:00:00.000Z', customer: 'לקוח מספטמבר', phone: '050-111-2222', status: 'שולם',
    isBusiness: false, items, total, stockTaken: true }]);
  const septBefore = (finMonthly()['2026-09'] || {}).inc;
  const read = () => (Store.get('orders') || []).find((o) => o.id === 'oSep');
  const units = (o) => o.items.map((it) => it.unit);
  const shown = () => (document.getElementById('ordTotal') || {}).innerText || '';

  // 1. open it and fix only the phone
  openOrderEditor('oSep');
  const opened = shown();
  document.getElementById('ordPhone').value = '050-111-3333';
  saveOrder();
  const afterPhone = read();
  const septAfter = (finMonthly()['2026-09'] || {}).inc;

  // 2. a line added now, through the picker
  openOrderEditor('oSep');
  orderDraft.main = catPath(added.cat)[0]; orderDraft.cat = added.cat; renderOrderModal();
  document.getElementById('ordProd').value = String(PRICING.indexOf(added));
  document.getElementById('ordQty').value = '1';
  addOrderItem();
  saveOrder();
  const afterAdd = read();

  // 3. to the business list and back, then to it for good
  openOrderEditor('oSep');
  toggleOrderBiz();
  const bizShown = orderDraft.items.filter((it) => !it.custom).map((it) => orderItemInfo(it, 'b2b').unit);
  toggleOrderBiz();
  const backShown = orderDraft.items.filter((it) => !it.custom).map((it) => orderItemInfo(it, 'retail').unit);
  toggleOrderBiz();
  saveOrder();
  const afterBiz = read();

  return {
    prices: { charger: charger.retail, pack: pack.retail, added: added.retail, soldCharger, soldPack, b2b: [charger.b2b, pack.b2b, added.b2b] },
    total, opened, septBefore, septAfter,
    afterPhone: { units: units(afterPhone), total: afterPhone.total, phone: afterPhone.phone },
    afterAdd: { units: units(afterAdd), total: afterAdd.total },
    bizShown, backShown, afterBiz: { units: units(afterBiz), total: afterBiz.total, isBusiness: afterBiz.isBusiness },
  };
});
await browser.close();
srv.close();

if (R.missing) { check('the catalogue rows this test sells are in PRICING', false, R.missing); process.exit(finish()); }
const P = R.prices;
const sh = (n) => '₪' + Math.round(n).toLocaleString('en-US');
check('the test means something: both rows cost more today than they sold for', P.charger > P.soldCharger && P.pack > P.soldPack, P);
check('the editor opens on what the sale was sold for', R.opened.includes(sh(R.total)), R.opened);
check('a save that changes only the phone keeps every line at its sold price',
  R.afterPhone.units.join() === [P.soldCharger, P.soldPack, 900].join() && R.afterPhone.phone === '050-111-3333', R.afterPhone);
check('…and the total', R.afterPhone.total === R.total, R.afterPhone);
check('…and September\'s income', R.septAfter === R.septBefore && R.septBefore === R.total, { before: R.septBefore, after: R.septAfter });
check('a line added now takes today\'s price, beside the old ones at theirs',
  R.afterAdd.units.join() === [P.soldCharger, P.soldPack, 900, P.added].join() && R.afterAdd.total === R.total + P.added, R.afterAdd);
check('moved to the business list, every catalog line takes its B2B price', R.bizShown.join() === P.b2b.join(), R.bizShown);
check('moved back, the sold prices return', R.backShown.join() === [P.soldCharger, P.soldPack, P.added].join(), R.backShown);
check('saved on the business list: B2B prices, the custom line unchanged',
  R.afterBiz.isBusiness === true && R.afterBiz.units.join() === [P.b2b[0], P.b2b[1], 900, P.b2b[2]].join(), R.afterBiz);
check('no page errors', errs.length === 0, errs.join(' | '));
if (SELFTEST) console.log('\n[selftest] every line priced off today\'s list again; the sold-price checks above must be red.');
process.exit(finish());
