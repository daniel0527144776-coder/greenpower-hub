// Hebrew, English and numbers in one line (2026-10-31): the hub wraps each mixed left-to-right phrase in an isolate
// once it is drawn (BIDI in the inline script), with the same rule as the site's src/utils/bidi.ts.
//
//   node test/test-bidi.mjs [--selftest]
//
// The cases are lines the site and the hub printed shuffled; then, on the stock page, a BMS row's name and a nickel
// row's name come out isolated. The fix stays off under automation unless a page asks for it (window.__BIDI_ON__),
// so the other suites read the text as written. --selftest does not ask for it, and swaps in a function that wraps
// nothing; both checks must fail.
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
const show = (s) => s.replace(/⁦/g, '⟦').replace(/⁩/g, '⟧');

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4389, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
if (!SELFTEST) await page.addInitScript(() => { window.__BIDI_ON__ = true; });
await page.goto('http://localhost:4389/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

const CASES = [
  ['פריקה: 25C רציף (125A) / 36C פיק (180A) — פי 12.5 מתא סטנדרטי (2C · 10A לתא)', 'פריקה: 25C רציף ⟦(125A) / 36C⟧ פיק ⟦(180A)⟧ — פי 12.5 מתא סטנדרטי (⟦2C · 10A⟧ לתא)'],
  ['DALY 60-100A רציף (180-300A שיא)', '⟦DALY 60-100A⟧ רציף (⟦180-300A⟧ שיא)'],
  ['154×138×385 מ"מ', '⟦154×138×385⟧ מ"מ'],
  ['~2.6 ק"ג', '⟦~2.6⟧ ק"ג'],
  ['40+ ביקורות', '⟦40+⟧ ביקורות'],
  ['10S3P (30 תאים)', '10S3P (30 תאים)'],
  ['053-322-4879', '053-322-4879'],
  ['ראשון–חמישי 11:00–19:00', 'ראשון–חמישי 11:00–19:00'],
  ['ל-72V ו-88V', 'ל-72V ו-88V'],
];
const R = await page.evaluate(({ cases, SELF }) => {
  const iso = SELF ? (s) => s : BIDI.isolateText;
  const got = cases.map(([inp]) => iso(inp));
  Store.set('inventory', [
    { id: 'b1', name: 'BMS DALY 13S 60A', qty: 1, cat: 'BMS' },
    { id: 'n1', name: 'ניקל טהור 0.2 21700 (2S)', qty: 1, cat: 'ניקל', spec: { material: 'ניקל טהור' } },
  ]);
  navigateTo('inventory');
  ['BMS', 'ניקל'].forEach((c) => { if (!INV_OPEN.has(c)) toggleInvCat(encodeURIComponent(c)); });
  for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }
  return new Promise((res) => setTimeout(() => res({ got, titles: [...document.querySelectorAll('#inventoryList .list-item-title')].map((x) => x.textContent) }), 300));
}, { cases: CASES, SELF: SELFTEST });
const bad = CASES.map(([inp, want], i) => [inp, want, show(R.got[i])]).filter(([, want, got]) => want !== got);
check('the rule: each mixed phrase is one unit, and a phone, hours or "ל-72V" stay as written', bad.length === 0, bad);
const titles = R.titles.map(show);
check('on the stock page a BMS row and a nickel row are isolated once drawn', titles.some((x) => /⟦DALY 13S 60A⟧/.test(x)) && titles.some((x) => /⟦0\.2 21700⟧ \(2S\)|⟦0\.2 21700 \(2S\)⟧/.test(x)), titles);

if (SELFTEST) console.log('\n[selftest] the fix not asked for, and a rule that wraps nothing: the checks above must have gone red.');
await browser.close(); srv.close();
process.exit(finish());
