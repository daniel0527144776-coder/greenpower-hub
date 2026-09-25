import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { checker } from './diag.mjs';
const { check, finish } = checker();
const SELFTEST = process.argv.includes('--selftest');

const DIST = path.join(process.cwd(), 'dist');
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4214, r));

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 1200 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4214/index.html');

const out = await p.evaluate(() => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  navigateTo('catalog');
  const banners = [...document.querySelectorAll('#page-catalog .price-series')].map((x) => x.textContent.trim());
  const cats = [...document.querySelectorAll('#page-catalog .price-cat')].map((x) => x.textContent.trim());
  // the index invariant: clicking category N must open category N
  const before = cats[3];
  toggleCatCat(3);
  const after = [...document.querySelectorAll('#page-catalog .price-cat')].map((x) => x.textContent.trim());
  const opened = after.find((x) => x.startsWith('▾'));
  return { banners, catCount: cats.length, clicked: before, opened,
           notes: [...document.querySelectorAll('.info-banner:not([id])')].filter((el) => !el.querySelector('button, [id]')).length,
           tucked: [...document.querySelectorAll('.info-banner[data-note]')].filter((x) => x.style.display === 'none').length,
           icons: document.querySelectorAll('[title="הסבר"]').length };
});
check('the price list is grouped by topic, not by battery tier', out.banners.length >= 7 && !out.banners.some((x) => /CLASSIC|ADVANCED|ללא סדרה/.test(x)), out.banners.join(' | '));
// Every category must sit under a heading. The rest bucket exists so a category added later
// cannot fall off the list silently - the way the WhatsApp feed lost powertools and cells -
// but nothing should be in it today.
check('every category found a topic', out.catCount >= 60, String(out.catCount));
check('and none fell into the rest bucket', !out.banners.some((x) => x.includes('שאר הפריטים')), out.banners.join(' | '));
// toggleCatCat addresses a category by INDEX. Reordering the render without reordering
// catCatKeys opens a different category than the one pressed, silently.
check('clicking a category opens that category', out.opened === out.clicked.replace('▸', '▾'), out.clicked + ' -> ' + out.opened);
// Explanations behind an icon, and reachable: hiding text with no way back is worse than
// the row it was costing.
// Since 2026-09-25 explanations are not shown at all (Daniel: "תסיר את ההסברים באייקון").
check('no explanation notes are shown', out.notes === 0, String(out.notes));
check('and no ⓘ icons are left behind', out.icons === 0, String(out.icons));
check('no JS errors', errs.length === 0, errs.join(' | '));
if (SELFTEST) check('(selftest) deliberate', false, 'x');
await b.close(); srv.close();
process.exit(finish());