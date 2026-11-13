// A partner who sends customers, and what he is owed each month (2026-11-12).
//
//   node test/test-partners.mjs
//   node test/test-partners.mjs --selftest          (a sale's share read off today's catalogue, not the price it was saved with)
//   node test/test-partners.mjs --selftest auto     (a marked customer's next sale is no one's)
//
// Daniel: a partner sends him customers and buys at the catalogue's business price; at the end of each month he
// needs how many customers came through the partner and what the partner is owed — what the customer paid less the
// business price. He chose to mark it on the sale in the hub. What must hold:
//   - the sale editor names the partner, shows the business price and the partner's share, and the save keeps both
//     the partner and each line's business price of that day;
//   - the customer is marked by that sale, and his next sale is the partner's without choosing again, unless "ללא"
//     is chosen for it;
//   - a sale opened later keeps its business prices, so a catalogue change does not move an old month;
//   - a discount comes off the share; a line typed by hand needs its business price typed, and until then the sale
//     is shown as missing one and left out of the sum;
//   - only paid or delivered sales count, in their own month; open quotes are counted apart;
//   - marking a customer on his card offers to mark the sales of his already saved;
//   - the page shows it: customers, the sum, a row a sale, and the WhatsApp summary carries the same sum.
// The names are made up: this repository is public.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MODE = SELFTEST ? (process.argv[process.argv.indexOf('--selftest') + 1] || 'share') : '';
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4421, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4421/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openOrderEditor === 'function' && typeof window.renderPartners === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });
if (MODE === 'share') {
  await page.evaluate(() => {
    const real = window.salePartnerShare;
    window.salePartnerShare = (o) => real(o && { ...o, items: (o.items || []).map(({ b2b, ...it }) => it) });
  });
}
if (MODE === 'auto') await page.evaluate(() => { window.customerForPhone = () => null; });

