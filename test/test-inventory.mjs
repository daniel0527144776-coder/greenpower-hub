// Stock that moves by itself, 2026-09-01.
//
//   node test/test-inventory.mjs
//   node test/test-inventory.mjs --selftest
//
// A wrong deduction is worse than none: it is silent, it compounds, and the figure keeps being
// trusted. So the checks here are mostly about what must NOT happen — no double-deduct, no
// near-miss match, no re-seed over work already done.
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
await new Promise((r) => srv.listen(4219, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4219/index.html');
await page.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
});
await page.waitForTimeout(200);

// ---- 1. a new device does not set the cell counts back (2026-10-29) ----
// The cell seed of 2026-09-01 held its "done" flag in the device's localStorage, so the first start on
// a new phone — after the cloud pull, which had brought the real counts — set the seven cell rows back
// to the September figures, stamped them newest, and the sync took them to every device. The day he
// changed phones. Here: the account's synced flags are all there, the device's own storage is empty,
// and the shelf holds counts that are not September's. The boot steps must leave every one of them.
const fresh = await page.evaluate((st) => {
  localStorage.removeItem('gp_inv_seed_20260901');
  Store.set('settings', { invSeedBMS2026: true, cellModelsRestored20260925: true, nickelSeed20261011: true, qsTidy20260925: true });
  const shelf = [
    { id: 'k1', name: 'תאי EVE 21700 50E', qty: 1830, low: 300, cat: 'תאים' },
    { id: 'k2', name: 'תאי Tenpower 21700 50SG', qty: 1412, low: 300, cat: 'תאים' },
    { id: 'k3', name: 'תאי EVE 21700 50PL', qty: 96, low: 120, cat: 'תאים' },
    { id: 'k4', name: 'תאי EVE 21700 40P', qty: 18, low: 20, cat: 'תאים' },
    { id: 'k5', name: 'תאי EVE 18650 35V', qty: 140, low: 50, cat: 'תאים' },
    { id: 'k6', name: 'תאי EVE 18650 26V', qty: 212, low: 50, cat: 'תאים' },
    { id: 'k7', name: 'תאי EVE 18650 25P', qty: 64, low: 30, cat: 'תאים' },
    { id: 'x', name: 'ניקל 0.15', qty: 42, low: 5 },
  ];
  Store.set('inventory', shelf);
  if (typeof bootSeeds === 'function') bootSeeds();
  else { seedInventoryOnce(); seedCellStockOnce(); restoreMissingCellModels(); seedNickelStockOnce(); refileCellsFromBms(); tidyQsSupplierOnce(); }
  // --selftest: the September seed back in the boot steps
  if (st) for (const s of INV_SEED) { const inv = getInventory(); const r = invFindRow(inv, s.name); if (r) { r.qty = s.qty; Store.set('inventory', inv); } }
  if (typeof closeNotice === 'function') closeNotice();
  const inv = getInventory();
  const moved = shelf.filter((s) => (inv.find((r) => r.id === s.id) || {}).qty !== s.qty).map((s) => s.name + ' ' + s.qty + '→' + (inv.find((r) => r.id === s.id) || {}).qty);
  return { moved, boot: String(startApp).includes('bootSeeds()'), seed: typeof seedCellStockOnce };
}, SELFTEST);
check('a new device keeps every count the cloud brought (no row set back to 2026-09-01)', fresh.moved.length === 0, fresh.moved);
check('and the app starts through those same boot steps, with no per-device seed left', fresh.boot && fresh.seed === 'undefined', fresh);

// ---- 2. the Samsung 50S goes onto the shelf: 300, once per account (Daniel, 2026-10-29) ----
const s50 = await page.evaluate(() => {
  const flag = () => { const s = Store.get('settings') || {}; delete s.cell50sSeed20261029; Store.set('settings', s); };
  const rows50 = () => getInventory().filter((r) => /50S(?![A-Za-z0-9])/i.test(r.name));
  flag();
  Store.set('inventory', [{ id: 'k2', name: 'תאי Tenpower 21700 50SG', qty: 1412, cat: 'תאים' }]);
  Store.set('tomb_inventory', {});                      // the row section 1's boot added was just removed
  seedCell50sOnce();
  const first = rows50().map((r) => ({ id: r.id, name: r.name, qty: r.qty, cat: invCatOf(r) }));
  const inv = getInventory(); inv.find((r) => r.id === 'cell50s_20261029').qty = 260; Store.set('inventory', inv);
  seedCell50sOnce();                                    // the account's flag is set: nothing moves
  const again = rows50().map((r) => r.qty);
  flag(); seedCell50sOnce();                            // a device without the flag: the row is there by id
  const twice = rows50().length;
  flag(); Store.set('inventory', [{ id: 'm', name: 'Samsung 50S', qty: 40, cat: 'תא' }]); seedCell50sOnce();
  const named = rows50().map((r) => r.id + ':' + r.qty);
  flag(); Store.set('inventory', []); Store.set('tomb_inventory', { cell50s_20261029: Date.now() }); seedCell50sOnce();
  const deleted = rows50().length;
  Store.set('tomb_inventory', {});
  return { first, again, twice, named, deleted };
});
check('one row, "תאי Samsung 21700 50S", 300 cells, under the cells', s50.first.length === 1 && s50.first[0].qty === 300 && s50.first[0].cat === 'תא'
  && s50.first[0].name === 'תאי Samsung 21700 50S', s50.first);
check('the 50SG is not taken for it', s50.first.length === 1, s50.first);
check('a count he changed is his: a second start does not set it back to 300', s50.again.length === 1 && s50.again[0] === 260, s50.again);
check('and a device without the flag adds no second row', s50.twice === 1, s50.twice);
check('a row that already names the 50S is left as it is', s50.named.length === 1 && s50.named[0] === 'm:40', s50.named);
check('a row he deleted does not come back', s50.deleted === 0, s50.deleted);

// ---- 3. a BMS comes off the shelf, matched by SERIES ----
const bms = await page.evaluate(() => {
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  inv.push({ id: 'b1', name: 'BMS 20S 100A', qty: 9, cat: 'BMS' });
  inv.push({ id: 'b2', name: 'BMS 16S 60A', qty: 10, cat: 'BMS' });
  localStorage.setItem('gp_inventory', JSON.stringify(inv));
  // 72V is 20S. The shelf never mentions the brand.
  const hit = inventoryTake(`BMS ${seriesForV(72)}S 100A`, 1, 'בדיקה');
  const after = JSON.parse(localStorage.getItem('gp_inventory'));
  return {
    matched: hit && hit.matched,
    left: (after.find((i) => i.name === 'BMS 20S 100A') || {}).qty,
    other: (after.find((i) => i.name === 'BMS 16S 60A') || {}).qty,
    unknown: (inventoryTake('BMS 99S 999A', 1, 'x') || {}).matched,
  };
});
check('a build takes its BMS by series', bms.matched && bms.left === 8, `left ${bms.left}`);
check('and leaves the other sizes alone', bms.other === 10, String(bms.other));
check('a BMS not on the shelf is reported, not guessed', bms.unknown === false, String(bms.unknown));

