// A discount on a repair or a sale (2026-10-06).
//
//   node test/test-discount.mjs
//   node test/test-discount.mjs --selftest     (discountOff takes nothing off)
//
// Daniel: "תוסיף במכירה או בתיקון אפשרות להנחה בלוח בקרה". What must hold: in ₪ or in %, off the
// price that would otherwise be charged (the calculated one or the one he typed), never below
// zero; the price stored is what the customer pays, so profit and income need nothing new, and the
// amount sits beside it; the quote, the printed quote and the messages show price / discount /
// total; the job editor and the sale editor open on the same discount and saving again does not
// take it off twice; a reset clears it, like the manual price.
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
await new Promise((r) => srv.listen(4372, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4372/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.discountOff === 'function' && typeof window.recalc === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.discountOff = () => 0; });
const num = (t) => parseFloat(String(t || '').replace(/[^\d.-]/g, '')) || 0;
const hideNotice = () => page.evaluate(() => { if (typeof closeNotice === 'function') closeNotice(); });

// ---- the repair calculator
const calc = await page.evaluate(() => {
  Store.set('jobs', []); Store.set('orders', []);
  navigateTo('calc');
  document.getElementById('custName').value = 'רונן';
  document.getElementById('custPhone').value = '050-777-1234';
  document.getElementById('voltage').value = '60';
  document.getElementById('capacity').value = '20';
  if (!state.jobs.has('bms')) toggleJob('bms');
  recalc();
  const read = () => ({ price: document.getElementById('finalPrice').textContent, profit: document.getElementById('profitDisplay').textContent,
    note: document.getElementById('discountNote').style.display === 'none' ? '' : document.getElementById('discountNote').textContent });
  const before = read();
  document.getElementById('calcDiscount').value = '10';
  document.getElementById('calcDiscountUnit').value = 'pct';
  recalc();
  const pct = read();
  document.getElementById('calcDiscountUnit').value = 'nis';
  document.getElementById('calcDiscount').value = '100';
  recalc();
  const nis = read();
  document.getElementById('calcDiscount').value = '999999';
  recalc();
  const huge = read();
  return { before, pct, nis, huge };
});
const P = num(calc.before.price);
check('the calculator quotes the repair before any discount', P > 100 && !calc.before.note, calc.before);
check('10% off: the price drops by a tenth, the note says from what', num(calc.pct.price) === P - Math.round(P * 0.1)
  && calc.pct.note.includes('לפני הנחה') && calc.pct.note.includes('(10%)'), calc.pct);
check('the profit drops by the same amount', num(calc.pct.profit) === num(calc.before.profit) - Math.round(P * 0.1), [calc.before.profit, calc.pct.profit]);
check('₪100 off: the price drops by 100', num(calc.nis.price) === P - 100, calc.nis);
check('a discount bigger than the price stops at zero', num(calc.huge.price) === 0, calc.huge);

// the quote, the printed quote, the saved job
const saved = await page.evaluate(async () => {
  document.getElementById('calcDiscount').value = '10';
  document.getElementById('calcDiscountUnit').value = 'pct';
  recalc();
  generateWhatsApp();
  const wa = document.getElementById('whatsappPreview').textContent;
  closeModal();
  generateInvoice();
  const inv = document.getElementById('invoiceContent').innerText;
  saveJob();
  await new Promise((r) => setTimeout(r, 300));
  return { wa, inv, job: (Store.get('jobs') || [])[0] || null };
});
await hideNotice();
const disc10 = Math.round(P * 0.1), after10 = P - disc10;
const sh = (n) => '₪' + n.toLocaleString('he-IL');
check('the WhatsApp quote: price, discount, final', saved.wa.includes('מחיר: ' + sh(P)) && saved.wa.includes('הנחה: −' + sh(disc10) + ' (10%)')
  && saved.wa.includes('מחיר סופי: ' + sh(after10)), saved.wa.slice(0, 300));
check('the printed quote shows the discount', /הנחה \(10%\)/.test(saved.inv) && saved.inv.includes('−' + sh(disc10)), saved.inv.slice(-400));
const j = saved.job || {};
check('saved: the price paid, and the discount beside it', j.price === after10 && j.discount === disc10 && j.discountPct === 10, j);

// the reset clears it
await page.evaluate(() => resetCalc());
await page.evaluate(() => noticeConfirm());
const cleared = await page.evaluate(() => ({ v: document.getElementById('calcDiscount').value, u: document.getElementById('calcDiscountUnit').value }));
check('a reset clears the discount, like the manual price', cleared.v === '' && cleared.u === 'nis', cleared);

