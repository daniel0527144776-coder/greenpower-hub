// No search boxes on the hub's pages, and the cell route in ⚙️ הגדרות with the sea import as the
// default (2026-10-06).
//
//   node test/test-settings-route.mjs
//   node test/test-settings-route.mjs --selftest   (a search box back, the sea reset gone, the settings save
//                                                    rebuilt from the form — must fail)
//
// Daniel: "תמחוק את כל כלי החיפוש שיש בלוח הבקרה", and "במחירון צריך שיהיה ברירת המחדל יבוא ימי, אפשר
// לשנות לאווירי ומקומי בהגדרות". The route had been three chips on the price list, and a tap on one
// had left his phone costing every pack on the local price. Moving it surfaced an older bug: the
// settings save rebuilt the whole object from the form, so any field the form does not hold — the
// route, and the one-time flags of four migrations — was wiped by the next change to the hourly rate.
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

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const BREAK = [
  ['<div id="catalogList" class="price-list">', '<input type="text" class="form-input-wide" id="catalogSearch" placeholder="🔍 חיפוש מוצר"><div id="catalogList" class="price-list">'],
  ["    if (st.cellRouteSeaDefault) return;", '    return;'],
  ["Store.set('settings', { ...(Store.get('settings') || {}), hourly:", "Store.set('settings', { hourly:"],
];
if (SELFTEST) for (const [a, b] of BREAK) {
  if (!html.includes(a)) { console.error('selftest: cannot find ' + a.slice(0, 60)); process.exit(2); }
  html = html.replace(a, () => b);
}

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4382, r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
// his phone as it was: on the local route, from a tap on the old price-list chip, and never reset
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('gp_settings', JSON.stringify({ hourly: 180, cellRoute: 'local' }));
});
const page = await ctx.newPage();
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
const open = async () => {
  await page.goto('http://localhost:4382/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
  // init() is what runs after the login; a test browser has none, so it is called as the login would
  await page.evaluate(() => { hideLogin(); init(); closeModal(); closeNotice(); });
};
await open();

// ---- 1. no search box on any page; the three customer/number PICKERS inside forms stay, and the one
// search of לקוחות ועבודות, which he chose when the two tabs merged (2026-10-08)
const boxes = await page.evaluate(() => {
  const PICKERS = new Set(['custSearch', 'ordCustSearch', 'wbPickQ', 'ordSearch']);
  return [...document.querySelectorAll('section.page input')]
    .filter((i) => /חיפוש|חפש|🔍/.test(i.placeholder || '') || i.type === 'search')
    .map((i) => i.id).filter((id) => !PICKERS.has(id));
});
check('no page carries a search box (his call, 2026-10-06) but the one on לקוחות ועבודות (2026-10-08)', boxes.length === 0, boxes);

// ---- 2. the route: sea by default, his stale "local" reset once
const first = await page.evaluate(() => ({ route: cellRoute(), flag: (Store.get('settings') || {}).cellRouteSeaDefault, hourly: (Store.get('settings') || {}).hourly }));
check('a device left on the local route opens on the sea import', first.route === 'sea' && first.flag === 1, first);
check('…and keeps the rest of its settings', first.hourly === 180, first);
const set = await page.evaluate(() => {
  navigateTo('settings');
  // every card on the page is a fold (2026-10-05); the route is in the pricing one
  const fold = document.getElementById('setCellRouteBox').closest('details'); if (fold) fold.open = true;
  const chips = [...document.querySelectorAll('#setCellRouteBox .sup-chip')];
  return { n: chips.length, on: (chips.find((c) => c.classList.contains('on')) || {}).textContent || '', visible: chips.length ? chips[0].checkVisibility() : false };
});
check('⚙️ הגדרות shows the three routes, the sea import lit as the default', set.n === 3 && /ימי/.test(set.on) && /ברירת מחדל/.test(set.on) && set.visible, set);

// he picks local in the settings; a change to another setting must not throw it away
const kept = await page.evaluate(() => {
  [...document.querySelectorAll('#setCellRouteBox .sup-chip')].find((c) => /מקומי/.test(c.textContent)).click();
  const afterPick = cellRoute();
  document.getElementById('setHourly').value = '200'; saveSettings();
  return { afterPick, afterSave: cellRoute(), hourly: (Store.get('settings') || {}).hourly };
});
check('choosing a route in the settings sets it', kept.afterPick === 'local', kept);
check('saving another setting keeps the route (the save used to rebuild settings from the form)', kept.afterSave === 'local' && kept.hourly === 200, kept);

await open();   // the one-time reset does not run again
const again = await page.evaluate(() => cellRoute());
check('after a reload his choice stays — the reset to sea happens once', again === 'local', again);

// ---- 3. the price list says which route it costs on, and offers no chips of its own
const cat = await page.evaluate(() => {
  navigateTo('catalog');
  if (!showCost) toggleCostView();
  const box = document.getElementById('catRoute');
  const r = { hidden: box.hidden, shown: (box.querySelector('[data-route-shown]') || {}).textContent || '', chips: box.querySelectorAll('.sup-chip[onclick*=setCellRoute]').length,
    toSettings: !!box.querySelector('[onclick*=settings]') };
  toggleCostView();
  return r;
});
check('with the cost shown, the price list names the route', !cat.hidden && /מקומי/.test(cat.shown), cat);
check('…and sends a change to the settings instead of offering chips', cat.chips === 0 && cat.toSettings, cat);

check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
if (SELFTEST) console.log('\n[selftest] a search box was put back, the sea reset removed and the settings save rebuilt from the form.');
await browser.close(); srv.close();
process.exit(finish());
