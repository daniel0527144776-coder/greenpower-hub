// The stock page, arranged again (2026-10-29).
//
//   node test/test-inventory-layout.mjs
//   node test/test-inventory-layout.mjs --selftest     (every group opens by itself, BMS lose their makers,
//                                                       the search finds everything, the board pick does nothing
//                                                       and the name rules are emptied)
//
// Daniel: "תסדר לי את כל המלאי בצורה הרבה יותר מסודרת אם קטגוריות ותת קטגוריות". Asked how, he chose:
//   * two levels that fold: a category opens on its groups, each with its total, and a group on its rows;
//   * one short line per row, the name opening the rest (edit, delete, threshold, note, pace);
//   * BMS by maker (DALY, JK, JBD, ANT) and then by series, a board picked from the catalogue's list in
//     the editor, so that a sale of that board finds its shelf row;
//   * a search at the top of the page.
// And the rows the old name rules left under אחר, or filed under the wrong category, go where they belong.
//
// Every name and count below is made up.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4412, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4412/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate((SELF) => {
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  init();
  if (SELF) {
    INV_GRP_OPEN.has = () => true;
    window.invBmsMaker = () => INV_NO_MAKER;
    window.invMatches = () => true;
    window.invBoardPicked = () => {};
    window.invDriveLine = () => '';
    INV_CAT_WORDS.length = 0;
    // the old rule: the first row holding every word, second-hand or not
    window.invFindRow = (inv, name) => { const want = invTokens(name); if (!want.length) return null;
      for (const row of inv) { const have = new Set(invTokens(row.name)); if (want.every((w) => have.has(w))) return row; } return null; };
  }
}, SELFTEST);

const STOCK = [
  { id: 'b1', name: 'BMS DALY 13S 48V 60A', qty: 4, cat: 'BMS' },
  { id: 'b2', name: 'BMS DALY 20S 72V 100A', qty: 2, cat: 'BMS' },
  { id: 'b3', name: 'BMS JK-BD6A20S20P', qty: 3, cat: 'BMS' },
  { id: 'b4', name: 'BMS JBD 16S 60A', qty: 0, cat: 'BMS' },
  { id: 'b5', name: 'BMS 13S 30A', qty: 5, cat: 'BMS' },
  { id: 'b6', name: 'BMS 13S 30A (יד 2)', qty: 1, cat: 'BMS' },
  { id: 'c1', name: 'מטען 60V 5A', qty: 6, cat: 'מטען' },
  { id: 'c2', name: 'מטען 72V 5A', qty: 9, cat: 'מטען' },
  { id: 'e1', name: 'תאי EVE 21700 50E', qty: 800, cat: 'תאים' },
  { id: 'e2', name: 'תאי EVE 18650 26V', qty: 300, cat: 'תאים' },
  { id: 'h1', name: 'מחזיק 21700 4P', qty: 40, cat: 'מחזיקי תאים' },
];
const OPEN_ALL = `for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }`;

