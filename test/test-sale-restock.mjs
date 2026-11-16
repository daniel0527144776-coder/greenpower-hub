// A sale's stock follows the sale: the board picked on it, an edit, a deletion; one customer per number (2026-11-16).
//
//   node test/test-sale-restock.mjs
//   node test/test-sale-restock.mjs --selftest     (the sale as it was: none of the below; must go red)
//
// Found in the big check of the hub, 2026-11-16:
//   - a sale of a 48V pack with a 150A board picked on it took a 60A board off the shelf: the board was read off
//     the voltage alone (Daniel, 2026-11-15: he fits DALY 60A, 100A or 150A by the customer's controller);
//   - a paid sale opened and its quantity raised from 1 to 2 took nothing more, a line removed gave nothing back,
//     and a sale deleted kept its cells and its board off the shelf;
//   - one number typed three ways ("050-1110001", "0501110001", "+972 50-111-0001") made three customers, each
//     with a third of the history: everything is filed under the phone and matched to it exactly.
// What must hold:
//   - the picked board is the one taken; with none picked the voltage's default still is;
//   - an edit moves the shelf by what the edit changed, and only that (a phone edit moves nothing); a deletion
//     gives back what the sale took; both are logged, so the pace of use nets them out;
//   - a sale stocked before what it took was kept is not moved by a guess, and says so;
//   - a number however typed is the customer who has it, and the sale is filed under the customer's own spelling.
// Every name and number here is made up; this repo is public.
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
await new Promise((r) => srv.listen(4441, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4441/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof saveOrder === 'function' && typeof takeOrderStock === 'function' && typeof PRICING !== 'undefined', null, { timeout: 30000 });

const r = await page.evaluate((SELF) => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const notices = [], confirms = [];
  window.showNotice = (t) => { notices.push(String(t)); };
  window.askConfirm = (m, cb) => { confirms.push(String(m)); cb(); };
  window.offerReviewAsk = () => {};
  if (SELF) {
    // the sale as it was: the board off the voltage, an edit and a deletion that leave the shelf, a phone matched as typed
    const parts = window.batteryStockParts;
    window.batteryStockParts = (it) => parts(it);
    window.restockEditedSale = () => {};
    window.applyStockDelta = (entries) => ({ ok: true, done: [], missed: [] });
    window.canonPhone = (p) => String(p || '').trim();
    window.findCustomerByPhone = (cs, p) => (cs || []).find((c) => c.phone === p) || null;
  }
  const out = {};
  const row = PRICING.find((x) => /^סוללות אופניים - 48V CLASSIC$/.test(x.cat) && /^48V 20Ah$/.test(x.name));
  out.row = !!row;
  if (!row) return out;
  const CELLS = 'תאי EVE 21700 50E', B60 = 'BMS DALY 13S 48V 60A', B150 = 'BMS DALY 13S 48V 150A';
  Store.set('inventory', [
    { id: 'c1', name: CELLS, cat: 'תא', qty: 1000 },
    { id: 'b1', name: B60, cat: 'BMS', qty: 5 },
    { id: 'b2', name: 'BMS DALY 13S 48V 100A', cat: 'BMS', qty: 5 },
    { id: 'b3', name: B150, cat: 'BMS', qty: 5 },
  ]);
  // the log already runs (since 2026-10-04): a sale after its first line is counted by its lines, never read back again
  Store.set('inv_log', [{ id: 'iu0', at: new Date(Date.now() - 2 * 864e5).toISOString(), row: 'zz', name: 'שורה דוגמה', qty: 1, note: '' }]);
  Store.set('customers', []); Store.set('orders', []);
  const shelf = () => Object.fromEntries(getInventory().map((i) => [i.name, i.qty]));
  const sale = (id, extra) => ({ id, date: new Date().toISOString(), customer: 'לקוח דוגמה', phone: '050-0000000', status: 'הצעה', isBusiness: false,
    bms: '', bmsBrand: '', bmsAmps: '', total: row.price, items: [{ name: row.name, cat: row.cat, qty: 1, unit: row.price }], ...extra });

  // the board picked on the sale
  Store.set('orders', [sale('a', { bms: 'DALY 150A', bmsBrand: 'daly', bmsAmps: '150' }), sale('n')]);
  cycleOrderStatus('a');
  out.paidA = shelf();
  cycleOrderStatus('n');
  out.paidN = shelf();
  // an edit: twice the packs, then a phone, then back to one
  const edit = (id, fn) => { notices.length = 0; openOrderEditor(id); fn(); saveOrder(); return { shelf: shelf(), said: notices.join(' | ') }; };
  out.twice = edit('a', () => { orderDraft.items[0].qty = 2; });
  out.phone = edit('a', () => { document.getElementById('ordPhone').value = '050-0000009'; });
  out.once = edit('a', () => { orderDraft.items[0].qty = 1; });
  out.recordA = (Store.get('orders').find((o) => o.id === 'a') || {}).stockRows;
  // a deletion gives back what it took
  confirms.length = 0;
  deleteOrder('a');
  out.deleted = shelf();
  out.deleteSaid = confirms.join(' | ');
  out.goneA = !Store.get('orders').some((o) => o.id === 'a');
  // the pace of use nets a line given back
  const u = invUsage();
  out.pace = { b150: u.used.b3 || 0, cells: u.used.c1 || 0 };
  out.negLog = (Store.get('inv_log') || []).some((e) => Number(e.qty) < 0);
  // a sale stocked before its rows were kept: not moved, and said
  Store.set('orders', [sale('old', { status: 'שולם', stockTaken: true, date: '2026-10-01T10:00:00.000Z' })]);
  const before = shelf();
  out.oldEdit = edit('old', () => { orderDraft.items[0].qty = 3; });
  out.oldMoved = JSON.stringify(out.oldEdit.shelf) !== JSON.stringify(before);
  confirms.length = 0;
  deleteOrder('old');
  out.oldDeleted = JSON.stringify(shelf()) !== JSON.stringify(before);
  out.oldSaid = confirms.join(' | ');

  // one number, however typed
  Store.set('orders', []); Store.set('customers', []);
  const sell = (phone) => { openOrderEditor(); document.getElementById('ordName').value = 'שמעון דוגמה'; document.getElementById('ordPhone').value = phone;
    orderDraft.items.push({ ci: PRICING.indexOf(row), qty: 1 }); saveOrder(); };
  sell('050-1110001'); sell('0501110001'); sell('+972 50-111-0001');
  const cs = Store.get('customers') || [];
  out.custs = cs.map((c) => c.phone);
  out.phones = (Store.get('orders') || []).map((o) => o.phone);
  out.ledger = cs[0] ? customerLedger(cs[0]).rows.length : 0;
  // a number from abroad is kept as typed, and is its own customer
  sell('+44 7700 900123');
  out.abroad = (Store.get('customers') || []).map((c) => c.phone);
  Store.set('orders', []); Store.set('customers', []); Store.set('inventory', []); Store.set('inv_log', []);
  return out;
}, SELFTEST);