// ---- the job editor: the price before the discount, the discount, saved once
const je = await page.evaluate((id) => {
  openJobEditor(id);
  const r = { price: document.getElementById('jePrice').value, disc: document.getElementById('jeDiscount').value, unit: document.getElementById('jeDiscountUnit').value };
  saveJobEdit(id);
  const again = Store.get('jobs').find((x) => x.id === id);
  openJobEditor(id);
  document.getElementById('jeDiscountUnit').value = 'nis';
  document.getElementById('jeDiscount').value = '50';
  saveJobEdit(id);
  const nis = Store.get('jobs').find((x) => x.id === id);
  openJobEditor(id);
  document.getElementById('jeDiscount').value = '';
  saveJobEdit(id);
  const none = Store.get('jobs').find((x) => x.id === id);
  return { r, again: { price: again.price, discount: again.discount }, nis: { price: nis.price, discount: nis.discount, pct: nis.discountPct, profit: nis.profit, cost: nis.cost },
    none: { price: none.price, discount: none.discount, pct: none.discountPct } };
}, j.id);
await hideNotice();
check('the job editor opens on the price before the discount and the 10%', +je.r.price === P && je.r.disc === '10' && je.r.unit === 'pct', je.r);
check('saving it unchanged does not take the discount off twice', je.again.price === after10 && je.again.discount === disc10, je.again);
check('₪50 instead: price, discount and profit follow', je.nis.price === P - 50 && je.nis.discount === 50 && je.nis.pct === undefined && je.nis.profit === je.nis.price - je.nis.cost, je.nis);
check('cleared: the full price, no discount kept', je.none.price === P && je.none.discount === undefined && je.none.pct === undefined, je.none);

// ---- a sale
const sale = await page.evaluate(() => {
  openOrderEditor();
  document.getElementById('ordName').value = 'משה';
  document.getElementById('ordPhone').value = '054-555-6666';
  document.getElementById('ordCustName').value = '72V 40Ah PRO';
  document.getElementById('ordCustPrice').value = '1000';
  addCustomOrderItem();
  const box = document.getElementById('ordDisc');
  box.focus();
  box.value = '15';
  document.getElementById('ordDiscUnit').value = 'pct';
  onOrderDisc();
  const live = { total: document.getElementById('ordTotal').innerText, focus: document.activeElement && document.activeElement.id };
  saveOrder();
  const o = Store.get('orders')[0];
  const quote = buildQuoteText(o);
  renderOrders();
  const row = (document.querySelector('[data-discount]') || {}).textContent || '';
  openOrderEditor(o.id);
  const reopened = { v: document.getElementById('ordDisc').value, u: document.getElementById('ordDiscUnit').value };
  saveOrder();
  const again = Store.get('orders')[0];
  openOrderEditor(o.id);
  document.getElementById('ordDisc').value = '';
  saveOrder();
  const none = Store.get('orders')[0];
  return { live, o: { total: o.total, discount: o.discount, pct: o.discountPct }, quote, row, reopened,
    again: { total: again.total, discount: again.discount }, none: { total: none.total, discount: none.discount, pct: none.discountPct } };
});
check('the sale\'s total follows the discount as it is typed, the box keeps the focus', /לפני הנחה ₪1,000/.test(sale.live.total) && /סה"כ: ₪850/.test(sale.live.total) && sale.live.focus === 'ordDisc', sale.live);
check('saved: the total paid, and the discount beside it', sale.o.total === 850 && sale.o.discount === 150 && sale.o.pct === 15, sale.o);
check('the sale\'s quote: price, discount, final', sale.quote.includes('מחיר: ₪1,000') && sale.quote.includes('הנחה: −₪150 (15%)') && sale.quote.includes('מחיר סופי:* ₪850'), sale.quote);
check('the sales list shows it under the total', /הנחה ₪150/.test(sale.row), sale.row);
check('the editor reopens on the 15%', sale.reopened.v === '15' && sale.reopened.u === 'pct', sale.reopened);
check('saving it again does not take it off twice', sale.again.total === 850 && sale.again.discount === 150, sale.again);
check('cleared: the full total, no discount kept', sale.none.total === 1000 && sale.none.discount === undefined && sale.none.pct === undefined, sale.none);
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