// ---------------------------------------------------------------- 1. two levels that fold
const F = await page.evaluate((STOCK) => {
  // no second-hand row here: a section with one group shows it open (checked at the end of this part)
  Store.set('inventory', STOCK.filter((x) => x.id !== 'b6'));
  INV_OPEN.clear(); if (typeof INV_GRP_OPEN !== 'undefined') INV_GRP_OPEN.clear(); INV_QUERY = '';
  navigateTo('inventory');
  toggleInvCat(encodeURIComponent('BMS'));
  const grp = () => [...document.querySelectorAll('#inventoryList [data-inv-cat="BMS"] .inv-grp')].map((g) => ({
    name: g.querySelector('.inv-grp-name').textContent.trim(), total: g.lastElementChild.textContent.trim(),
    fold: g.classList.contains('inv-grp-fold'), open: g.dataset.open === '1', warn: /⚠️/.test(g.textContent) }));
  const rows = () => [...document.querySelectorAll('#inventoryList [data-inv-cat="BMS"] .list-item-title')].map((t) => t.textContent.trim());
  const closed = { groups: grp(), rows: rows() };
  // open DALY: its rows show, under their series
  document.querySelector('#inventoryList [data-inv-cat="BMS"] .inv-grp-fold[data-inv-grp="DALY"][data-open="0"]')?.click();
  const opened = { rows: rows(), series: [...document.querySelectorAll('#inventoryList [data-inv-cat="BMS"] .inv-sub span:first-child')].map((x) => x.textContent.trim()) };
  // a + re-draws the page; DALY stays open
  [...document.querySelectorAll('#inventoryList [data-inv-row="b1"] .num-btn')].find((b) => b.textContent.trim() === '+')?.click();
  const after = { rows: rows(), qty: getInventory().find((x) => x.id === 'b1').qty };
  // a category with one group alone shows it open, with no fold
  toggleInvCat(encodeURIComponent('מחזיקי תאים'));
  const single = [...document.querySelectorAll('#inventoryList [data-inv-cat="מחזיקי תאים"] .inv-grp')].map((g) => ({ fold: g.classList.contains('inv-grp-fold'), open: g.dataset.open }));
  const holderRows = [...document.querySelectorAll('#inventoryList [data-inv-cat="מחזיקי תאים"] .list-item-title')].length;
  return { closed, opened, after, single, holderRows };
}, STOCK);
check('a category opens on its groups only, and no row shows until a group is opened',
  F.closed.groups.length >= 4 && F.closed.groups.every((g) => g.fold && !g.open) && F.closed.rows.length === 0, F.closed);
check('each group carries its total', (F.closed.groups.find((g) => g.name === 'DALY') || {}).total === "6 יח'", F.closed.groups);
check('a folded group holding something out of stock says ⚠️', (F.closed.groups.find((g) => g.name === 'JBD') || {}).warn === true
  && !(F.closed.groups.find((g) => g.name === 'DALY') || {}).warn, F.closed.groups);
check('a tap opens the group on its rows, under their series', F.opened.rows.join() === 'DALY 13S 48V 60A,DALY 20S 72V 100A' && F.opened.series.join() === '13S,20S', F.opened);
check('the group stays open when a ± re-draws the page', F.after.qty === 5 && F.after.rows.join() === F.opened.rows.join(), F.after);
check('a category with one group shows it open, without a fold', F.single.length === 1 && !F.single[0].fold && F.single[0].open === '1' && F.holderRows === 1, F);

// ---------------------------------------------------------------- 2. BMS by maker, then series
const M = await page.evaluate(([OPEN_ALL, STOCK]) => {
  Store.set('inventory', STOCK);
  INV_OPEN.clear(); if (typeof INV_GRP_OPEN !== 'undefined') INV_GRP_OPEN.clear(); renderInventory();
  toggleInvCat(encodeURIComponent('BMS'));
  new Function(OPEN_ALL)();
  const box = document.querySelector('#inventoryList [data-inv-cat="BMS"]');
  const seq = [...box.querySelectorAll('[data-inv-cond], .inv-grp-name, .inv-sub > span:first-child, .list-item-title')].map((el) =>
    el.hasAttribute('data-inv-cond') ? '#' + el.dataset.invCond : el.classList.contains('inv-grp-name') ? '@' + el.textContent.trim() : el.closest('.inv-sub') ? '§' + el.textContent.trim() : el.textContent.trim());
  return seq;
}, [OPEN_ALL, STOCK]);
const cut = (from, to) => M.slice(M.indexOf(from), to ? M.indexOf(to) : undefined);
check('the makers in order: DALY, JK, JBD, ANT, then the rows that name none',
  M.filter((t) => t[0] === '@').slice(0, 4).join() === '@DALY,@JK חכם,@JBD,@ללא מותג בשם', M);