// ---- 4. the matcher will not settle for nearly ----
// The whole risk of matching by name: deducting the wrong voltage in silence.
const strict = await page.evaluate(() => {
  const inv = JSON.parse(localStorage.getItem('gp_inventory'));
  inv.push({ id: 'c1', name: 'מטען 72V 5A', qty: 9, cat: 'מטען' });
  localStorage.setItem('gp_inventory', JSON.stringify(inv));
  const wrong = inventoryTake('מטען 60V 5A', 1, 'x');
  const right = inventoryTake('מטען 72V 5A', 1, 'x');
  return { wrong: wrong && wrong.matched, right: right && right.matched };
});
check('a 60V charger does not deduct the 72V one', strict.wrong === false, String(strict.wrong));
check('but the right one does', strict.right === true, String(strict.right));

// ---- 5. a sale moves stock, once, and only when it is money ----
const sale = await page.evaluate(() => {
  const order = { id: 'o1', customer: 'לקוח', date: new Date().toISOString(), status: 'הצעה',
    items: [{ name: 'מטען 72V 5A', cat: 'מטען', qty: 2, unit: 300 }], total: 600 };
  localStorage.setItem('gp_orders', JSON.stringify([order]));
  const before = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  // A quote is not money.
  takeOrderStock(order);
  const asQuote = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  order.status = 'שולם';
  takeOrderStock(order);
  const paid = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  takeOrderStock(order);                       // the status cycles round; must not deduct again
  const twice = JSON.parse(localStorage.getItem('gp_inventory')).find((i) => i.name === 'מטען 72V 5A').qty;
  return { before, asQuote, paid, twice, flag: !!order.stockTaken };
});
// takeOrderStock is only called when the sale IS income, so calling it on a quote is the
// caller's contract; what must hold is that the deduction happens exactly once.
check('a paid sale takes its goods', sale.paid === sale.asQuote - 2, `${sale.asQuote} -> ${sale.paid}`);
check('cycling the status again does not deduct twice', sale.twice === sale.paid, `${sale.paid} -> ${sale.twice}`);
check('and the order records that stock moved', sale.flag === true, String(sale.flag));

// ---- 6. the seeds are different functions ----
// Two of them collided on one name once, and the later definition silently won, so the cells never
// seeded at all.
const both = await page.evaluate(() => ({
  cells: typeof seedCell50sOnce === 'function',
  parts: typeof seedInventoryOnce === 'function',
  nickel: typeof seedNickelStockOnce === 'function',
}));
check('the 50S seed, the BMS seed and the nickel seed all exist', both.cells && both.parts && both.nickel, JSON.stringify(both));

// ---- 7. "תאים" and "תא" are one category ----
// (Until 2026-10-18 this section restored rows from a backup file; that button went at his request.)
await page.evaluate(() => {
  Store.set('inventory', [
    { id: 'c1', name: 'תאי EVE 21700 50E', qty: 1500, low: 300, cat: 'תאים' },
    { id: 'c3', name: 'תאי EVE 21700 50PL', qty: 220, low: 120, cat: 'תא' },
  ]);
});
const cats = await page.evaluate(() => [...new Set((Store.get('inventory') || []).map(invCatOf))]);
check('"תאים" and "תא" are one category, not two', cats.length === 1 && cats[0] === 'תא', JSON.stringify(cats));

// ---- 8. the missing cell models come back on their own; only "out of stock" is an alert ----
const auto = await page.evaluate(() => {
  const s = Store.get('settings') || {}; delete s.cellModelsRestored20260925; Store.set('settings', s);
  Store.set('inventory', [
    { id: 'x1', name: 'EVE 50E', qty: 900, low: 300, cat: 'תא' },           // named differently
    { id: 'x2', name: 'תאי Tenpower 21700 50SG', qty: 100, low: 300, cat: 'תאים' },   // LOW, not out
    { id: 'x3', name: 'תאי EVE 21700 50PL', qty: 0, low: 120, cat: 'תאים' },          // OUT
  ]);
  restoreMissingCellModels();
  closeNotice();
  const once = getInventory().length;
  restoreMissingCellModels();
  const twice = getInventory().length;
  navigateTo('inventory');
  const alert = document.getElementById('inventoryLowAlert').innerText;
  return { once, twice, fifty: getInventory().filter((r) => /50e/i.test(r.name)).length, alert };
});
check('the four missing cell models are added back', auto.once === 7, auto);
check('a model already there under another name is not duplicated', auto.fifty === 1, auto);
check('and it happens once — a second run adds nothing', auto.twice === 7, auto);
check('"out of stock" is still announced', /אזל/.test(auto.alert), auto.alert);
check('"low stock" is not', !/מלאי נמוך/.test(auto.alert), auto.alert);

// ---- 9. inside a category: chargers by voltage, cells by format, BMS by maker and then series ----
// Since 2026-10-29 the groups fold, as the categories do; the sections below open every one, as he would.
const grouped = await page.evaluate(() => {
  Store.set('inventory', [
    { id: 'g1', name: 'תאי EVE 21700 50E', qty: 10, cat: 'תאים' }, { id: 'g2', name: 'תאי EVE 18650 25P', qty: 5, cat: 'תאים' },
    { id: 'g3', name: 'BMS DALY 13S 60A', qty: 2, cat: 'BMS' }, { id: 'g4', name: 'BMS JK B2A24S20P 200A', qty: 1, cat: 'BMS' },
    { id: 'g5', name: 'מטען 60V 5A', qty: 3, cat: 'מטען' }, { id: 'g6', name: 'מטען 72V 5A', qty: 1, cat: 'מטען' },
  ]);
  navigateTo('inventory');
  ['תא', 'BMS', 'מטען'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }
  return [...document.querySelectorAll('#inventoryList .inv-grp-name, #inventoryList .inv-sub span:first-child')].map((x) => x.textContent.trim()).join(',');
});
check('BMS by maker and then series, chargers by voltage, cells by format', grouped === 'DALY,13S,JK חכם,24S,60V,72V,18650,21700', grouped);

