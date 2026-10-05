// Folded sections (2026-10-05, Daniel: "שכל הקטגוריות יהיו מקופלות … שלא יעשה עומס על העין").
//
// The settings page is all folded; on the work-hours page the history folds and the live cards stay
// as they were — they carry ids that code hides and shows (the approvals card hides itself when
// nothing waits), and wrapped they would leave an empty section header behind. Opening a section
// shows what is in it, and folding twice changes nothing (boot runs it; a second run must not nest).
// The bot and trading pages fold through fold() and are checked in their own suites.
//
//   node test/test-folds.mjs
//   node test/test-folds.mjs --selftest   (foldStatic does nothing — must fail)
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(f);
  // --selftest: the folding itself switched off, before the page's own boot can run it
  if (SELFTEST && rel === 'index.html') body = Buffer.from(String(body).replace('function foldStatic(pageId, keepOpen = []) {', 'function foldStatic(pageId, keepOpen = []) { return;'));
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(body);
});
await new Promise((r) => srv.listen(4199, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1:4199/') ? route.continue() : route.abort()));
await page.goto('http://127.0.0.1:4199/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

const folds = (pg) => page.evaluate((pg) => [...document.querySelectorAll('#page-' + pg + ' details.fold')]
  .map((d) => ({ t: d.querySelector('.fold-title').textContent, open: d.open })), pg);
const settings = await folds('settings');
check('settings: every titled card is a folded section', settings.length === 4 && settings.every((f) => !f.open)
  && settings.map((f) => f.t).join('|') === '🏢 פרטי העסק (לחשבונית)|💵 הגדרות תמחור|💾 ניהול נתונים|🛠️ תחזוקה', settings);
const work = await folds('worktime');
check('work hours: the history folds', work.length === 1 && work[0].t === '📝 שעות אחרונות' && !work[0].open, work);
check('…and the live cards stay as they were, ids and all', await page.evaluate(() => ['shiftCard', 'punchCard', 'wageDebtCard']
  .every((id) => { const c = document.getElementById(id); return c && c.parentElement.id === 'page-worktime' && !c.closest('details'); })), '');

const shown = await page.evaluate(async () => {
  const g = document.getElementById('loginOverlay'); if (g) g.style.display = 'none';
  navigateTo('settings');
  const input = document.getElementById('bizName');
  const before = !!(input && input.checkVisibility());
  const d = input && input.closest('details.fold');
  if (d) d.open = true;
  await new Promise((r) => setTimeout(r, 50));
  return { before, after: !!(input && input.checkVisibility()), title: d ? d.querySelector('summary').textContent : '' };
});
check('a folded section hides its fields until it is opened, and shows them after', !shown.before && shown.after && /פרטי העסק/.test(shown.title), shown);

const twice = await page.evaluate(() => { foldStatic('settings'); foldStatic('worktime'); return document.querySelectorAll('details.fold details.fold').length; });
check('folding again changes nothing — no section inside a section', twice === 0 && (await folds('settings')).length === 4, twice);
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