check('a JK board named "JK-BD6A20S20P" is a JK, under 20S', cut('@JK חכם', '@JBD').join() === '@JK חכם,§20S,JK-BD6A20S20P', M);
check('"BMS 13S 30A" names no maker, and waits under its own heading', cut('@ללא מותג בשם', '#used').join() === '@ללא מותג בשם,§13S,13S 30A', M);
check('second-hand stays apart, with its own maker groups', M.indexOf('#new') === 0 && M.slice(M.indexOf('#used')).join() === '#used,@ללא מותג בשם,§13S,13S 30A (יד 2)', M);

// ---------------------------------------------------------------- 3. one short line per row
const R = await page.evaluate(() => {
  INV_OPEN.clear(); if (typeof INV_GRP_OPEN !== 'undefined') INV_GRP_OPEN.clear(); renderInventory();
  toggleInvCat(encodeURIComponent('תא'));
  document.querySelector('#inventoryList [data-inv-cat="תא"] .inv-grp-fold[data-inv-grp="21700"][data-open="0"]')?.click();
  const row = document.querySelector('#inventoryList [data-inv-row="e1"]');
  if (!row) return { missing: true };
  const r = row.getBoundingClientRect();
  const out = {
    buttons: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()),
    height: Math.round(r.height),
    sheet: !!row.querySelector('[data-cell-sheet]'),
  };
  // the name opens the rest
  row.querySelector('.inv-row-name').click();
  const body = document.getElementById('modalBody'), foot = document.getElementById('modalFooter');
  out.title = document.getElementById('modalTitle').textContent;
  out.where = (body.querySelector('[data-inv-item="קטגוריה"]') || {}).textContent || '';
  out.qty = (body.querySelector('[data-inv-item="במלאי"]') || {}).textContent || '';
  out.foot = [...foot.querySelectorAll('button')].map((b) => b.textContent.trim());
  // its ✏️ opens the editor on that row
  [...foot.querySelectorAll('button')].find((b) => /ערוך/.test(b.textContent)).click();
  out.editor = document.getElementById('invName') && document.getElementById('invName').value;
  closeModal();
  // and its 🗑️ asks first, then removes it
  openInvItem('h1');
  document.querySelector('#modalFooter [data-inv-delete]').click();
  out.asked = /למחוק/.test((document.getElementById('noticeBackdrop') || {}).innerText || '') && getInventory().some((x) => x.id === 'h1');
  noticeConfirm();
  out.deleted = !getInventory().some((x) => x.id === 'h1');
  return out;
});
check('a row is one line: its − and +, and a cell\'s datasheet; no edit or delete under it',
  R.buttons.join() === '📄,−,+' && R.height < 60, R);
check('a tap on its name opens it: where it is filed and how many', R.title === 'תאי EVE 21700 50E' && /תא › 21700/.test(R.where) && /800/.test(R.qty), R);
check('…with edit, the datasheet and delete', R.foot.some((b) => /ערוך/.test(b)) && R.foot.some((b) => /מפרט/.test(b)) && R.foot.some((b) => /מחק/.test(b)), R.foot);
check('edit opens the editor on that row', R.editor === 'תאי EVE 21700 50E', R.editor);
check('delete asks, then removes the row', R.asked === true && R.deleted === true, R);

// ---------------------------------------------------------------- 4. the search
const Q = await page.evaluate(() => {
  INV_OPEN.clear(); if (typeof INV_GRP_OPEN !== 'undefined') INV_GRP_OPEN.clear(); renderInventory();
  const box = document.getElementById('invSearch');
  const type = (v) => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); };
  const titles = () => [...document.querySelectorAll('#inventoryList .list-item-title')].map((t) => t.textContent.trim());
  type('13s'); const s13 = titles();
  type('daly 20s'); const daly20 = titles();
  type('jk'); const jk = titles();
  type('xt150 שאין'); const none = { rows: titles().length, said: !!document.querySelector('#inventoryList [data-inv-none]') };
  type(''); const back = { rows: titles().length, cats: document.querySelectorAll('#inventoryList [data-inv-cat]').length };
  return { field: !!box, s13, daly20, jk, none, back };
});
check('the stock page has a search field', Q.field, Q);
check('"13s" finds the 13S boards, every fold open', Q.s13.length === 3 && Q.s13.every((t) => /13S/.test(t)), Q.s13);
check('every word must match: "daly 20s" finds the one board', Q.daly20.join() === 'DALY 20S 72V 100A', Q.daly20);
check('a maker finds its boards ("jk")', Q.jk.join() === 'JK-BD6A20S20P', Q.jk);
check('nothing found says so', Q.none.rows === 0 && Q.none.said, Q.none);
check('cleared, the page folds back to its categories', Q.back.rows === 0 && Q.back.cats >= 3, Q.back);