const N = (s, k) => (s || {})[k];
check('the price-list row the checks use is there', r.row === true, r.row);
if (r.row) {
  check('a sale with a 150A board takes the 150A board, not the 60A', N(r.paidA, 'BMS DALY 13S 48V 150A') === 4 && N(r.paidA, 'BMS DALY 13S 48V 60A') === 5 && N(r.paidA, 'תאי EVE 21700 50E') === 948, r.paidA);
  check('…with none picked, the 48V default (60A) still is', N(r.paidN, 'BMS DALY 13S 48V 60A') === 4 && N(r.paidN, 'תאי EVE 21700 50E') === 896, r.paidN);
  check('a paid sale edited to two packs takes the second pack\'s cells and board', N(r.twice.shelf, 'תאי EVE 21700 50E') === 844 && N(r.twice.shelf, 'BMS DALY 13S 48V 150A') === 3, r.twice);
  check('…and says what it took', /ירד מהמלאי/.test(r.twice.said), r.twice.said);
  check('an edit of the phone alone moves nothing', JSON.stringify(r.phone.shelf) === JSON.stringify(r.twice.shelf) && !/מלאי/.test(r.phone.said), r.phone);
  check('back to one pack gives the second back', N(r.once.shelf, 'תאי EVE 21700 50E') === 896 && N(r.once.shelf, 'BMS DALY 13S 48V 150A') === 4 && /הוחזר למלאי/.test(r.once.said), r.once);
  check('…and the sale keeps what it took now', Array.isArray(r.recordA) && r.recordA.length === 2 && r.recordA.every((x) => x.qty === (x.name === 'תאי EVE 21700 50E' ? 52 : 1)), r.recordA);
  check('deleting it gives back its cells and its board, and the question says so', r.goneA && N(r.deleted, 'תאי EVE 21700 50E') === 948 && N(r.deleted, 'BMS DALY 13S 48V 150A') === 5 && /יחזור אליו/.test(r.deleteSaid), [r.deleted, r.deleteSaid]);
  check('the pace of use nets out what was given back', r.negLog && r.pace.b150 === 0 && r.pace.cells === 52, r.pace);
  check('a sale stocked before its rows were kept is not moved by an edit, and says so', !r.oldMoved && /לפני שנשמר מה ירד/.test(r.oldEdit.said), r.oldEdit.said);
  check('…nor by its deletion, and the question says so', !r.oldDeleted && /המלאי לא ישתנה/.test(r.oldSaid), r.oldSaid);
  check('one number typed three ways is one customer', r.custs.length === 1 && r.custs[0] === '050-1110001', r.custs);
  check('…and each sale is filed under the customer\'s spelling, so all three are in his history', r.phones.every((p) => p === '050-1110001') && r.ledger === 3, [r.phones, r.ledger]);
  check('a number from abroad is kept as typed, as its own customer', r.abroad.length === 2 && r.abroad.includes('+44 7700 900123'), r.abroad);
}
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
await browser.close();
srv.close();
process.exit(finish());
