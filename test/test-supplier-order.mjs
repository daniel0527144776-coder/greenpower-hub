// הזמנה לספק (v471, Daniel 2026-10-18: "שהספק ידע בדיוק את מה שאני צריך, לפי ההזמנות ששלחתי בעבר").
//
//   node test/test-supplier-order.mjs
//   node test/test-supplier-order.mjs --selftest   (numbers move on every change, a line with no quantity
//                                                   goes in, the import takes his oldest list, and a photo is
//                                                   forgotten between orders — each must fail)
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
// ---- 8. the suppliers and their lists, from his WhatsApp ----
// Two Chinese suppliers with orders, one without, one Israeli chat and one unnamed Chinese number.
// Made-up numbers and names: nothing of his is in this repo either.
const WA = {
  chats: [{ id: '8611111111111@c.us', n: 'Parts A' }, { id: '8622222222222@c.us', n: 'Parts B' }, { id: '8633333333333@c.us', n: 'Quote only' },
    { id: '972500000000@c.us', n: 'לקוח' }, { id: '8644444444444@c.us', n: '' }],
  '8611111111111@c.us': [
    { at: 1000, dir: 'out', t: '1. Old item one 1pc\n2. Old item two 2pc\n3. Old item three 3pc' },
    { at: 2000, dir: 'out', t: '1. Old item one 1pc\n2. Old item two 2pc\n3. Old item three 3pc' },
    { at: 3000, dir: 'in', t: '1. Their quote 1$\n2. Their quote 2$\n3. Their quote 3$' },
    { at: 4000, dir: 'out', t: '1. Nickel pure 22.5mm H Type 2S-2kg 0.3mm  (800mm)\n\n2. PVC shrink BLU 0.3mm 260-20M\n\n3. Copper strip 25mm 0.5mm 2Kg\n4. Daly li-ion common port 16S 60A 13pc:' },
    { at: 5000, dir: 'out', t: '21. 23mm not 22.7mm' }],
  '8622222222222@c.us': [{ at: 6000, dir: 'out', t: '1. Plastic holder 21700 22.5mm  Z Type 200pc\n2. Plastic holder 21700 22.5mm  H Type 200pc\n3. Daly li-ion common port 7S 60A 4pc:' }],
  '8633333333333@c.us': [{ at: 7000, dir: 'out', t: 'Price?' }],
};
let waCalls = 0;
await page.route('https://energylabgreen.com/api/wa/history**', (route) => {
  waCalls++;
  const q = new URL(route.request().url()).searchParams;
  const body = q.get('chats') ? { chats: WA.chats } : { lines: WA[q.get('chat')] || [] };
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
});
const imp = await page.evaluate(async (SELF) => {
  if (SELF) window.soWaLists = ((real) => (lines) => real(lines).reverse())(window.soWaLists);
  Sync.token = async () => 't';
  // Parts B already has an order he is writing: the import must not touch it
  const d0 = soGet();
  d0.sups = soSups(d0).concat([{ id: 'mine', name: 'B by hand', wa: '8622222222222' }]);
  d0['cur_mine'] = { lines: [{ id: 'x1', n: 1, t: 'His own line' }] };
  soPut(d0);
  await soImportWa(); closeNotice();
  const d = soGet(), by = (wa) => soSups(d).find((s) => s.wa === wa);
  const a = by('8611111111111');
  const res = { names: soSups(d).map((s) => s.name), a: a && soCur(d, a.id), aHist: (d.hist || []).filter((h) => a && h.sup === a.id), mine: soCur(d, 'mine').lines.map((l) => l.t),
    n: soSups(d).length };
  await soImportWa(); closeNotice();
  res.again = soSups(soGet()).length; res.histAgain = (soGet().hist || []).length; res.hist1 = (d.hist || []).length;
  return res;
}, SELFTEST);
check('the named Chinese chats become suppliers; not a customer, not an unnamed number', imp.names.includes('Parts A') && imp.names.includes('Quote only') && !imp.names.includes('לקוח') && !imp.names.some((n) => !n), imp.names);
check('a supplier already there is not added twice', imp.names.filter((n) => n === 'Parts B' || n === 'B by hand').length === 1, imp.names);
check('his latest list is the open order, as sent, with its own numbers', imp.a && imp.a.lines.map((l) => l.n + '. ' + l.t).join('|') === '1. Nickel pure 22.5mm H Type 2S-2kg 0.3mm (800mm)|2. PVC shrink BLU 0.3mm 260-20M|3. Copper strip 25mm 0.5mm 2Kg|4. Daly li-ion common port 16S 60A 13pc:' && imp.a.sent && imp.a.sent.at === 4000, imp.a && imp.a.lines.map((l) => l.t));
check('the list before it is in the history once; the quote the supplier sent is not his list', imp.aHist.length === 1 && imp.aHist[0].at === 2000, imp.aHist.map((h) => h.at));
check('an order he is writing is left alone', imp.mine.join() === 'His own line', imp.mine);
check('run twice, it adds nothing', imp.again === imp.n && imp.histAgain === imp.hist1, [imp.n, imp.again, imp.hist1, imp.histAgain]);
// ---- 9. the formal order, as a PDF the bot builds and sends ----
// A photo is picked from the supplier's own chat (as text: WhatsApp's small picture), remembered for the item,
// and only its id goes to the bot, which fetches it itself. --selftest forgets the item between orders.
const adminCalls = [];
await page.route('https://energylabgreen.com/api/wa/admin**', (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  adminCalls.push(body);
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, pages: 2, images: 1, bytes: 9 }) });
});
await page.unroute('https://energylabgreen.com/api/wa/history**');
await page.route('https://energylabgreen.com/api/wa/history**', (route) => {
  const q = new URL(route.request().url()).searchParams;
  const media = [{ id: 'PHOTO_A', at: 9000, kind: 'image', dir: 'in', th: '/9j/4AAQSkZJRg==' }, { id: 'PHOTO_B', at: 8000, kind: 'image', dir: 'out', th: '"><img src=x onerror=alert(1)>' }];
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(q.get('chats') ? { chats: [] } : { media }) });
});
const pick = await page.evaluate(async (SELF) => {
  if (SELF) window.soPhotoKey = () => String(Math.random());
  const d = soGet(), a = soSups(d).find((s) => s.wa === '8611111111111');
  d.pick = a.id; soPut(d); renderSorder();
  const line = soCur(soGet(), a.id).lines[0];
  await soPickPhoto(line.id);
  const shown = document.querySelectorAll('#soPhotoBox button img').length, injected = !!document.querySelector('#soPhotoBox img[onerror]');
  soSetImg(0);
  const d2 = soGet(), c = soCur(d2, a.id);
  // the same item again, another quantity: it carries the photo by itself
  c.lines.push({ id: 'again', n: 99, t: line.t.replace(/2kg/i, '5kg') });
  return { shown, injected, img: c.lines[0].img, again: soLineImg(d2, a.id, c.lines[c.lines.length - 1]), other: soLineImg(d2, a.id, c.lines[1]) };
}, SELFTEST);
check('the photos of that chat are offered, as text pictures; one carrying markup is not drawn', pick.shown === 1 && !pick.injected, pick);
check('the picked photo becomes the line photo', pick.img === 'PHOTO_A', pick.img);
check('and the same item ordered again carries it by itself; another item does not', pick.again === 'PHOTO_A' && pick.other === '', pick);
const poRes = await page.evaluate(async () => {
  const d = soGet(), a = soSups(d).find((s) => s.wa === '8611111111111');
  soEditShip(null); document.getElementById('soShipLabel').value = 'אלעד'; document.getElementById('soShipText').value = 'SHIP LINE 1\nSHIP LINE 2'; soSaveShip(null);
  soSetOpt('ship', soGet().ships.slice(-1)[0].id);
  soSendPo(); noticeConfirm();
  await new Promise((r) => setTimeout(r, 300));
  const c = soCur(soGet(), a.id);
  return { notice: document.getElementById('noticeBody').textContent, sent: !!(c.sent && c.sent.at > 5000), no: c.poNo };
});
const call = adminCalls.find((x) => x.op === 'po') || {};
check("one call to the bot: the supplier's number and every line, in his words", call.to === '8611111111111' && call.po && call.po.lines.length >= 4 && call.po.lines[0].t.startsWith('Nickel pure 22.5mm H Type'), call.po && call.po.lines.map((l) => l.t));
check('the photo goes as its id only; a line without one goes without', call.po && call.po.lines[0].img === 'PHOTO_A' && call.po.lines.some((l) => !l.img) && !JSON.stringify(call).includes('base64'), call.po && call.po.lines.map((l) => l.img));
check('PayPal and DHL unless he picks otherwise, and the ship-to block he chose', call.po && call.po.pay === 'PayPal' && call.po.via === 'DHL Express' && call.po.shipTo === 'SHIP LINE 1\nSHIP LINE 2', call.po);
check('an order number of the day, kept on the order', /^GP-\d{6}-\d{2}$/.test(call.po && call.po.no) && poRes.no === call.po.no, [call.po && call.po.no, poRes.no]);
check('and the order counts as sent', poRes.sent && /נשלחה/.test(poRes.notice), poRes);
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