// ---------------------------------------------------------------- 5. a board picked from the catalogue's list
const B = await page.evaluate(() => {
  Store.set('inventory', [{ id: 'p1', name: 'BMS 13S 60A (יד 2)', qty: 2, cat: 'BMS' }, { id: 'p2', name: 'BMS 13S 60A', qty: 3, cat: 'BMS' }]);
  openInventoryEditor('p2');
  const sel = document.getElementById('invBoard');
  const groups = sel ? [...sel.querySelectorAll('optgroup')].map((g) => g.label) : [];
  const shown = sel && document.getElementById('invBoardRow').style.display !== 'none';
  sel.value = 'DALY 13S 48V 60A'; invBoardPicked();
  const name = document.getElementById('invName').value, sub = document.getElementById('invSub').value;
  saveInventory('p2');
  openInventoryEditor('p1');
  document.getElementById('invBoard').value = 'DALY 13S 48V 60A'; invBoardPicked();
  const usedName = document.getElementById('invName').value;
  closeModal();
  // the picker belongs to BMS only
  openInventoryEditor('');
  document.getElementById('invCat').value = 'מטען'; invCatChanged();
  const onCharger = document.getElementById('invBoardRow').style.display;
  closeModal();
  // a sale of that board takes it off the shelf, and a build's "BMS 13S 60A" still finds the row
  const sale = inventoryTake('DALY 13S 48V 60A', 1, 'בדיקה');
  const build = inventoryTake('BMS 13S 60A', 1, 'בדיקה');
  const left = getInventory().find((x) => x.id === 'p2').qty;
  // the second-hand row is taken when it is all there is, or when it is what was asked for
  const askedUsed = inventoryTake('BMS 13S 60A (יד 2)', 1, 'בדיקה');
  Store.set('inventory', [{ id: 'u1', name: 'BMS 16S 60A (יד 2)', qty: 1, cat: 'BMS' }]);
  const onlyUsed = inventoryTake('BMS 16S 60A', 1, 'בדיקה');
  return { groups, shown, name, sub, usedName, onCharger, sale: sale && sale.matched && sale.name, build: build && build.matched && build.name, left,
    askedUsed: askedUsed && askedUsed.matched && askedUsed.name, onlyUsed: onlyUsed && onlyUsed.matched && onlyUsed.name };
});
check('a BMS row\'s editor lists the boards the catalogue sells, by maker', B.shown && ['DALY', 'JK חכם', 'JBD', 'ANT'].every((m) => B.groups.includes(m)), B.groups);
check('picking one names the row after it, with its series', B.name === 'BMS DALY 13S 48V 60A' && B.sub === '13S', B);
check('a second-hand row keeps its "(יד 2)"', B.usedName === 'BMS DALY 13S 48V 60A (יד 2)', B.usedName);
check('the list is not offered for a charger', B.onCharger === 'none', B.onCharger);
check('a sale of "DALY 13S 48V 60A" takes it off that row', B.sale === 'BMS DALY 13S 48V 60A', B);
check('and a build\'s "BMS 13S 60A" still finds it — the new board, not the second-hand one beside it', B.build === 'BMS DALY 13S 48V 60A' && B.left === 1, B);
check('a second-hand board is taken when asked for, or when it is the only one', B.askedUsed === 'BMS 13S 60A (יד 2)' && B.onlyUsed === 'BMS 16S 60A (יד 2)', B);

