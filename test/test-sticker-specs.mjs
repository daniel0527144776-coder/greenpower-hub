// What the sticker prints for זרם פריקה, and what it must keep printing.
//
//   node test/test-sticker-specs.mjs [--selftest]
//
// The figure is the CELLS' — capacity × C-rate — and it deliberately ignores the BMS. It
// was capped at min(cells, BMS) on 2026-08-19 and Daniel reverted it the same day: "תחזיר
// בחזרה את התיקון... אני לא רוצה לתקן אותו". This file exists so the next person to notice
// that a 60Ah CLASSIC through a DALY 30A prints 120A/180A finds a red test instead of an
// invitation. It has been found, fixed, and undone on purpose.
//
// Section 5 is unrelated and load-bearing: the safety marks must stay on the label.
//
// --selftest asserts the opposite outcome so the check can be watched failing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require_('playwright'); }
  catch { return require_('F:/מחול/Green Power/כלים-קלוד/אתר ומחירונים/GreenPowerSite-private/node_modules/playwright/index.js'); }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(4189, r));

const { check, finish } = checker();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4189/stickers.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof window.updateAllSpecs === 'function', { timeout: 20000 });

// Drive the real dropdowns and read the real label, rather than calling the helper: the
// bug was not in the arithmetic, it was that nothing applied the BMS to it.
const build = (volt, cap, cell, bms) => p.evaluate(([volt, cap, cell, bms]) => {
  const set = (id, val) => {
    const s = document.getElementById(id);
    const o = [...s.options].find((x) => x.value === val || x.text === val);
    if (!o) throw new Error(`no option ${val} in #${id}`);
    s.value = o.value; s.selectedIndex = o.index;
  };
  set('voltage-select', volt); set('capacity-select', cap);
  set('cells-select', cell); set('bms-select', bms);
  window.updateAllSpecs();
  return {
    discharge: document.getElementById('discharge-value').innerText.trim(),
    bms: document.getElementById('bms-value').innerText.trim(),
    cRate: document.getElementById('c-rate-value').innerText.trim(),
  };
}, [volt, cap, cell, bms]);

const opts = await p.evaluate(() => ({
  caps: [...document.getElementById('capacity-select').options].map((o) => o.value),
  cells: [...document.getElementById('cells-select').options].map((o) => o.value),
  volts: [...document.getElementById('voltage-select').options].map((o) => o.value),
}));
const cap = opts.caps.includes('60') ? '60' : opts.caps[Math.floor(opts.caps.length / 2)];
const volt = opts.volts.includes('72') ? '72' : opts.volts[0];
const classic = opts.cells.find((c) => c.includes('50E'));
const extreme = opts.cells.find((c) => c.includes('50PL'));
console.log(`using ${volt}V ${cap}Ah · cells ${classic} / ${extreme}\n`);

console.log('1. the figure is capacity x C-rate');
{
  // 60Ah CLASSIC = 2C/3C.
  const r = await build(volt, cap, classic, 'DALY 30A');
  check('it is the cells figure', r.discharge === (SELFTEST ? 'never' : '120A/180A'), r);
  check('the BMS is shown in full alongside it', r.bms === 'DALY 30A/90A', r.bms);
  check('the C-rate describes the cells', r.cRate === '2C/3C', r.cRate);
}

console.log('\n2. the BMS does not change it — in either direction');
{
  // A DALY 30A passes far less than the cells give; a DALY 200A far more. The printed
  // number is the same in both cases, and that is the intended behaviour.
  const small = await build(volt, cap, classic, 'DALY 30A');
  const large = await build(volt, cap, classic, 'DALY 200A');
  check('a smaller BMS does not lower it', small.discharge === '120A/180A', small);
  check('a larger BMS does not raise it', large.discharge === '120A/180A', large);
}

console.log('\n3. a different cell moves it, and only the cell does');
{
  // 60Ah of 50PL = 25C/36C.
  const r = await build(volt, cap, extreme, 'ANT 80A');
  check('the extreme cell gives its own figure', r.discharge === '1500A/2160A', r);
  const mixed = await build(volt, cap, extreme, 'JK 150A');
  check('changing only the BMS changes nothing', mixed.discharge === r.discharge, mixed);
}