// ---- 9b. new and second-hand never share a group (2026-10-09) ----
// Daniel: "תעשה שיד 2 וחדש ב מלאי Bms לא יהיה מעורבב". Inside BMS the second-hand board sat in the
// same 13S group as the new one, a line below it. Now: a "חדש" section with its own series groups,
// then "♻️ יד 2" with its own — no group holds both, and nothing second-hand comes before a new row.
const cond = await page.evaluate((SELF) => {
  Store.set('inventory', [
    { id: 'c1', name: 'BMS DALY 13S 60A', qty: 3, cat: 'BMS' },
    { id: 'c2', name: 'BMS DALY 13S 60A (יד 2)', qty: 2, cat: 'BMS' },
    { id: 'c3', name: 'BMS JK 24S 200A', qty: 1, cat: 'BMS' },
    { id: 'c4', name: 'BMS 20S 100A משומש', qty: 1, cat: 'BMS' },
    { id: 'c5', name: 'מטען 60V 5A', qty: 2, cat: 'מטען' },
    { id: 'c6', name: 'מטען 60V 5A (יד 2)', qty: 1, cat: 'מטען' },
  ]);
  navigateTo('inventory');
  ['BMS', 'מטען'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }
  // the old layout, for the selftest: second-hand rows back inside the new groups
  if (SELF) {
    document.querySelectorAll('#inventoryList [data-inv-cond]').forEach((h) => h.remove());
    const rows = [...document.querySelectorAll('#inventoryList .list-item')];
    const nu = rows.find((r) => /DALY 13S 60A$/.test(r.querySelector('.list-item-title').textContent.trim()));
    const old = rows.find((r) => /DALY 13S 60A \(יד 2\)/.test(r.querySelector('.list-item-title').textContent));
    if (nu && old) nu.after(old);
  }
  const seq = [...document.querySelectorAll('#inventoryList [data-inv-cond], #inventoryList .inv-grp-name, #inventoryList .inv-sub, #inventoryList .list-item-title')].map((el) =>
    el.hasAttribute('data-inv-cond') ? '#' + el.getAttribute('data-inv-cond')
      : el.classList.contains('inv-sub') ? '@' + el.firstElementChild.textContent.trim()
      : el.classList.contains('inv-grp-name') ? '@' + el.textContent.trim()
      : el.textContent.trim());
  // each series/voltage group, with the condition section it sits in (a BMS maker heads its series
  // groups and holds no row of its own, so the groups that hold rows are the ones counted)
  const groups = []; let condNow = null, g = null;
  for (const t of seq) {
    if (t[0] === '#') { condNow = t.slice(1); g = null; }
    else if (t[0] === '@') { g = { cond: condNow, head: t.slice(1), items: [] }; groups.push(g); }
    else if (g) g.items.push(t);
  }
  return { seq, groups: groups.filter((x) => x.items.length) };
}, SELFTEST);
const isUsedName = (n) => /יד\s*2|משומש/.test(n);
const mixed = cond.groups.filter((g) => g.items.some(isUsedName) && g.items.some((n) => !isUsedName(n)));
check('no BMS or charger group mixes new and second-hand', cond.groups.length >= 4 && mixed.length === 0, mixed.length ? mixed : cond.seq);
check('the new come first, under "חדש", and the second-hand after, under "יד 2"',
  cond.groups.every((g) => (g.cond === 'used') === g.items.every(isUsedName)) && cond.seq.indexOf('#new') < cond.seq.indexOf('#used'), cond.seq);
check('second-hand BMS keep their own series groups', cond.groups.filter((g) => g.cond === 'used').map((g) => g.head).join(',').startsWith('13S,20S'), cond.groups);