// ---------------------------------------------------------------- 6. rows the name rules filed wrongly
const W = await page.evaluate(() => [
  ['72V 5A', 'מטען', '72V'], ['48V 3A XLR', 'מטען', '48V'], ['72V 10A (ללא צג)', 'מטען', '72V'],
  ['15-92.5V 0-15A WiFi (חכם)', 'מטען', 'מתח מתכוונן'], ['בקר 72V 50A', 'הנעה', 'בקרים'],
  ['Votol EM260 + כבל תכנות', 'הנעה', 'בקרים'], ['QS10-S Male+Female (סט)', 'כבלים ומחברים', 'מחברים'],
  ['מתג Silver Fish', 'כבלים ומחברים', 'פיוזים ומפסקים'], ['פיברגלס 50mm 25M', 'בידוד וכיווץ', 'סרטים ודבק'],
  ['מצופה PET 0.5mm · 70mm · 30M', 'בידוד וכיווץ', 'נייר בידוד'], ['בדיל הלחמה 1mm 500g', 'כלים וציוד', ''],
  ['DALY 16S 60V 60A', 'BMS', '16S'], ['JK B2A24S20P 200A (דגם B)', 'BMS', '24S'],
  ['JK Active Balancer 2S-24S 4A', 'כלים וציוד', ''],
].map(([name, want, wantSub]) => { const got = invCatOf({ name, cat: 'אחר' }); return { name, got, sub: invSubFromName(got, name), want, wantSub }; }));
for (const r of W) check(`"${r.name}" files under ${r.want}${r.wantSub ? ' / ' + r.wantSub : ''}`, r.got === r.want && r.sub === r.wantSub, r);

// ---------------------------------------------------------------- 7. drive parts: motors by QS model, controllers by maker
// Daniel, the same day: "במנועי QS ... זה מתחלק ל-212, 205, 260, 273 ... דרג את זה לפי מספרי דגם של ה-QS".
const D = await page.evaluate((OPEN_ALL) => {
  Store.set('inventory', [
    { id: 'm1', name: 'QS273 8000W', qty: 1 }, { id: 'm2', name: 'QS205 3000W', qty: 2 }, { id: 'm3', name: 'QS138 3000W (70H)', qty: 1 },
    { id: 'm4', name: 'QS260 12" 1500W', qty: 1 }, { id: 'k1', name: 'Far Driver ND72450', qty: 3 }, { id: 'k2', name: 'Sabvoton SVMC72150', qty: 1 },
    { id: 'k3', name: 'בקר KT 35A', qty: 2 }, { id: 'c1', name: 'QS8 זוג', qty: 4 },
  ]);
  INV_OPEN.clear(); if (typeof INV_GRP_OPEN !== 'undefined') INV_GRP_OPEN.clear(); renderInventory();
  toggleInvCat(encodeURIComponent('הנעה'));
  new Function(OPEN_ALL)();
  const box = document.querySelector('#inventoryList [data-inv-cat="הנעה"]');
  const seq = box ? [...box.querySelectorAll('.inv-grp-name, .inv-sub > span:first-child')].map((e) => (e.classList.contains('inv-grp-name') ? '@' : '§') + e.textContent.trim()) : [];
  return { seq, qs8: invCatOf({ name: 'QS8 זוג' }) };
}, OPEN_ALL);
check('motors under their QS model, the smaller number first', D.seq.join().includes('@מנועים,§QS138,§QS205,§QS260,§QS273'), D.seq);
check('controllers under their maker', D.seq.join().includes('@בקרים,§Far Driver,§Sabvoton,§KT'), D.seq);
check('a QS8 connector is a connector, not a motor', D.qs8 === 'כבלים ומחברים', D.qs8);

if (SELFTEST) console.log('\n[selftest] groups opened by themselves, makers and search and the board pick were broken, the name rules emptied; the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
await browser.close(); srv.close();
process.exit(finish());