console.log('\n4. a restored record recomputes it the same way');
{
  // refreshComputedSpecDisplay() runs on restored records and has its own copy of this
  // arithmetic. The two have disagreed before, and sticker history is a record of what was
  // actually printed — a restore that quietly changes the number is a falsified record.
  const r = await p.evaluate(() => {
    const el = (id) => document.getElementById(id);
    window.refreshComputedSpecDisplay(
      ['capacity-value', 'cells-value', 'bms-value'].map((id) => ({ id, innerHTML: el(id).innerHTML })));
    return el('discharge-value').innerText.trim();
  });
  check('the restore path agrees with the build path', r === '1500A/2160A', r);
}

console.log('\n4a. Tenpower prints as TP, at the size of the rest');
{
  // Daniel, 2026-10-18: "בתאים של 10 power במדבקות … תעשה TP". "Tenpower 21700 50SG" was the one
  // value too long for its row, so fitValueSpansToRow shrank it below every other value.
  const tp = opts.cells.find((c) => c.includes('50SG'));
  const size = () => p.evaluate(() => {
    const e = document.getElementById('cells-value');
    return { text: e.innerText.trim(), px: parseFloat(getComputedStyle(e).fontSize) };
  });
  await build(volt, cap, classic, 'DALY 30A');
  const e50 = await size();
  await build(volt, cap, tp, 'DALY 30A');
  const sg = await size();
  check('the label says TP 21700 50SG', sg.text === (SELFTEST ? tp : 'TP 21700 50SG'), sg);
  // The row is shared with a flex sibling, so a pixel either way follows the other value's width;
  // the full name printed at 18px where the 50E prints at 25-26.
  check('at the size the 50E prints (within the pixel its row-mate takes)', Math.abs(sg.px - e50.px) <= 1 && sg.px >= 24, [sg, e50]);
  // A label saved as TP restores the editor to the Tenpower option, not to the default 50E.
  await build(volt, cap, classic, 'DALY 30A');
  const back = await p.evaluate(() => {
    window.syncDropdownsFromElements([{ id: 'cells-value', innerHTML: 'TP 21700 50SG' }]);
    return document.getElementById('cells-select').value;
  });
  check('a saved TP label restores the Tenpower option', back === tp, back);
}

