// The navigation merge (2026-10-05, Daniel: "בלקוחות ועבודות יש 5 טאבים בדוק מה אפשר לאחד וגם בכל
// הלוח בקרה … שלא יהיה עומס"). He chose each merge:
//   - לקוחות ועבודות: two tabs. Warranties and the sticker log are views inside עבודות, business
//     accounts a view inside לקוחות, the repair calculator a "🔧 תיקון חדש" button.
//   - the home page: 8 cards. כלים טכניים (sizes, calculators, diagnosis), מחירון (sale prices,
//     supplier costs), בוטים (WhatsApp, trading) each one card with tabs; חסר להזמנה inside מלאי.
//
//   node test/test-nav-merge.mjs
//   node test/test-nav-merge.mjs --selftest   (the views lose their parent tab — must fail)
//
// The check that matters most is the last: every page is still reachable from the home page by
// tapping, so a merge that hid a page would go red here rather than on his phone.
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
  let body = fs.readFileSync(f);
  if (SELFTEST && rel === 'index.html') body = Buffer.from(String(body).replace("under: { bizdocs: 'customers',", "_under: { bizdocs: 'customers',"));
  r.writeHead(200); r.end(body);
});
await new Promise((r) => srv.listen(4373, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4373/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { hideLogin(); closeModal(); closeNotice(); });

// ---- the home page
const cards = await page.evaluate(() => [...document.querySelectorAll('#page-home .quick-card')]
  .map((c) => [c.querySelector('.quick-card-title').textContent.trim(), c.getAttribute('onclick')]));
check('the home page has 8 cards', cards.length === 8, cards.map((c) => c[0]));
check('…the merged ones among them', ['לקוחות ועבודות', 'מחירון', 'מלאי', 'כלים טכניים', 'בוטים'].every((t) => cards.some((c) => c[0] === t))
  && !cards.some((c) => /חסר להזמנה|עלויות ספקים|בוט מסחר|מדבקות|אבחון|מחשבונים/.test(c[0])), cards.map((c) => c[0]));

const strip = (p) => page.evaluate((p) => { navigateTo(p);
  return [...document.querySelectorAll('#page-' + p + ' .page-group-tabs .sub-tab')].map((t) => (t.classList.contains('active') ? '*' : '') + t.textContent.trim()); }, p);
const views = (p) => page.evaluate((p) => [...document.querySelectorAll('#page-' + p + ' [data-views] .sub-tab')]
  .map((t) => (t.classList.contains('active') ? '*' : '') + t.textContent.trim()), p);

// ---- לקוחות ועבודות: two tabs, and the views inside them
check('לקוחות ועבודות has two tabs', JSON.stringify(await strip('customers')) === JSON.stringify(['*👥 לקוחות', '📋 עבודות']), await strip('customers'));
for (const [p, lit] of [['orders', 'עבודות'], ['warranties', 'עבודות'], ['stickerlog', 'עבודות'], ['calc', 'עבודות'], ['bizdocs', 'לקוחות']]) {
  const s = await strip(p);
  check(`${p}: the strip shows its two tabs, ${lit} lit`, s.length === 2 && s.some((t) => t === '*' + (lit === 'עבודות' ? '📋 עבודות' : '👥 לקוחות')), s);
}
check('עבודות: its views, "כל העבודות" lit', JSON.stringify(await (strip('orders'), views('orders'))) === JSON.stringify(['*📋 כל העבודות', '🛡️ אחריות', '🏷️ מדבקות']), await views('orders'));
await strip('warranties');
check('…and on אחריות, אחריות lit', JSON.stringify(await views('warranties')) === JSON.stringify(['📋 כל העבודות', '*🛡️ אחריות', '🏷️ מדבקות']), await views('warranties'));
await strip('stickerlog');
check('…and on מדבקות, מדבקות lit', (await views('stickerlog'))[2] === '*🏷️ מדבקות', await views('stickerlog'));
await strip('customers');
check('לקוחות: its views, "כל הלקוחות" lit', JSON.stringify(await views('customers')) === JSON.stringify(['*👥 כל הלקוחות', '🏢 עסקיים']), await views('customers'));
check('a view chip goes where it says', await page.evaluate(() => {
  navigateTo('orders');
  document.querySelector('#page-orders [data-views] [data-view="warranties"]').click();
  return document.getElementById('page-warranties').classList.contains('active');
}), '');
check('"🔧 תיקון חדש" on עבודות opens the repair calculator', await page.evaluate(() => {
  navigateTo('orders');
  [...document.querySelectorAll('#page-orders .page-header button')].find((b) => /תיקון חדש/.test(b.textContent)).click();
  return document.getElementById('page-calc').classList.contains('active');
}), '');

// ---- the merged cards' tabs
check('כלים טכניים: מידות · מחשבונים · אבחון', JSON.stringify(await strip('dims')) === JSON.stringify(['*📐 מידות', '🧰 מחשבונים', '🩺 אבחון']), await strip('dims'));
check('מחירון: מחירי מכירה · עלויות ספקים', JSON.stringify(await strip('catalog')) === JSON.stringify(['*🏷️ מחירי מכירה', '🔒 עלויות ספקים']), await strip('catalog'));
check('בוטים: וואטסאפ · מסחר', JSON.stringify(await strip('wabot')) === JSON.stringify(['*🤖 וואטסאפ', '📈 מסחר']), await strip('wabot'));
check('מלאי carries חסר להזמנה at its top', await page.evaluate(() => { navigateTo('inventory'); return !!document.querySelector('#page-inventory #needCard'); }), '');

// ---- nothing orphaned: every page reachable from home by tapping
const reach = await page.evaluate(() => {
  const all = [...document.querySelectorAll('section.page')].map((s) => s.id.replace('page-', ''));
  // the header's buttons (⚙️ settings, 🔔) are on every page, so they count as reachable from home
  const seen = new Set(['home']), queue = ['home'];
  for (const el of document.querySelectorAll('[onclick]')) {
    if (el.closest('section.page')) continue;
    for (const m of el.getAttribute('onclick').matchAll(/navigateTo\('([a-z]+)'\)/g)) if (!seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
  }
  while (queue.length) {
    const p = queue.shift();
    navigateTo(p);
    const sec = document.getElementById('page-' + p);
    for (const el of sec.querySelectorAll('[onclick]')) {
      for (const m of el.getAttribute('onclick').matchAll(/navigateTo\('([a-z]+)'\)/g)) if (!seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
      if (/openNeedList\(\)/.test(el.getAttribute('onclick')) && !seen.has('inventory')) { seen.add('inventory'); queue.push('inventory'); }
    }
  }
  // the worker page opens from a worker's name on the clock (openWorkerRef), not from a link
  return all.filter((p) => !seen.has(p) && p !== 'worker');
});
check('every page is still reachable from the home page', reach.length === 0, reach);

check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