const R = await page.evaluate(() => {
  const row = (re, catRe) => PRICING.find((x) => re.test(x.name) && catRe.test(x.cat) && typeof x.retail === 'number' && typeof x.b2b === 'number');
  const pack = row(/^48V 20Ah$/, /אופניים.*CLASSIC/);
  const charger = row(/^מטען 48V 3A$/, /^מטענים/);
  if (!pack || !charger) return { missing: { pack: !!pack, charger: !!charger } };
  const P = { packR: pack.retail, packB: pack.b2b, chR: charger.retail, chB: charger.b2b };
  Store.set('jobs', []); Store.set('customers', []); Store.set('orders', []);
  Store.set('settings', { ...(Store.get('settings') || {}), partners: [{ id: 'pT', name: 'שותף דוגמה', phone: '050-000-0001', since: '2026-11-01T08:00:00.000Z' }] });
  const read = (id) => (Store.get('orders') || []).find((o) => o.id === id);
  const add = (r) => {
    syncOrderFields();   // what was typed, before the picker redraws the modal
    orderDraft.main = catPath(r.cat)[0]; orderDraft.cat = r.cat; renderOrderModal();
    document.getElementById('ordProd').value = String(PRICING.indexOf(r));
    document.getElementById('ordQty').value = '1';
    addOrderItem();
  };
  const newSale = (name, phone, date) => {
    openOrderEditor();
    document.getElementById('ordName').value = name;
    document.getElementById('ordPhone').value = phone;
    document.getElementById('ordDate').value = date;
  };
  const lastId = () => (Store.get('orders') || [])[0].id;
  const setStatus = (id, st) => Store.set('orders', (Store.get('orders') || []).map((o) => (o.id === id ? { ...o, status: st } : o)));
  const out = { P };

  // 1. a new sale, the partner chosen in the editor
  newSale('לקוח דוגמה', '050-123-0001', '2026-11-05');
  add(pack);
  out.hasSelect = !!document.getElementById('ordRef');
  document.getElementById('ordRef').value = 'pT'; onOrderRef();
  out.line1 = (document.getElementById('ordPartner') || {}).innerText || '';
  saveOrder();
  const s1 = lastId();
  out.sale1 = read(s1);
  out.cust1 = (Store.get('customers') || []).find((c) => c.phone === '050-123-0001') || null;
  setStatus(s1, 'שולם');

  // 2. his next sale: only the phone typed, nothing chosen
  newSale('לקוח דוגמה', '050-123-0001', '2026-11-08');
  add(charger);
  out.shown2 = (document.getElementById('ordRef') || {}).value || '';
  saveOrder();
  const s2 = lastId();
  out.sale2ref = read(s2).referredBy || '';
  setStatus(s2, 'נמסר');

  // 3. "ללא" chosen for a sale of the same customer
  newSale('לקוח דוגמה', '050-123-0001', '2026-11-09');
  add(charger);
  document.getElementById('ordRef').value = ''; onOrderRef();
  saveOrder();
  const s3 = lastId();
  out.sale3ref = read(s3).referredBy;
  setStatus(s3, 'שולם');

  // 4. a discount comes off the share
  newSale('לקוח דוגמה ב', '050-123-0002', '2026-11-10');
  add(pack);
  document.getElementById('ordRef').value = 'pT'; onOrderRef();
  document.getElementById('ordDisc').value = '100'; onOrderDisc();
  out.line4 = (document.getElementById('ordPartner') || {}).innerText || '';
  saveOrder();
  const s4 = lastId();
  setStatus(s4, 'שולם');

  // 5. a line typed by hand: missing until its business price is typed
  newSale('לקוח דוגמה ג', '050-123-0003', '2026-11-11');
  document.getElementById('ordRef').value = 'pT'; onOrderRef();
  document.getElementById('ordCustName').value = 'סוללה מיוחדת 52V';
  document.getElementById('ordCustPrice').value = '2000';
  addCustomOrderItem();
  out.line5 = (document.getElementById('ordPartner') || {}).innerText || '';
  saveOrder();
  const s5 = lastId();
  setStatus(s5, 'שולם');
  out.missingBefore = partnerMonth('pT', '2026-11').missing;

  // 6. a quote, and a sale of another month
  newSale('לקוח דוגמה ד', '050-123-0004', '2026-11-12');
  add(charger);
  document.getElementById('ordRef').value = 'pT'; onOrderRef();
  saveOrder();
  newSale('לקוח דוגמה ה', '050-123-0005', '2026-10-20');
  add(charger);
  document.getElementById('ordRef').value = 'pT'; onOrderRef();
  saveOrder();
  setStatus(lastId(), 'שולם');

  // 7. the custom line's business price typed
  openOrderEditor(s5);
  out.customBox = !!document.getElementById('ordCustomB2b');
  document.getElementById('ordCustomB2b').value = '1500';
  onOrderDisc();
  saveOrder();
  out.sale5 = read(s5);

  // 8. the catalogue moves; the first sale opened to fix its phone keeps its business price
  const before = partnerMonth('pT', '2026-11');
  pack.b2b += 100;
  openOrderEditor(s1);
  document.getElementById('ordPhone').value = '050-123-0001';
  saveOrder();
  out.sale1after = read(s1);
  const m = partnerMonth('pT', '2026-11');
  out.month = { customers: m.customers, owed: m.owed, missing: m.missing, quotes: m.quotes, rows: m.rows.map((r) => [r.o.id, r.paid, r.base, r.owed]) };
  out.ids = { s1, s2, s3, s4, s5 };
  out.beforeOwed = before.owed;
  out.oct = partnerMonth('pT', '2026-10').owed;
  pack.b2b -= 100;

  // 9. the customer card: a customer marked after his sale was saved
  newSale('לקוח דוגמה ו', '050-123-0006', '2026-11-12');
  add(charger);
  saveOrder();
  const s9 = lastId();
  const ci = (Store.get('customers') || []).findIndex((c) => c.phone === '050-123-0006');
  openCustomerDetails(ci);
  out.cardSelect = !!document.getElementById('custRef');
  closeModal();
  setCustomerPartner(ci, 'pT');
  out.askShown = document.getElementById('noticeBackdrop').classList.contains('active');
  noticeConfirm();
  setStatus(s9, 'שולם');
  out.sale9ref = read(s9).referredBy || '';
  out.cust9ref = ((Store.get('customers') || [])[ci] || {}).referredBy || '';

  // 10. the page
  navigateTo('partners');
  document.getElementById('ptMonth').value = '2026-11';
  renderPartners();
  const card = document.querySelector('[data-partner="pT"]');
  out.page = card ? {
    owed: (card.querySelector('[data-partner-owed]') || {}).innerText || '',
    customers: (card.querySelector('[data-partner-customers]') || {}).innerText || '',
    rows: card.querySelectorAll('[data-partner-sale]').length,
  } : null;
  out.chip = !!document.querySelector('#page-partners [data-view="partners"].active');
  out.text = partnerMonthText(partnerOf('pT'), '2026-11');
  out.shekOwed = shek(partnerMonth('pT', '2026-11').owed);
  out.tag = (() => { navigateTo('orders'); return !!document.querySelector('#ordersList [data-partner-tag]'); })();
  return out;
});
// On his phone's width every view of the strip is on the screen: the fifth, this one, sat half off its edge.
await page.setViewportSize({ width: 390, height: 900 });
await page.evaluate(() => navigateTo('partners'));
const chips = await page.evaluate(() => [...document.querySelectorAll('#page-partners [data-view]')].map((e) => {
  const r = e.getBoundingClientRect();
  return { view: e.dataset.view, left: Math.round(r.left), right: Math.round(r.right) };
}));
await browser.close();
srv.close();