console.log('\n4b. the 18650s, each computed from its own sheet');
{
  // Daniel, 2026-10-17: "ואין אפשרות ל-18650 ... שיהיה גם את התאים של ה-18650 גם כן במדבקות, שיחשב
  // אותם". 25P: 30A on 2.5Ah = 12C, no pulse on the sheet, printed once. JP30: 36A on 3.0Ah = 12C, 140A
  // for 5s = 46C. 26V and 35V: 3C continuous (the distributors'), peak his: 4C and 5C.
  const has = ['EVE 18650 26V', 'EVE 18650 35V', 'EVE 18650 25P', 'Ampace 18650 JP30'].every((c) => opts.cells.includes(c));
  check('the editor offers the four 18650s', has, opts.cells);
  if (has) {
    const p25 = await build(volt, '20', 'EVE 18650 25P', 'DALY 60A');
    check('25P 20Ah: 12C, 240A', p25.cRate === (SELFTEST ? 'never' : '12C') && p25.discharge === '240A', p25);
    const jp = await build(volt, '30', 'Ampace 18650 JP30', 'DALY 60A');
    check('JP30 30Ah: 12C/46C, 360A/1380A', jp.cRate === '12C/46C' && jp.discharge === '360A/1380A', jp);
    const v26 = await build(volt, '25', 'EVE 18650 26V', 'DALY 60A');
    const v35 = await build(volt, '35', 'EVE 18650 35V', 'DALY 60A');
    check('26V 25Ah: 3C/4C, 75A/100A; 35V 35Ah: 3C/5C, 105A/175A',
      v26.cRate === '3C/4C' && v26.discharge === '75A/100A' && v35.cRate === '3C/5C' && v35.discharge === '105A/175A', [v26, v35]);
    const sku = await p.evaluate(() => document.getElementById('sku-value').innerText.trim());
    check('and the SKU names the cell', /-35V-\d+$/.test(sku), sku);
    await build(volt, '30', 'Ampace 18650 JP30', 'DALY 60A');
    const back = await p.evaluate(() => {
      const el = (id) => document.getElementById(id);
      window.refreshComputedSpecDisplay(['capacity-value', 'cells-value', 'bms-value'].map((id) => ({ id, innerHTML: el(id).innerHTML })));
      return el('discharge-value').innerText.trim();
    });
    check('a restored JP30 record recomputes the same', back === '360A/1380A', back);
  }
  // And the hub sends them: an 18650 sale line names its cell ("13S10P EVE 26V"), and a line with only the
  // tier and 18650 takes the scooter rows' cells. Every value the hub can send is one the editor offers.
  const hub = await ctx.newPage();
  await hub.goto('http://127.0.0.1:4189/index.html', { waitUntil: 'domcontentloaded' });
  await hub.waitForFunction(() => typeof stickerCellFromText === 'function', { timeout: 20000 });
  const sent = await hub.evaluate(() => ({
    line: stickerCellFromText('48V 26Ah · 13S10P EVE 26V'),
    adv: stickerCellFromText('סוללות קורקינטים 18650 - 60V ADVANCED'),
    cls: stickerCellFromText('סוללות קורקינטים 18650 - 60V CLASSIC'),
    v21: stickerCellFromText('72V 30Ah PRO'),
    all: [...Object.values(STICKER_CELLS), ...Object.values(STICKER_TIER_CELL), ...Object.values(STICKER_TIER_CELL_18650)],
  }));
  await hub.close();
  check('the hub: an 18650 line sends its own cell, not the 21700 of its tier',
    sent.line === 'EVE 18650 26V' && sent.adv === 'EVE 18650 25P' && sent.cls === 'EVE 18650 26V' && sent.v21 === 'EVE 21700 50PL', sent);
  check('and every cell the hub sends is on the editor\'s list', sent.all.every((c) => opts.cells.includes(c)), sent.all.filter((c) => !opts.cells.includes(c)));
}

console.log('\n4c. the client details are not printed, and the form says so');
{
  // The name left the label on 2026-08-18; the heading over it said "להדפסה על המדבקה" until Daniel read it
  // on 2026-10-18 and asked for "פרטי לקוח (לא מודפס)". --selftest puts the old heading back.
  const r = await p.evaluate((self) => {
    const h = [...document.querySelectorAll('h3')].find((e) => /פרטי לקוח/.test(e.textContent));
    if (self && h) h.textContent = 'פרטי לקוח (להדפסה על המדבקה)';
    document.getElementById('client-name-input').value = 'לקוח בדיקה';
    document.getElementById('client-name-input').dispatchEvent(new Event('input', { bubbles: true }));
    return { head: h ? h.textContent.trim() : '', onLabel: document.getElementById('sticker-to-capture').innerText.includes('לקוח בדיקה') };
  }, SELFTEST);
  check('the heading says the client details are not printed', r.head === 'פרטי לקוח (לא מודפס)', r.head);
  check('and the name is indeed not on the label', !r.onLabel, r);
}

