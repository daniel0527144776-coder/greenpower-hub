// The datasheet card of each cell in stock (2026-10-08).
//
//   node test/test-cell-sheet.mjs
//   node test/test-cell-sheet.mjs --selftest     (no cell is matched to a sheet — must fail)
//
// Daniel: "תן מפרט טכני מלא של כל תא שנמצא במלאי של התאים"; he chose a card on each cell in stock.
// What must hold: a cell on the shelf, named however he typed it, gets a 📄 מפרט button; the card
// carries the maker's figures (the 50PL's ≤7mΩ, 125A and its 2-second 180A pulse; the 50E's 15A
// "not for cycle life"); a figure the sheet does not state says so; a cell with no sheet from its
// maker says that and shows only the calculator's sizes; nothing that is not a cell gets a button;
// and no native dialog is raised.
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
await new Promise((r) => srv.listen(4377, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4377/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.openCellSheet === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.cellSheetFor = () => null; });

const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  Store.set('inventory', [
    { id: 'i1', name: 'תא 21700 EVE 50PL', cat: 'תא', qty: 120 },
    { id: 'i2', name: 'תא 21700 EVE 50E', cat: 'תא', qty: 300 },
    { id: 'i3', name: 'תא 18650 EVE 26V', cat: 'תא', qty: 40 },
    { id: 'i4', name: 'תא 18650 Ampace JP30', cat: 'תא', qty: 20 },
    { id: 'i5', name: 'BMS 13S 60A', cat: 'BMS', qty: 4 },
  ]);
  navigateTo('inventory');
  INV_OPEN.add('תא'); INV_OPEN.add('BMS'); renderInventory();
  const btns = [...document.querySelectorAll('#inventoryList [data-cell-sheet]')].map((b) => b.getAttribute('onclick'));
  const card = (id) => {
    openCellSheet(id);
    const body = document.getElementById('modalBody');
    const rows = Object.fromEntries([...body.querySelectorAll('[data-cell-row]')].map((td) => [td.dataset.cellRow, td.textContent]));
    const out = { title: document.getElementById('modalTitle').textContent, rows, text: body.textContent, noSheet: !!body.querySelector('[data-no-sheet]') };
    closeModal();
    return out;
  };
  return { btns, pl: card('i1'), e: card('i2'), v26: card('i3'), jp: card('i4') };
});
check('every cell with a known model gets a 📄 מפרט button, and the BMS none',
  r.btns.length === 4 && r.btns.every((b) => /^openCellSheet\('i[1-4]'\)$/.test(b)), r.btns);
check('the 50PL card: ≤7mΩ, 125A with its temperature cut-off, and the 2-second 180A pulse',
  /EVE INR21700\/50PL/.test(r.pl.title) && r.pl.rows['התנגדות פנימית'] === '≤7mΩ (AC 1kHz)'
  && /^125A \(25C\)/.test(r.pl.rows['פריקה מקסימלית'] || '') && /75°C/.test(r.pl.rows['פריקה מקסימלית'] || '')
  && r.pl.rows['זרם שיא (פולס)'] === '180A (36C) למשך 2 שניות', r.pl);
check('a figure the sheet does not state says so (the 50PL has no cycle clause)', r.pl.rows['מחזורים'] === 'לא מופיע בדאטה-שיט', r.pl.rows['מחזורים']);
check('the 50E card: ≤18mΩ, 15A (3C) "not for cycle life", 68.0±2.0 g, and where it comes from',
  r.e.rows['התנגדות פנימית'] === '≤18mΩ (AC 1kHz)' && /^15A \(3C\).*לא לאורך חיים/.test(r.e.rows['פריקה מקסימלית'] || '')
  && r.e.rows['משקל'] === '68.0±2.0 גרם' && /מקור: דאטה-שיט של EVE/.test(r.e.text), r.e);
check('a cell with no sheet from its maker says so, and shows only the calculator\'s sizes, marked',
  r.v26.noSheet && /לא מדאטה-שיט/.test(r.v26.text) && r.v26.rows['קיבולת'] === '2.6Ah' && !('התנגדות פנימית' in r.v26.rows), r.v26);
check('the JP30 card names its source, the maker\'s own page', /Ampace JP30/.test(r.jp.title) && /אתר היצרן Ampace/.test(r.jp.text) && r.jp.rows['זרם שיא (פולס)'] === '140A למשך 5 שניות', r.jp.rows);
check('no page errors', errs.length === 0, errs);
check('no native dialogs', dialogs.length === 0, dialogs);

await browser.close();
srv.close();
process.exit(finish());
