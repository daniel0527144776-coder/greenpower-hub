// הזמנה לספק (v471, Daniel 2026-10-18: "שהספק ידע בדיוק את מה שאני צריך, לפי ההזמנות ששלחתי בעבר").
//
//   node test/test-supplier-order.mjs
//   node test/test-supplier-order.mjs --selftest   (numbers move on every change, and a line with no
//                                                   quantity goes in — the checks on both must fail)
//
// The supplier answers by line number ("27. right?"), and he corrects by line number ("31. Cancel"),
// so the one thing that must never happen is a sent number moving. The lines must read as he writes
// them, every field a supplier came back to ask about is required, and nothing about a supplier is
// in this public file.
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
await new Promise((r) => srv.listen(4235, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4235/index.html');
await page.evaluate((SELF) => {
  document.getElementById('loginOverlay').style.display = 'none';
  localStorage.removeItem('gp_sorder'); localStorage.removeItem('gp_fs_sorder'); localStorage.removeItem('gp_need_list');
  if (typeof init === 'function') init();
  window.__opened = [];
  window.openExternal = (u) => { window.__opened.push(u); };
  if (SELF) {
    window.soRenumber = (c) => { c.lines = c.lines.filter((l) => !l.cancel); c.lines.forEach((l, i) => { l.n = i + 1; }); return c; };
  }
}, SELFTEST);

// ---- 1. where it is, and nothing of his in the file ----
const nav = await page.evaluate(() => {
  closeModal(); navigateTo('inventory');
  const tabs = [...document.querySelectorAll('#page-inventory .page-group-tabs .sub-tab')].map((e) => e.textContent);
  navigateTo('sorder');
  return { tabs, active: document.getElementById('page-sorder').classList.contains('active'), d: soGet() };
});
check('a tab beside מלאי', nav.tabs.some((t) => /הזמנה לספק/.test(t)) && nav.tabs.some((t) => /מלאי/.test(t)), nav.tabs);
check('it opens', nav.active, '');
check('a fresh hub knows no supplier and no address', !(nav.d.sups || []).length && !(nav.d.ships || []).length, JSON.stringify(nav.d));
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const a = html.indexOf('// ==== הזמנה לספק'), b = html.indexOf('function renderSorder()');
const region = html.slice(a, b) + html.slice(html.indexOf('<section id="page-sorder"'), html.indexOf('</section>', html.indexOf('<section id="page-sorder"')));
check('the code is found', a > 0 && b > a, `${a} ${b}`);
check('no phone number in the code', !/\d{9,}/.test(region), (region.match(/\d{9,}/) || [''])[0]);
check('no VAT number or street address in the code', !/\bvat\s*:|rabbi|hanasi|רבי יהודה/i.test(region), '');
const sync = await page.evaluate(() => ({ s: SYNC_KEYS.includes('sorder') && SYNC_KEYS.includes('fs_sorder'), m: MAP_KEYS.includes('sorder') }));
check('it syncs, field by field', sync.s && sync.m, sync);

// a supplier, typed in as he would
await page.evaluate(() => { soEditSup(null); document.getElementById('soSupName').value = 'Supplier A'; document.getElementById('soSupWa').value = '+1 555 0100 200'; soSaveSup(null); });

// ---- 2. a nickel line, through the form ----
await page.selectOption('#soType', 'nickel');
await page.selectOption('#soSel_shape', 'W Type');
const pW = await page.$eval('#soSel_pitch', (e) => e.value);
check('W picks its own pitch, 22.7', pW === '22.7mm', pW);
await page.selectOption('#soSel_cell', '18650');
const p18 = await page.$eval('#soSel_pitch', (e) => e.value);
check('18650 picks 19', p18 === '19mm', p18);
await page.selectOption('#soSel_cell', '21700');
await page.selectOption('#soSel_shape', 'H Type');
// no quantities yet
await page.evaluate(() => { const T = SO_TYPES[0]; soToggleVar('vars', '2S'); });
await page.click('#soAddBtn');
await page.evaluate(() => closeNotice());
const n0 = await page.evaluate(() => soCur(soGet(), soCurSup(soGet())).lines.length);
const miss = await page.$eval('#soMissing', (e) => e.textContent);
check('a line with no quantity is refused', n0 === 0, n0);
check('and it says what is missing', /כמות/.test(miss), miss);
await page.fill('#soVq_vars_2S', '2');
for (const [s, q] of [['3S', '3'], ['4S', '3']]) { await page.evaluate((s) => soToggleVar('vars', s), s); await page.fill(`#soVq_vars_${s}`, q); }
const pv = await page.$eval('#soPreview', (e) => e.textContent);
check('it reads as he writes it', pv === 'Nickel pure 23mm H Type 2S-2kg/3S-3kg/4S-3kg 0.3mm (800mm)', pv);
await page.click('#soAddBtn');

// ---- 3. a Daly and a holder ----
await page.selectOption('#soType', 'daly');
await page.selectOption('#soSel_s', '16S');
await page.selectOption('#soSel_a', '60A');
await page.fill('#soQty_qty', '10');
const pd = await page.$eval('#soPreview', (e) => e.textContent);
check('Daly: li-ion, common port', pd === 'Daly li-ion common port 16S 60A 10pc', pd);
await page.click('#soAddBtn');
await page.selectOption('#soType', 'holder');
for (const m of ['1x2', '1x3', '4x3', '5x4']) await page.evaluate((m) => soToggleVar('vars', m), m);
await page.fill('#soQty_qty', '400');
const ph = await page.$eval('#soPreview', (e) => e.textContent);
check('holder: of each model', ph === 'Plastic holder 21700 23mm 1x2/1x3/4x3/5x4 Heat diameter: 21.2 mm 400pc (Of each model)', ph);
await page.click('#soAddBtn');

// ---- 4. sent whole, with the footer and the address he chose ----
await page.evaluate(() => {
  soEditShip(null); document.getElementById('soShipLabel').value = 'בית'; document.getElementById('soShipText').value = 'NAME LINE\nSTREET LINE'; soSaveShip(null);
  const d = soGet(); soSetOpt('ship', d.ships[0].id); soSetOpt('footer', true); soSetOpt('note', 'All BMS common port');
});
await page.evaluate(() => soSend('full'));
const sent = await page.evaluate(() => window.__opened.slice(-1)[0] || '');
const m = sent.match(/^https:\/\/wa\.me\/(\d*)\?text=(.*)$/);
const txt = m ? decodeURIComponent(m[2]) : '';
check('WhatsApp opens to his supplier', m && m[1] === '15550100200', sent.slice(0, 40));
check('the numbered list', /^1\. Nickel pure 23mm H Type 2S-2kg\/3S-3kg\/4S-3kg 0\.3mm \(800mm\)\n2\. Daly li-ion common port 16S 60A 10pc\n3\. Plastic holder/.test(txt), txt.split('\n').slice(0, 3));
check('the note, then TOTAL / Shipping, then the address', /All BMS common port\n\nTOTAL:\nShipping:\n\nNAME LINE\nSTREET LINE$/.test(txt), txt.split('\n').slice(-7));

// ---- 5. after it was sent, a number never moves ----
const after = await page.evaluate(() => {
  const d = soGet(), c = soCur(d, soCurSup(d));
  soRemoveLine(c.lines[0].id);                        // the nickel: cancelled
  soForm = { type: 'free', v: { text: 'Temperature sensor for BMS DALY 10PC' }, need: null }; soAddLine();
  const d2 = soGet(), c2 = soCur(d2, soCurSup(d2));
  soEditLine(c2.lines.find((l) => l.n === 2).id);     // the Daly, back in the form
  soForm.v.qty.n = '5'; soAddLine();
  const d3 = soGet(), sup = soCurSup(d3);
  return { lines: soCur(d3, sup).lines.map((l) => [l.n, !!l.cancel]), ch: soChangesText(d3, sup), full: soFullText(d3, sup) };
});
check('the cancelled line keeps its number', JSON.stringify(after.lines) === '[[1,true],[2,false],[3,false],[4,false]]', after.lines);
check('only the changes, in his words', after.ch === '1. Cancel\n2. Daly li-ion common port 16S 60A 5pc\nAdd 4. Temperature sensor for BMS DALY 10PC', after.ch);
check('the full list marks it *cancel*', /^1\. Nickel .* \*cancel\*$/m.test(after.full), after.full.split('\n')[0]);
await page.evaluate(() => soSend('changes'));
const ch2 = await page.evaluate(() => decodeURIComponent((window.__opened.slice(-1)[0] || '').split('?text=')[1] || ''));
check('"שלח רק שינויים" sends those', ch2.startsWith('1. Cancel\n'), ch2.slice(0, 30));
// a line added and dropped before it was ever sent leaves no gap
const unsent = await page.evaluate(() => {
  soForm = { type: 'free', v: { text: 'X1' }, need: null }; soAddLine();
  soForm = { type: 'free', v: { text: 'X2' }, need: null }; soAddLine();
  const d = soGet(), c = soCur(d, soCurSup(d));
  soRemoveLine(c.lines.find((l) => l.t === 'X1').id);
  const d2 = soGet();
  return soCur(d2, soCurSup(d2)).lines.map((l) => l.n + ':' + l.t).slice(-1)[0];
});
check('an unsent line removed leaves no gap', unsent === '5:X2', unsent);

// ---- 6. a list already sent from WhatsApp, pasted in ----
const parsed = await page.evaluate(() => soParseList('1. copper-nickel busbar 2S/3S Z Type 22.5mm 0.5+0.2 2KG (800MM)\n\n3. Nickel pure 22.5mm H Type 2S-2kg  (800mm)\n20. Nickel 1kg : 15$ *cancel*\nPaid: 888$\nTOTAL:'));
check('pasted: its own numbers, gaps and all, footer left out', parsed.map((l) => l.n).join() === '1,3,20' && parsed[2].cancel && parsed[1].t === 'Nickel pure 22.5mm H Type 2S-2kg (800mm)', parsed);

// ---- 7. from "חסר להזמנה", and closed into the history ----
const need = await page.evaluate(() => {
  Store.set('need_list', [{ id: 'n1', text: 'ניקל 0.15', qty: '2 ק"ג', supplier: '', added: Date.now() }]);
  renderSorder();
  const chip = !!document.querySelector('#soNeeds .so-need');
  soFromNeed('n1'); closeNotice();
  const form = { type: soForm.type, thick: soForm.v.thick === '__other' ? soForm.v.thick_o : soForm.v.thick };
  soToggleVar('vars', '2S'); soVarQty('vars', '2S', '2'); soAddLine();
  const hidden = !document.querySelector('#soNeeds .so-need');
  return { chip, form, hidden };
});
check('his "חסר" line is offered', need.chip, '');
check('…and picks the item and the thickness it names', need.form.type === 'nickel' && need.form.thick === '0.15mm', need.form);
check('…and is not offered twice', need.hidden, '');
const done = await page.evaluate(() => {
  soDone(); noticeConfirm();
  const d = soGet();
  return { open: soCur(d, soCurSup(d)).lines.length, hist: (d.hist || []).length, ordered: !!getNeeds()[0].ordered, fields: Object.keys(d) };
});
check('done: the order goes to the history', done.open === 0 && done.hist === 1, done);
check('done: the "חסר" line it covered is marked ordered', done.ordered, '');
const again = await page.evaluate(() => { const d = soGet(); soReorder(d.hist[0].id); closeNotice(); const d2 = soGet(); return soCur(d2, soCurSup(d2)).lines.map((l) => l.n); });
check('"הזמן שוב" brings its lines back, numbered from 1', again[0] === 1 && again.length >= 4, again);
check('each supplier\'s order is its own synced field', done.fields.includes('sups') && done.fields.includes('hist'), done.fields);
// a Daly with no quantity, straight into soAddLine: still refused
const refused = await page.evaluate((SELF) => {
  if (SELF) { const real = window.soValues; window.soValues = () => { const r = real(); return { ...r, missing: [], text: r.text || r.T.line(r.out) }; }; }
  const d = soGet(), n = soCur(d, soCurSup(d)).lines.length;
  soForm = { type: 'daly', v: soDefaults('daly'), need: null }; soAddLine(); closeNotice();
  const d2 = soGet(); return soCur(d2, soCurSup(d2)).lines.length - n;
}, SELFTEST);
check('a Daly with no quantity does not go in', refused === 0, refused);
check('no JS errors', errs.length === 0, errs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