// ---- 10. adding an item: a sub-category can be chosen, and editing keeps the category ----
const sub = await page.evaluate(() => {
  Store.set('inventory', [{ id: 'k1', name: 'תאי EVE 21700 50E', qty: 10, cat: 'תאים' }]);
  // a new BMS whose name carries no S count — filed by the chosen sub-category
  openInventoryEditor('');
  document.getElementById('invCat').value = 'BMS'; invCatChanged();
  document.getElementById('invName').value = 'DALY חדש';
  document.getElementById('invQty').value = '4';
  document.getElementById('invSub').value = '16S';
  saveInventory('');
  // editing the old cell row must not move it into BMS
  openInventoryEditor('k1');
  const catShown = document.getElementById('invCat').value;
  saveInventory('k1');
  navigateTo('inventory');
  ['תא', 'BMS'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  return { catShown, cellCat: invCatOf(getInventory().find((x) => x.id === 'k1')),
    heads: [...document.querySelectorAll('.inv-sub span:first-child')].map((x) => x.textContent.trim()).join(',') };
});
check('a new item can be filed under a sub-category its name does not show', /16S/.test(sub.heads), sub);
check('editing a cell saved as "תאים" keeps it a cell', sub.catShown === 'תא' && sub.cellCat === 'תא', sub);

// ---- 10b. a repair's cell finds its shelf row (bug found 2026-10-04) ----
// The repair calculator names its cell "21700-50pl"; the shelf says "תאי EVE 21700 50PL". Split on
// spaces only, the whole "21700-50pl" was the tail and matched nothing, so no full build saved
// from a repair ever took a cell off the shelf. "18650-6" must still match nothing.
const rep = await page.evaluate(() => {
  Store.set('inventory', [{ id: 'r1', name: 'תאי EVE 21700 50PL', qty: 400, cat: 'תאים' },
    { id: 'r2', name: 'תאי EVE 21700 50E', qty: 2500, cat: 'תאים' }, { id: 'r3', name: 'תאי EVE 18650 25P', qty: 100, cat: 'תאים' }]);
  const pl = inventoryDeduct('21700-50pl', 64, 'בדיקה');
  const p25 = inventoryDeduct('18650-25p', 10, 'בדיקה');
  const six = inventoryDeduct('18650-6', 10, 'בדיקה');
  const inv = getInventory();
  return { pl: pl && pl.matched, p25: p25 && p25.matched, six: six && six.matched, q: inv.map((r) => r.qty) };
});
check('a repair\'s "21700-50pl" comes off "תאי EVE 21700 50PL"', rep.pl === true && rep.q[0] === 336, JSON.stringify(rep));
check('and "18650-25p" off the 18650 25P row', rep.p25 === true && rep.q[2] === 90, JSON.stringify(rep));
check('"18650-6" matches no row rather than a near one', rep.six === false && rep.q[1] === 2500, JSON.stringify(rep));

// ---- 10c. a build takes the cells it was built from (v442) ----
// Every build was divided by 5Ah, so a 13S 10Ah of 25P (2.5Ah, 13S4P = 52 cells) took 26.
const by = await page.evaluate((SELF) => {
  if (SELF) CELL_MAH['18650-25p'] = 5000;   // the old rule: every cell taken as 5Ah
  const old = jobStockParts({ jobs: ['full'], voltage: '48', capacity: '10', cellType: '18650-25p' });
  const saved = jobStockParts({ jobs: ['full'], voltage: '48', capacity: '10', cellType: '18650-25p', cells: 52 });
  const big = jobStockParts({ jobs: ['full'], voltage: '72', capacity: '30', cellType: '21700-50pl' });
  return { old: old.cells, saved: saved.cells, big: big.cells };
}, SELFTEST);
check('an 18650 build saved before v442 takes 13S4P = 52 cells, not 26', by.old === 52, JSON.stringify(by));
check('a build saved with its layout takes exactly that', by.saved === 52 && by.big === 120, JSON.stringify(by));

// ---- 10d. the Samsung 50S comes off its own row, never the 50SG's (2026-10-29) ----
// "50s" is inside "50sg": matched as a substring, a 50S build took its cells off the Tenpower 50SG
// row whenever that row came first on the shelf. A pack sold under the 50S's name is built of it.
const s50use = await page.evaluate((SELF) => {
  const realFind = window.invFindCellRow;
  if (SELF) window.invFindCellRow = (inv, m) => inv.find((i) => String(i.name).toLowerCase().includes(String(m).toLowerCase().split(/[\s\-_]+/).pop())) || null;
  Store.set('inventory', [{ id: 'q1', name: 'תאי Tenpower 21700 50SG', qty: 1412, cat: 'תאים' },
    { id: 'q2', name: 'תאי Samsung 21700 50S', qty: 300, cat: 'תאים' }]);
  const job = jobStockParts({ jobs: ['full'], voltage: '72', capacity: '30', cellType: '21700-50s' });
  const took = inventoryDeduct(job.cellModel, job.cells, 'בדיקה');
  const sale = batteryStockParts({ name: '72V 30Ah Samsung 50S', cat: 'סוללות · סדרת CLASSIC' });
  const sold = inventoryDeduct(sale.cellModel, sale.cells, 'בדיקה');
  const sg = inventoryDeduct('Tenpower 50SG', 10, 'בדיקה');
  const inv = getInventory();
  window.invFindCellRow = realFind;
  return { job, took: took && took.name, sale, sold: sold && sold.name, sg: sg && sg.name, q: inv.map((r) => r.qty) };
}, SELFTEST);
check('a repair build of "21700-50s" takes 20S6P = 120 cells off the 50S row', s50use.job.cells === 120 && s50use.took === 'תאי Samsung 21700 50S', s50use);
check('and leaves the 50SG row alone', s50use.q[0] === 1412 - 10, s50use.q);
check('a sold pack named for the 50S is built of it, at 5Ah a cell', s50use.sale.cellModel === 'Samsung 50S' && s50use.sale.cells === 120 && s50use.sold === 'תאי Samsung 21700 50S', s50use.sale);
check('the 50S row is down by both, 300 − 240', s50use.q[1] === 60, s50use.q);
check('and the 50SG still finds its own row', s50use.sg === 'תאי Tenpower 21700 50SG', s50use.sg);

// ---- 11. ordering by pace (2026-10-04, "הזמנת מלאי לפי קצב") ----
// Every automatic deduction leaves a dated line; before the log, sales and repairs are read back
// with the same decomposition that deducted them; a hand recount is not usage; and what to order
// covers the delivery time plus three months. --selftest: the deductions stop logging.
const pace = await page.evaluate((SELF) => {
  if (SELF) window.invLogUse = () => {};
  const day = 864e5, now = Date.now(), iso = (d) => new Date(now - d * day).toISOString();
  // a) a deduction is logged; a hand recount is not
  Store.set('inv_log', []);
  Store.set('inventory', [{ id: 'p1', name: 'תאי EVE 21700 50E', qty: 1000, cat: 'תאים' }, { id: 'p2', name: 'BMS 20S 100A', qty: 5, cat: 'BMS' }]);
  inventoryDeduct('EVE 50E', 120, 'בדיקה');
  inventoryTake('BMS 20S 100A', 1, 'בדיקה');
  adjustInventory('p1', -1);
  const logged = (Store.get('inv_log') || []).map((e) => [e.row, e.qty]);
  // b) before any log line, the records say what was used: a delivered 72V sale and a full build
  Store.set('inv_log', []);
  Store.set('orders', [{ id: 'o1', date: iso(20), status: 'נמסר', customer: 'x', total: 1,
    items: [{ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1, unit: 1 }] },
    { id: 'o2', date: iso(10), status: 'הצעה', customer: 'y', total: 1, items: [{ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1, unit: 1 }] }]);
  Store.set('jobs', [{ id: 'j1', date: iso(5), jobs: ['full'], voltage: '60', capacity: '20', cellType: '21700-50e', bmsBrand: 'daly', bmsAmps: '60' }]);
  const back = invUsage();
  const sale = batteryStockParts({ cat: 'סוללות אופניים - 72V CLASSIC', name: '72V 20Ah', qty: 1 });
  const job = jobStockParts(Store.get('jobs')[0]);
  // c) the forecast: 900 cells over 80 days on a shelf of 500, cells arriving in 60 days
  Store.set('orders', []); Store.set('jobs', []);
  Store.set('inventory', [{ id: 'p1', name: 'תאי EVE 21700 50E', qty: 500, cat: 'תאים' },
    { id: 'p3', name: 'מטען 72V 5A', qty: 0, cat: 'מטען' }]);
  Store.set('inv_log', [{ id: 'l1', at: iso(80), row: 'p1', name: 'תאי EVE 21700 50E', qty: 600 },
    { id: 'l2', at: iso(10), row: 'p1', name: 'תאי EVE 21700 50E', qty: 300 }]);
  const fc = invForecast(getInventory()[0]);
  const text = orderListText();
  navigateTo('inventory');
  if (!INV_OPEN.has('תא')) toggleInvCat(encodeURIComponent('תא'));
  const pageText = document.getElementById('page-inventory').innerText;
  Store.set('inv_log', []); Store.set('orders', []); Store.set('jobs', []);
  return { logged, back, saleCells: sale && sale.cells, jobCells: job.cells, fc, text, pageText };
}, SELFTEST);
check('a deduction leaves a dated usage line, a hand recount does not', JSON.stringify(pace.logged) === JSON.stringify([['p1', 120], ['p2', 1]]), JSON.stringify(pace.logged));
check('before the log, a delivered sale and a full build count as used — a quote does not',
  pace.back.used.p1 === pace.saleCells + pace.jobCells && pace.saleCells > 0 && pace.jobCells === 64, JSON.stringify(pace.back));
check('the BMS of the sale and of the build are counted on their own rows', pace.back.used.p2 === 1, JSON.stringify(pace.back.used));
check('900 cells in 80 days is ~338 a month, and 500 lasts 44 days', pace.fc && Math.abs(pace.fc.perMonth - 337.5) <= 1 && pace.fc.daysLeft === 44, JSON.stringify(pace.fc));
check('cells that will not outlast a 60-day delivery are to be ordered now', pace.fc && pace.fc.orderNow === true, JSON.stringify(pace.fc));
check('enough for the delivery plus three months, by the box of 50', pace.fc && pace.fc.want === 1200, JSON.stringify(pace.fc));
check('the order message carries the pace', /תאי EVE 21700 50E — 1200 יח׳ \(נשארו 500, יוצאים כ-33[78] בחודש\)/.test(pace.text), pace.text);
check('a row with no pace still goes on the order by the old rule', /מטען 72V 5A — 4 יח׳ \(נשארו 0\)/.test(pace.text), pace.text);
check('the shelf row says its pace and to order now', /~33[78] בחודש · מספיק לכ-6 שבועות · ⏰ להזמין עכשיו \(1200\)/.test(pace.pageText), pace.pageText.slice(0, 300));

// ---- 12. one order message per supplier (2026-10-04, "הזמנה לפי ספק") ----
// No supplier name is in the hub's code: they come from his synced price list, his per-category
// choice, or a row's own field. Chargers sit with two suppliers, so they wait for his choice.
// --selftest: every row loses its supplier.
const sup = await page.evaluate((SELF) => {
  if (SELF) window.invSupplierOf = () => '';
  Store.set('inv_log', []); Store.set('orders', []); Store.set('jobs', []);
  const st = Store.get('settings') || {}; delete st.invSupplierByCat; Store.set('settings', st);
  Store.set('supplier_prices', [
    { who: 'ספק-תאים', cat: 'ספק-תאים · 21700 · ימי', name: 'EVE 50E', ils: 7 },
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · BMS DALY', name: 'DALY 60A', ils: 50 },
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · מטענים', name: 'מטען 72V', ils: 90 },
    { who: 'ספק-אחר', cat: 'ספק-אחר · מחירון · מטענים', name: 'מטען 60V', ils: 80 },
    // a parts supplier naming the cell size without selling cells must not make cells ambiguous
    { who: 'ספק-חלקים', cat: 'ספק-חלקים · מאזני סוללות', name: 'מחזיק 21700', ils: 3 }]);
  Store.set('inventory', [
    { id: 's1', name: 'תאי EVE 21700 50E', qty: 0, low: 100, cat: 'תאים' },
    { id: 's2', name: 'BMS 20S 100A', qty: 0, cat: 'BMS' },
    { id: 's3', name: 'מטען 72V 5A', qty: 0, cat: 'מטען' },
    { id: 's4', name: 'BMS 13S 60A', qty: 0, cat: 'BMS', supplier: 'ספק-מיוחד' },
    { id: 's5', name: 'BMS 20S 60A (יד 2)', qty: 0, cat: 'BMS' }]);
  const g1 = orderGroups().map((g) => [g.supplier, g.lines.map((l) => l.name).join('+')]);
  copyOrderList();
  const modal1 = { boxes: document.querySelectorAll('[id^="orderTxt"]').length, pick: !!document.querySelector('#modalBody select, .modal select') };
  setInvCatSupplier('מטען', 'ספק-אחר');
  const g2 = orderGroups().map((g) => [g.supplier, g.lines.map((l) => l.name).join('+')]);
  const text = orderListText();
  closeModal();
  // nothing to order: a notice, not a dialog
  Store.set('inventory', [{ id: 'z', name: 'תאי EVE 21700 50E', qty: 5000, low: 10, cat: 'תאים' }]);
  copyOrderList();
  const emptyNotice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  closeNotice();
  // a nameless item: a notice too
  openInventoryEditor(''); document.getElementById('invName').value = ''; saveInventory('');
  const nameNotice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  closeNotice(); closeModal();
  // the editor stores a row's own supplier
  openInventoryEditor('z'); document.getElementById('invSupplier').value = 'ספק-מיוחד'; saveInventory('z');
  const saved = (getInventory().find((r) => r.id === 'z') || {}).supplier;
  const st2 = Store.get('settings') || {}; delete st2.invSupplierByCat; Store.set('settings', st2);
  Store.set('supplier_prices', []);
  return { g1, modal1, g2, text, emptyNotice, nameNotice, saved };
}, SELFTEST);
check('cells and BMS go to the one supplier whose list carries them; a row may name its own',
  JSON.stringify(pace && sup.g1) === JSON.stringify([['ספק-חלקים', 'BMS 20S 100A'], ['ספק-מיוחד', 'BMS 13S 60A'], ['ספק-תאים', 'תאי EVE 21700 50E'], ['', 'מטען 72V 5A']]), JSON.stringify(sup.g1));
check('second-hand stock ("יד 2") is never on an order', !JSON.stringify(sup.g1).includes('יד 2'), JSON.stringify(sup.g1));
check('chargers, carried by two suppliers, wait for his choice — one message box per supplier', sup.modal1.boxes === 4 && sup.modal1.pick, JSON.stringify(sup.modal1));
check('choosing a supplier for a category moves its rows there', JSON.stringify(sup.g2.find(([w]) => w === 'ספק-אחר')) === JSON.stringify(['ספק-אחר', 'מטען 72V 5A']) && !sup.g2.some(([w]) => w === ''), JSON.stringify(sup.g2));
check('each supplier gets its own message', /הזמנה מ-ספק-תאים:\n• תאי EVE 21700 50E/.test(sup.text) && /הזמנה מ-ספק-אחר:\n• מטען 72V 5A/.test(sup.text), sup.text);
check('"nothing to order" is said in a notice', /אין מה להזמין/.test(sup.emptyNotice), sup.emptyNotice);
check('saving an item with no name says so in a notice', /הזן שם פריט/.test(sup.nameNotice), sup.nameNotice);
check('the item editor stores a row\'s own supplier', sup.saved === 'ספק-מיוחד', String(sup.saved));

// ---- 13. חסר להזמנה (Daniel, 2026-10-05: "מקום שאני כותב איזה חלקי עבודה חסרים לי בשביל להזמין") ----
// Free text he writes down, synced row by row like the stock, and in the order message beside it.
// --selftest leaves the written lines out of the order, the way the page was before.
const need = await page.evaluate(async (SELF) => {
  if (SELF) window.needOrderLines = () => [];
  Store.set('inventory', [{ id: 'z', name: 'תאי EVE 21700 50E', qty: 5000, low: 10, cat: 'תאים' }]);
  Store.set('need_list', []);
  openNeedList();
  await new Promise((r) => setTimeout(r, 120));
  const focused = document.activeElement && document.activeElement.id;
  const put = (id, v) => { document.getElementById(id).value = v; };
  put('needText', 'ניקל 0.15'); put('needQty', '2 ק"ג'); put('needSupplier', 'ספק-חלקים');
  document.getElementById('needText').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  // The supplier stays for the next line (several parts from one supplier in a row); cleared, the line has none.
  const sticky = document.getElementById('needSupplier').value;
  put('needSupplier', ''); put('needText', 'שרינק <b>300</b>'); addNeed();
  put('needText', '   '); addNeed();
  const blankNotice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  closeNotice();
  const rows = getNeeds();
  const listHtml = document.getElementById('needList').innerHTML;
  const groups = orderGroups().map((g) => [g.supplier, g.lines.map((l) => l.name).join('+')]);
  const text = orderListText();
  copyOrderList();
  const modal = { title: (document.getElementById('modalTitle') || {}).textContent || '', wa: document.querySelectorAll('[data-wa-order]').length };
  let opened = '';
  const keep = window.openExternal; window.openExternal = (u) => { opened = u; };
  sendOrderGroup(0);
  window.openExternal = keep;
  closeModal();
  toggleNeedOrdered(rows[0].id);
  const afterOrdered = orderListText();
  const orderedRow = getNeeds().find((r) => r.id === rows[0].id);
  removeNeed(rows[1].id);
  const tomb = Store.get('tomb_need_list') || {};
  return { sticky, focused, n: rows.length, row0: rows[0], blankNotice, escaped: listHtml.includes('&lt;b&gt;300') && !listHtml.includes('<b>300'),
    groups, text, modal, opened, afterOrdered, ordered: !!(orderedRow && orderedRow.ordered), tombed: tomb[rows[1].id] != null,
    left: getNeeds().map((r) => r.text), sync: SYNC_KEYS.includes('need_list') && SYNC_KEYS.includes('tomb_need_list') && MERGE_KEYS.includes('need_list') };
}, SELFTEST);
check('the home card opens the list with the cursor in it', need.focused === 'needText', String(need.focused));
check('Enter or ➕ adds a line, with its quantity and supplier (which stays for the next); a blank one is refused in a notice',
  need.n === 2 && need.sticky === 'ספק-חלקים' && need.row0.text === 'ניקל 0.15' && need.row0.qty === '2 ק"ג' && need.row0.supplier === 'ספק-חלקים' && /כתוב מה חסר/.test(need.blankNotice), JSON.stringify([need.n, need.row0, need.blankNotice]));
check('what he types is shown as text, never as markup', need.escaped, 'escaped');
check('the written lines join "מה להזמין", in their supplier\'s message',
  /הזמנה מ-ספק-חלקים:\n• ניקל 0\.15 — 2 ק"ג/.test(need.text) && /• שרינק <b>300<\/b>/.test(need.text), need.text);
check('with nothing low on the shelf, the order still opens for them, each message with a WhatsApp button',
  /מה להזמין/.test(need.modal.title) && need.modal.wa === need.groups.length && need.groups.length === 2, JSON.stringify([need.modal, need.groups]));
check('the WhatsApp button opens wa.me with that supplier\'s message', /^https:\/\/wa\.me\/\?text=/.test(need.opened) && decodeURIComponent(need.opened.split('text=')[1] || '').includes('ניקל 0.15'), need.opened.slice(0, 80));
check('a line marked ✓ הוזמן stays on the list and leaves the order', need.ordered && !need.afterOrdered.includes('ניקל'), need.afterOrdered);
check('🗑 removes a line and leaves a tombstone, so another device does not bring it back', need.tombed && need.left.join() === 'ניקל 0.15', JSON.stringify(need.left));
check('the list syncs, row by row, with its tombstones', need.sync, 'SYNC_KEYS / MERGE_KEYS');

// ---- nickel: its own spec (2026-10-11) ----
// Daniel: "יש לכל ניקל מפרט ייחודי משלו לכן תעשה לי אפשריות שאני יוכל להזין את המפרט המדויק". A nickel row
// takes shape, material, thickness, width, cell, pitch, P and current; they are saved with the row,
// come back when the row is edited again, and show on the row as one line. Other categories get none of
// it. --selftest: saving drops the spec, the way the editor was before.
const nk = await page.evaluate((SELF) => {
  Store.set('inventory', [{ id: 'n1', name: 'ניקל 0.2', qty: 3, cat: 'ניקל' }, { id: 'b1', name: 'BMS DALY 13S 60A', qty: 1, cat: 'BMS' }]);
  navigateTo('inventory');
  const shown = () => { const el = document.getElementById('invNickelSpec'); return !!el && el.style.display !== 'none'; };
  // a new item: the block follows the category
  openInventoryEditor('');
  const atBms = shown();
  document.getElementById('invCat').value = 'ניקל'; invCatChanged();
  const atNickel = shown();
  closeModal();
  // the BMS row's editor has no nickel block showing
  openInventoryEditor('b1'); const onBms = shown(); closeModal();
  // the nickel row: its thickness starts from its name
  openInventoryEditor('n1');
  const fromName = document.getElementById('nk_thick').value;
  const set = { shape: 'W לתושבת', material: 'ניקל טהור', thick: '0.15', width: '8', cell: '21700', pitch: '22.7', p: '4', amps: '30' };
  for (const [k, v] of Object.entries(set)) document.getElementById('nk_' + k).value = v;
  if (SELF) { const real = window.readNickelSpec; window.readNickelSpec = () => null; saveInventory('n1'); window.readNickelSpec = real; }
  else saveInventory('n1');
  const row = getInventory().find((x) => x.id === 'n1');
  if (!INV_OPEN.has('ניקל')) toggleInvCat(encodeURIComponent('ניקל'));
  const line = (document.querySelector('#inventoryList [data-nickel-spec]') || {}).textContent || '';
  // edited again, the fields hold what was saved
  openInventoryEditor('n1');
  const back = Object.fromEntries(Object.keys(set).map((k) => [k, document.getElementById('nk_' + k).value]));
  closeModal();
  // emptied, the spec goes
  openInventoryEditor('n1');
  Object.keys(set).forEach((k) => { document.getElementById('nk_' + k).value = ''; });
  saveInventory('n1');
  const cleared = getInventory().find((x) => x.id === 'n1').spec;
  // a spec line with a hostile value is text, not markup
  Store.set('inventory', [{ id: 'n2', name: 'ניקל', qty: 1, cat: 'ניקל', spec: { material: '<img src=x onerror=alert(1)>' } }]);
  renderInventory();
  const escaped = !document.querySelector('#inventoryList [data-nickel-spec] img');
  return { atBms, atNickel, onBms, fromName, spec: row.spec || null, line, back, cleared, escaped };
}, SELFTEST);
check('the nickel fields show for ניקל and not for BMS', !nk.atBms && nk.atNickel && !nk.onBms, JSON.stringify([nk.atBms, nk.atNickel, nk.onBms]));
check('the thickness starts from the row\'s name ("ניקל 0.2")', nk.fromName === '0.2', nk.fromName);
check('the spec is saved with the row, numbers as numbers',
  !!nk.spec && nk.spec.thick === 0.15 && nk.spec.width === 8 && nk.spec.pitch === 22.7 && nk.spec.p === 4 && nk.spec.amps === 30
  && nk.spec.shape === 'W לתושבת' && nk.spec.material === 'ניקל טהור' && nk.spec.cell === '21700', JSON.stringify(nk.spec));
check('the row shows it as one line', /ניקל טהור/.test(nk.line) && nk.line.includes('0.15×8') && /22\.7/.test(nk.line) && nk.line.includes('4P') && nk.line.includes('30A'), nk.line);
check('edited again, every field holds what was saved', JSON.stringify(nk.back) === JSON.stringify({ shape: 'W לתושבת', material: 'ניקל טהור', thick: '0.15', width: '8', cell: '21700', pitch: '22.7', p: '4', amps: '30' }), JSON.stringify(nk.back));
check('emptying every field clears the spec', nk.cleared == null, JSON.stringify(nk.cleared));
check('a spec value is shown as text, never as markup', nk.escaped, 'escaped');

// ---- nickel by weight, and the day it last changed (2026-10-11) ----
// Daniel: "ושיהיה לפי משקל ותאריך עדכון אחרון". A ניקל row's quantity is kilograms to two decimals, ± moves
// it by 0.1, the row and its category say ק"ג, the row says when it last changed, a strip on a roll shows
// its length, and the order message asks for kilograms. A BMS row still counts whole items.
// --selftest: the editor reads the quantity as a whole number again, as every row was read before.
const kg = await page.evaluate((SELF) => {
  Store.set('inventory', [{ id: 'k1', name: 'ניקל 0.15 גליל', qty: 1, cat: 'ניקל' }, { id: 'b2', name: 'BMS DALY 13S 60A', qty: 3, low: 1, cat: 'BMS' }]);
  navigateTo('inventory');
  if (!INV_OPEN.has('ניקל')) toggleInvCat(encodeURIComponent('ניקל'));
  if (!INV_OPEN.has('BMS')) toggleInvCat(encodeURIComponent('BMS'));
  // the editor asks for kilograms, in steps of 0.1
  openInventoryEditor('k1');
  const label = document.getElementById('invQtyLabel').textContent, step = document.getElementById('invQty').step;
  document.getElementById('invQty').value = '2.4';
  document.getElementById('invLow').value = '0.5';
  Object.entries({ shape: 'פס בגליל', material: 'ניקל טהור', thick: '0.15', width: '8' }).forEach(([k, v]) => { document.getElementById('nk_' + k).value = v; });
  const realPF = window.parseFloat;
  if (SELF) window.parseFloat = (v) => parseInt(v, 10);
  saveInventory('k1');
  window.parseFloat = realPF;
  const saved = getInventory().find((x) => x.id === 'k1');
  // the row: its quantity in ק"ג, its length, the day it changed
  const nkRow = () => [...document.querySelectorAll('#inventoryList .list-item')].find((el) => /גליל/.test(el.textContent));
  const qtyText = (nkRow().querySelector('[data-inv-qty]') || {}).textContent || '';
  const metres = (nkRow().querySelector('[data-nickel-metres]') || {}).textContent || '';
  const updated = (nkRow().querySelector('[data-inv-updated]') || {}).textContent || '';
  const today = new Date().toLocaleDateString('he-IL');
  const catTotal = (document.querySelector('[data-inv-cat-total="ניקל"]') || {}).textContent || '';
  // its + button moves it by 0.1, without float dust
  [...nkRow().querySelectorAll('.num-btn')].find((b) => b.textContent.trim() === '+').click();
  const plus = getInventory().find((x) => x.id === 'k1').qty;
  const metresAfter = (nkRow().querySelector('[data-nickel-metres]') || {}).textContent || '';
  // a BMS row still counts whole items and shows no date line
  const bmsRow = [...document.querySelectorAll('#inventoryList .list-item')].find((el) => /DALY 13S/.test(el.textContent));
  [...bmsRow.querySelectorAll('.num-btn')].find((b) => b.textContent.trim() === '+').click();
  const bmsQty = getInventory().find((x) => x.id === 'b2').qty;
  const bmsAfter = [...document.querySelectorAll('#inventoryList .list-item')].find((el) => /DALY 13S/.test(el.textContent));
  const bmsDated = !!bmsAfter.querySelector('[data-inv-updated]');
  const bmsTotal = (document.querySelector('[data-inv-cat-total="BMS"]') || {}).textContent || '';
  openInventoryEditor('b2');
  const bmsLabel = document.getElementById('invQtyLabel').textContent, bmsStep = document.getElementById('invQty').step;
  closeModal();
  // a row last changed on 1 September says so; a cut piece has no length
  localStorage.setItem('gp_inventory', JSON.stringify([{ id: 'k2', name: 'ניקל W', qty: 0.3, low: 1, cat: 'ניקל', _u: new Date(2026, 8, 1, 12).getTime(),
    spec: { shape: 'W לתושבת', material: 'ניקל טהור', thick: 0.15, width: 8 } }]));
  renderInventory();
  const oldDate = (document.querySelector('#inventoryList [data-inv-updated]') || {}).textContent || '';
  const cutMetres = !!document.querySelector('#inventoryList [data-nickel-metres]');
  // 0.3 − 0.1 is 0.19999999999999998 in floating point; the shelf must say 0.2
  [...document.querySelectorAll('#inventoryList .num-btn')].find((b) => b.textContent.trim() === '−').click();
  const minus = getInventory().find((x) => x.id === 'k2').qty;
  const minusText = (document.querySelector('#inventoryList [data-inv-qty]') || {}).textContent || '';
  // the order asks for kilograms
  const order = orderListText();
  return { label, step, saved: saved.qty, low: saved.low, qtyText, metres, updated, today, catTotal, plus, metresAfter,
    bmsQty, bmsDated, bmsTotal, bmsLabel, bmsStep, oldDate, cutMetres, minus, minusText, order };
}, SELFTEST);
check('a nickel row\'s editor asks for ק"ג, to the gram', /ק"ג/.test(kg.label) && kg.step === '0.001', JSON.stringify([kg.label, kg.step]));
check('2.4 ק"ג is saved as 2.4, and the threshold as 0.5', kg.saved === 2.4 && kg.low === 0.5, JSON.stringify([kg.saved, kg.low]));
check('the row shows it as "2.4 ק"ג"', kg.qtyText.trim() === '2.4 ק"ג', kg.qtyText);
check('its category totals it in ק"ג', /^2\.4 ק"ג$/.test(kg.catTotal.trim()), kg.catTotal);
check('the + button adds 0.1 ק"ג (2.4 → 2.5)', kg.plus === 2.5, String(kg.plus));
check('the − button takes 0.1 ק"ג with no float dust (0.3 → 0.2, not 0.19999…)', kg.minus === 0.2 && kg.minusText.trim() === '0.2 ק"ג', JSON.stringify([kg.minus, kg.minusText]));
// 2.4 kg of pure nickel 0.15×8 mm: 2400 g ÷ (8.9 g/cm³ × 0.015 cm × 0.8 cm) = 22,472 cm ≈ 225 m; at 2.5 kg, 234 m
check('a strip on a roll shows its length from its weight (≈225 מ, then ≈234 מ)', /≈\s*225\s*מטר/.test(kg.metres) && /≈\s*234\s*מטר/.test(kg.metresAfter), JSON.stringify([kg.metres, kg.metresAfter]));
check('the row says it was updated today', kg.updated.includes('עודכן') && kg.updated.includes(kg.today), JSON.stringify([kg.updated, kg.today]));
check('a row last changed on 1.9.2026 says so', /עודכן\s*1\.9\.2026/.test(kg.oldDate), kg.oldDate);
check('a cut piece (W) gets no length', !kg.cutMetres, String(kg.cutMetres));
check('a BMS row still counts whole items, in יח\', with no date line', kg.bmsQty === 4 && !kg.bmsDated && /^4 יח'$/.test(kg.bmsTotal.trim())
  && !/ק"ג/.test(kg.bmsLabel) && kg.bmsStep === '1', JSON.stringify([kg.bmsQty, kg.bmsDated, kg.bmsTotal, kg.bmsLabel, kg.bmsStep]));
check('the order asks for nickel in ק"ג, with what is left', /• ניקל W — 1 ק"ג \(נשארו 0\.2\)/.test(kg.order), kg.order);

// ---- every nickel roll from his video (2026-10-11) ----
// Daniel: "עשיתי סרטון של כל הניקלים נא תעלה לי אותם למלאי". The hub adds them once (seedNickelStockOnce):
// fixed ids, so a second device adds nothing new; a row he deleted stays deleted; his own rows are kept.
// A nickel row under 3 kg goes into the order, topped back up to 3 kg ("תעשה שאם יש פחות מ 3 קילו אז יכנס
// להזמנה"), and his S marking has a field. --selftest: the seed ignores the tombstones.
const seed = await page.evaluate((SELF) => {
  if (typeof closeNotice === 'function') closeNotice();
  const st = Store.get('settings') || {}; delete st[NICKEL_SEED_FLAG]; Store.set('settings', st);
  localStorage.setItem('gp_inventory', JSON.stringify([{ id: 'mine', name: 'ניקל שלי', qty: 0.5, cat: 'ניקל' }]));
  localStorage.setItem('gp_tomb_inventory', JSON.stringify({ nk20261011_05: Date.now() }));
  const realGet = Store.get;
  if (SELF) Store.get = function (k) { return k === 'tomb_inventory' ? {} : realGet.apply(this, arguments); };
  seedNickelStockOnce();
  Store.get = realGet;
  const inv = getInventory();
  const notice = (document.getElementById('noticeBackdrop') || {}).innerText || '';
  const ids = inv.map((r) => r.id);
  // a second device: the flag has not reached it yet, the rows have
  const st2 = Store.get('settings') || {}; delete st2[NICKEL_SEED_FLAG]; Store.set('settings', st2);
  seedNickelStockOnce();
  const again = getInventory().length;
  const flagged = !!(Store.get('settings') || {})[NICKEL_SEED_FLAG];
  // the rows on the stock page
  navigateTo('inventory');
  if (!INV_OPEN.has('ניקל')) toggleInvCat(encodeURIComponent('ניקל'));
  for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }
  const lines = [...document.querySelectorAll('#inventoryList [data-nickel-spec]')].map((e) => e.textContent);
  const total = (document.querySelector('[data-inv-cat-total="ניקל"]') || {}).textContent || '';
  const qtys = [...document.querySelectorAll('#inventoryList [data-inv-qty]')].map((e) => e.textContent.trim());
  const strip = getInventory().find((r) => r.id === 'nk20261011_15');
  const metres = [...document.querySelectorAll('#inventoryList .list-item')].filter((el) => el.querySelector('[data-nickel-metres]')).map((el) => el.querySelector('[data-nickel-metres]').textContent);
  // thresholds: a nickel row with none of its own is low under 3 kg (2.5 is, 3.2 is not); a BMS keeps the item default
  const rows = [{ id: 'a', name: 'ניקל א', qty: 1, cat: 'ניקל' }, { id: 'd', name: 'ניקל ד', qty: 2.4, cat: 'ניקל' },
    { id: 'e', name: 'ניקל ה', qty: 3.2, cat: 'ניקל' }, { id: 'c', name: 'BMS 13S', qty: 1, cat: 'BMS' }];
  localStorage.setItem('gp_inventory', JSON.stringify(rows));
  const sh = invShortages();
  const low = sh.low.map((r) => r.id).sort().join();
  const order = (orderList() || []).filter((l) => !l.manual).map(orderLineText).join('\n');
  // the S field: in the editor, saved as a number, shown as "3S"
  openInventoryEditor('a');
  const hasS = !!document.getElementById('nk_s');
  if (hasS) document.getElementById('nk_s').value = '3';
  saveInventory('a');
  const sSaved = (getInventory().find((r) => r.id === 'a').spec || {}).s;
  const sLine = (document.querySelector('#inventoryList [data-nickel-spec]') || {}).textContent || '';
  return { n: inv.length, ids, notice, again, flagged, lines, total, stripQty: strip && strip.qty, metres, low, order, hasS, sSaved, sLine, qtys };
}, SELFTEST);
check('16 nickel rows are added beside his own (17 from the video, one of which he deleted)', seed.n === 17 && seed.ids.includes('mine') && !seed.ids.includes('nk20261011_05'), JSON.stringify([seed.n, seed.ids.length]));
check('the notice says how many and how much, to the gram', /16 שורות ניקל/.test(seed.notice) && /12\.294 ק"ג/.test(seed.notice), seed.notice);
check('a second device adds nothing: the same fixed ids', seed.again === 17 && seed.flagged, JSON.stringify([seed.again, seed.flagged]));
check('his "2S" rolls say 2S on the row, his "3P" ones 3P', seed.lines.some((l) => l.includes('2S')) && seed.lines.some((l) => l.includes('3P')), seed.lines.slice(0, 4).join(' | '));
check('the category totals 12.794 ק"ג (with his own 0.5)', seed.total.trim() === '12.794 ק"ג', seed.total);
check('a 24 g roll shows as 0.024 ק"ג, not 0.02', seed.qtys.includes('0.024 ק"ג') && seed.qtys.includes('0.817 ק"ג'), JSON.stringify(seed.qtys));
check('the plain 0.2×10 strip shows its length (1 kg ≈ 56 m)', seed.stripQty === 1 && seed.metres.some((m) => /≈\s*56\s*מטר/.test(m)), JSON.stringify(seed.metres));
check('a nickel row under 3 kg goes into the order (1 and 2.4 do, 3.2 does not); a BMS keeps the item default', seed.low === 'a,c,d', seed.low);
check('it is ordered back up to 3 kg in whole kilograms (2.4 → 1 ק"ג, 1 → 2 ק"ג)', /• ניקל ד — 1 ק"ג \(נשארו 2\.4\)/.test(seed.order) && /• ניקל א — 2 ק"ג \(נשארו 1\)/.test(seed.order) && !/ניקל ה/.test(seed.order), seed.order);
check('the editor has an S field, saved as a number and shown as "3S"', seed.hasS && seed.sSaved === 3 && seed.sLine.includes('3S'), JSON.stringify([seed.hasS, seed.sSaved, seed.sLine]));

check('no JS errors', errs.length === 0, errs.join(' | '));
check('and nothing asked through a dialog', dialogs.length === 0, dialogs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');

await browser.close();
srv.close();
process.exit(finish());