console.log('\n5. the safety marks cannot be pushed off the label');
{
  // The left column had 8px of slack, and the same markup that measured +16px of clearance
  // here overflowed by 4px on a Linux runner — a difference in text metrics, not in the
  // page. The marks are what falls off, and they are the part a battery label must keep.
  // Narrowing the column reproduces wider metrics on demand: same font, one more line.
  const r = await p.evaluate(() => {
    const marks = document.getElementById('icon-placeholder-1');
    const col = marks.closest('#sticker-to-capture > div');
    const sticker = document.getElementById('sticker-to-capture');
    const tag = document.querySelector('#manufacturer-info p');
    // Unscaled, like fitSideColumn itself: the preview is painted scaled at this viewport, so
    // a raw rect difference reports 6 for a label that has 16 layout pixels of clearance. The
    // assertions only ask for >= 0 either way, but a log line that reads 6 where the renderer
    // says 16 is the kind of number someone chases for an hour.
    const state = () => {
      const rect = sticker.getBoundingClientRect();
      const scale = (rect.width && sticker.offsetWidth) ? rect.width / sticker.offsetWidth : 1;
      return {
        clearance: Math.round((rect.bottom - marks.getBoundingClientRect().bottom) / (scale || 1)),
        size: Math.round(parseFloat(getComputedStyle(tag).fontSize)),
      };
    };
    window.fitSideColumn();
    const normal = state();
    const orig = col.style.width;
    const squeezed = [0.94, 0.88, 0.82].map((pct) => {
      col.style.width = Math.round(col.clientWidth * pct) + 'px';
      window.fitSideColumn();
      const s = state();
      col.style.width = orig;
      return { pct, ...s };
    });
    window.fitSideColumn();
    return { normal, squeezed, restored: state() };
  });
  console.log(`     normal ${JSON.stringify(r.normal)}  squeezed ${JSON.stringify(r.squeezed)}`);
  // The literal 24 is gone from these three checks, and that is a real change rather than a
  // test being bent to fit. The manufacturer block used to be 15px WIDER than its column —
  // the phone line is whitespace-nowrap and simply hung out over the edge of the sticker —
  // and that stolen width is what let the tagline wrap in three lines at 24px. Fixing the
  // overflow (fitNoWrapLines) gave the block its real width back, the tagline needs four
  // lines in it, and the fitter gives back 3px so the safety marks stay on the label.
  //
  // What these checks protect is unchanged, and it is not a number: the fitter must keep the
  // designed size when it fits, shrink ONLY under pressure, and grow back when the pressure
  // lifts. 4bdc8ae shrank the whole label unconditionally and made it worse; that is the
  // regression being guarded against, not a particular font size.
  check('the marks stay on the label at rest', r.normal.clearance >= 0, r.normal);
  check('the marks stay on the label under wider metrics',
    r.squeezed.every((s) => s.clearance >= 0), r.squeezed);
  check('it is not shrinking to the floor for no reason',
    r.normal.size > Math.min(...r.squeezed.map((s) => s.size)) || r.normal.size >= 21, r);
  check('nothing stays shrunk once the pressure is gone',
    r.restored.size === r.normal.size && r.restored.clearance >= 0, r.restored);
}

console.log('\n6. every common repair on the list actually writes something');
{
  // The dropdown used to be a hand-written <option> list beside a hand-written map of texts,
  // and three of its rows — החלפת שורת תאים, תיקון שורה, החלפת תא פגום — had no entry in the
  // map at all. Choosing one and pressing הוסף filled nothing and said nothing, which is
  // indistinguishable from a working feature until you look at the label. The list is
  // generated from the map now, so this asserts the property that makes that safe: every
  // option except the placeholder and "אחר" puts text in BOTH fields.
  await p.evaluate(() => document.querySelector('.mode-button.repair-mode').click());
  await p.waitForTimeout(300);
  const r = await p.evaluate(async (selftest) => {
    const sel = document.getElementById('common-repair-select');
    const fault = document.getElementById('fault-description-input');
    const repair = document.getElementById('repair-details-input');
    const btn = document.getElementById('add-repair-btn');
    const dead = [];
    const values = [...sel.options].map((o) => o.value).filter((v) => v && v !== 'custom');
    for (const v of values) {
      fault.value = ''; repair.value = '';
      fault.dispatchEvent(new Event('input')); repair.dispatchEvent(new Event('input'));
      sel.value = selftest ? 'no_such_repair' : v;
      btn.click();
      if (!fault.value.trim() || !repair.value.trim()) dead.push(v);
    }
    fault.value = ''; repair.value = '';
    fault.dispatchEvent(new Event('input')); repair.dispatchEvent(new Event('input'));
    return { dead, count: values.length,
             named: values.includes('row_replacement') && values.includes('row_repair')
                    && values.includes('cell_replacement') };
  }, SELFTEST);
  check('the list is not empty', r.count > 20, r.count);
  check('the three rows that were dead are on it', r.named, r);
  check('and no option fills nothing', r.dead.length === 0, r.dead);
}