if (R.missing) { check('the catalogue rows this test sells are in PRICING', false, R.missing); process.exit(finish()); }
const P = R.P;
const sh = (n) => '₪' + Math.round(n).toLocaleString('en-US');
const share1 = P.packR - P.packB;
check('the test means something: the pack and the charger are cheaper for a business', share1 > 0 && P.chR > P.chB, P);
check('the sale editor offers the partner', R.hasSelect);
check('…and shows the business price and his share', R.line1.includes(sh(P.packB)) && R.line1.includes(sh(share1)), R.line1);
check('the save keeps the partner and the line\'s business price', R.sale1.referredBy === 'pT' && R.sale1.items[0].b2b === P.packB, R.sale1);
check('the customer is marked by his sale', R.cust1 && R.cust1.referredBy === 'pT', R.cust1);
check('his next sale is the partner\'s without choosing again', R.sale2ref === 'pT', R.sale2ref);
check('…and the editor shows it before the save', R.shown2 === 'pT', R.shown2);
check('"ללא" chosen for a sale keeps it no one\'s', !R.sale3ref, R.sale3ref);
check('a discount comes off the share, on the screen', R.line4.includes(sh(share1 - 100)), R.line4);
check('a line typed by hand asks for its business price', /חסר מחיר עסקי/.test(R.line5), R.line5);
check('…and until it is typed the sale is missing one', R.missingBefore === 1, R.missingBefore);
check('…the editor has the box for it, and keeps what is typed', R.customBox && R.sale5.customB2b === 1500, R.sale5);
check('a sale opened later keeps the business price it was saved with', R.sale1after.items[0].b2b === P.packB, R.sale1after.items);
const want = [[R.ids.s1, P.packR, P.packB, share1], [R.ids.s2, P.chR, P.chB, P.chR - P.chB], [R.ids.s4, P.packR - 100, P.packB, share1 - 100], [R.ids.s5, 2000, 1500, 500]];
check('the month: one row a paid sale of his, each with its share', JSON.stringify(R.month.rows) === JSON.stringify(want), { got: R.month.rows, want });
const owed = want.reduce((s, r) => s + r[3], 0);
check('…the sum, unmoved by the catalogue', R.month.owed === owed && R.beforeOwed === owed, { owed: R.month.owed, before: R.beforeOwed, want: owed });
check('…three customers, nothing missing, the open quote counted apart', R.month.customers === 3 && R.month.missing === 0 && R.month.quotes === 1, R.month);
check('a sale of October counts in October', R.oct === P.chR - P.chB, R.oct);
check('the customer card offers the mark', R.cardSelect);
check('marking a customer offers to mark his saved sale, and does', R.askShown && R.sale9ref === 'pT' && R.cust9ref === 'pT', { ask: R.askShown, sale: R.sale9ref, cust: R.cust9ref });
check('the page: his card, the sum, the customers, a row a sale', R.page && R.page.owed === R.shekOwed && R.page.customers === '4' && R.page.rows === 5, R.page);
check('the page is a view of לקוחות ועבודות', R.chip);
check('the WhatsApp summary carries the same sum', R.text.includes('סה"כ מגיע לך: ' + R.shekOwed), R.text);
check('a sale of his says so on its row', R.tag);
check('at 390px every view of the strip is whole on the screen', chips.length === 5 && chips.every((c) => c.left >= 0 && c.right <= 390), chips);
check('no page errors', errs.length === 0, errs.join(' | '));
if (SELFTEST) console.log(`\n[selftest ${MODE}] ${MODE === 'auto' ? 'a marked customer\'s next sale is no one\'s' : 'a sale\'s share read off today\'s catalogue'}; the checks it breaks above must be red.`);
process.exit(finish());