console.log('\n7. the repair date and the battery model cannot be pushed off the label');
{
  // Reported 2026-08-24: "if I do 2 repairs the date and the model run away from the sticker".
  // The panels' grid row was content-sized, so the text grew the column and carried the whole
  // footer past the bottom edge of a fixed 1000x500 artboard. Two invariants now: the footer
  // never moves, and the text is FITTED rather than guillotined — a repair description cut in
  // half is still a wrong label.
  const measure = () => p.evaluate(() => {
    const art = document.getElementById('sticker-to-capture').getBoundingClientRect();
    const model = document.getElementById('battery-model-display').getBoundingClientRect();
    const date = document.getElementById('repair-date-display').getBoundingClientRect();
    const body = document.getElementById('fault-description-display');
    const box = body.parentElement;
    return {
      modelBottom: Math.round(model.bottom - art.top),
      dateBottom: Math.round(date.bottom - art.top),
      art: Math.round(art.height),
      size: Math.round(parseFloat(getComputedStyle(body).fontSize)),
      clipped: box.scrollHeight > box.clientHeight + 1,
      announced: !!(window.fitRepairPanels && window.fitRepairPanels.clipped),
    };
  });
  const addRepairs = (n) => p.evaluate((n) => {
    const sel = document.getElementById('common-repair-select');
    const btn = document.getElementById('add-repair-btn');
    const values = [...sel.options].map((o) => o.value).filter((v) => v && v !== 'custom');
    for (let i = 0; i < n; i++) { sel.value = values[i % values.length]; btn.click(); }
  }, n);
  await p.evaluate(() => {
    // Unscale: the artboard is painted shrunk at 390px and every reading below would be in
    // screen pixels instead of label pixels. Same units trap that cost this file two fitters.
    const w = document.querySelector('.sticker-wrapper');
    if (w) { w.style.transform = ''; w.style.marginLeft = ''; w.style.marginBottom = ''; }
    document.getElementById('battery-model-input').value = 'TITAN 60V 20Ah';
    document.getElementById('battery-model-input').dispatchEvent(new Event('input'));
    document.getElementById('repair-date-input').value = '24/08/2026';
    document.getElementById('repair-date-input').dispatchEvent(new Event('input'));
  });
  const empty = await measure();
  check('the model line is on the label to start with', empty.modelBottom <= empty.art, empty);
  check('and it prints at the designed size', empty.size === 20, empty);

  await addRepairs(2);
  const two = await measure();
  check('two repairs do not move the date', two.dateBottom === empty.dateBottom, [empty, two]);
  check('two repairs do not move the model', two.modelBottom === empty.modelBottom, [empty, two]);
  check('and two repairs do not shrink anything either', two.size === 20, two);

  // Six is triple what was reported and still has to be fitted, not cut.
  await addRepairs(4);
  const six = await measure();
  check('six repairs still do not move the model', six.modelBottom === empty.modelBottom, [empty, six]);
  check('the text was shrunk to fit rather than cut off', six.clipped === false, six);
  check('and it did shrink — nothing else could have made it fit', six.size < 20, six);

  // Far past anything anyone would type, which is the point: the footer is not "usually"
  // safe. Past the floor the text genuinely does not fit the label, and the only wrong
  // answer there is a SILENT one — a description cut in half prints as a complete sentence
  // and nobody reading it later can tell a clause is missing.
  await addRepairs(SELFTEST ? 0 : 14);
  const many = await measure();
  check('twenty repairs still do not move the model',
    many.modelBottom === empty.modelBottom && many.modelBottom <= many.art, [empty, many]);
  check('it goes all the way to the floor before giving up', many.size === 11, many);
  check('and a cut is said out loud rather than made in silence',
    many.clipped === false || many.announced === true, many);
}

await b.close(); srv.close();
process.exit(finish());
