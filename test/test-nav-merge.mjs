// The navigation merge (2026-10-05, Daniel: "בלקוחות ועבודות יש 5 טאבים בדוק מה אפשר לאחד וגם בכל
// הלוח בקרה … שלא יהיה עומס"). He chose each merge:
//   - לקוחות ועבודות: two tabs, then ONE page (2026-10-08, "תאחד את לקוחות ועבודות ביחד"; he chose
//     the jobs with the customer on every row). The name opens the customer's card, one search finds
//     a customer and a job, and warranties, stickers and business accounts are views at the top.
//     The repair calculator is a "🔧 תיקון חדש" button.
//   - the home page: 8 cards. כלים טכניים (sizes, calculators, diagnosis), מחירון (sale prices,
//     supplier costs), בוטים (WhatsApp, trading) each one card with tabs; חסר להזמנה inside מלאי.
//
//   node test/test-nav-merge.mjs
//   node test/test-nav-merge.mjs --selftest   (old links to the customers page land nowhere, a row's name opens nothing,
//                                              the search finds nothing — must fail)
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
  if (SELFTEST && rel === 'index.html') body = Buffer.from(String(body)
    .replace("if (page === 'customers') page = 'orders';", '')
    .replace('function custLinkHtml(name, phone) {', 'function custLinkHtml(name, phone) { return custPickEsc(name || \'ללא שם\');')
    .replace("function ordersSearch(q) { ORD_QUERY = String(q || '');", "function ordersSearch(q) { ORD_QUERY = '';"));
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

// ---- לקוחות ועבודות: one page, no tab strip; its views at the top
check('the home card opens לקוחות ועבודות', cards.some((c) => c[0] === 'לקוחות ועבודות' && c[1] === "navigateTo('orders')"), cards);
check('one page: no tab strip, its title says both', (await strip('orders')).length === 0
  && await page.evaluate(() => document.querySelector('#page-orders .page-title').textContent.includes('לקוחות ועבודות')), await strip('orders'));
check('its views: עבודות lit, then אחריות, מדבקות, עסקיים', JSON.stringify(await views('orders')) === JSON.stringify(['*📋 עבודות', '🛡️ אחריות', '🏷️ מדבקות', '🏢 עסקיים']), await views('orders'));
for (const [p, i] of [['warranties', 1], ['stickerlog', 2], ['bizdocs', 3]]) {
  await strip(p);
  const v = await views(p);
  check(`…and on ${p} the same four, that one lit`, v.length === 4 && v[i].startsWith('*'), v);
}
check('an old link to the customers page lands on the one page', await page.evaluate(() => { navigateTo('customers'); return document.getElementById('page-orders').classList.contains('active') && !document.getElementById('page-customers'); }), '');

// the customer on every row, and the one search
const one = await page.evaluate(() => {
  const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();
  Store.set('customers', [
    { id: 'c1', name: 'רונן לוי', phone: '050-1111111', lastVisit: iso(1) },
    { id: 'c2', name: 'משה כהן', phone: '052-2222222', lastVisit: iso(2) },
    { id: 'c3', name: 'אבי בלי עבודות', phone: '054-3333333', lastVisit: iso(3) },
  ]);
  Store.set('jobs', [{ id: 'j1', date: iso(1), customerName: 'רונן לוי', customerPhone: '050-1111111', voltage: 48, capacity: 20, price: 450, jobType: 'bms' }]);
  Store.set('orders', [{ id: 'o1', date: iso(2), customer: 'משה כהן', phone: '052-2222222', status: 'שולם', total: 3000, items: [{ name: '72V 30Ah', cat: 'סוללות אופניים - 72V PRO', qty: 1 }] }]);
  navigateTo('orders'); setSalesFilter('all');
  document.querySelectorAll('#ordersList details.fold').forEach((d) => { d.open = true; });
  const out = {};
  const rows = [...document.querySelectorAll('#ordersList .list-item')];
  out.rows = rows.map((r) => ({ link: (r.querySelector('.cust-link') || {}).textContent || '', phone: /📱/.test(r.textContent) }));
  const link = document.querySelector('#ordersList .cust-link');
  if (link) link.click();
  out.card = (document.getElementById('modalBody') || {}).textContent || '';
  closeModal();
  out.idle = document.querySelectorAll('#customersList [data-cust-hit]').length;
  const box = document.getElementById('ordSearch');
  const type = (v) => { box.value = v; box.dispatchEvent(new Event('input')); };
  type('אבי');
  out.noJobs = { hits: [...document.querySelectorAll('#customersList [data-cust-hit]')].map((e) => e.querySelector('.list-item-title').textContent.trim()), jobs: document.querySelectorAll('#ordersList .list-item').length };
  type('2222');
  document.querySelectorAll('#ordersList details.fold').forEach((d) => { d.open = true; });
  out.byPhone = { hits: [...document.querySelectorAll('#customersList [data-cust-hit]')].map((e) => e.querySelector('.list-item-title').textContent.trim()), jobs: [...document.querySelectorAll('#ordersList .list-item .cust-link')].map((e) => e.textContent) };
  type('72V');
  document.querySelectorAll('#ordersList details.fold').forEach((d) => { d.open = true; });
  out.byItem = [...document.querySelectorAll('#ordersList .list-item .cust-link')].map((e) => e.textContent);
  document.querySelector('#customersList [data-cust-hit]') && 0;
  type('אבי');
  const hit = document.querySelector('#customersList [data-cust-hit]');
  if (hit) hit.click();
  out.hitCard = (document.getElementById('modalBody') || {}).textContent || '';
  closeModal();
  type('');
  return out;
});
check('every row names its customer as a link, with the number', one.rows.length === 2 && one.rows.every((r) => r.link && r.phone), one.rows);
check('the name opens that customer\'s card', /רונן לוי|משה כהן/.test(one.card) && /050-1111111|052-2222222/.test(one.card), one.card.slice(0, 120));
check('with nothing typed, no customer block', one.idle === 0, one.idle);
check('the search finds a customer with no job yet, and no job for him', JSON.stringify(one.noJobs.hits) === JSON.stringify(['אבי בלי עבודות']) && one.noJobs.jobs === 0, one.noJobs);
check('a number finds the customer and his job', JSON.stringify(one.byPhone.hits) === JSON.stringify(['משה כהן']) && JSON.stringify(one.byPhone.jobs) === JSON.stringify(['משה כהן']), one.byPhone);
check('an item finds the job it is in', JSON.stringify(one.byItem) === JSON.stringify(['משה כהן']), one.byItem);
check('a customer the search found opens his card', /אבי בלי עבודות/.test(one.hitCard), one.hitCard.slice(0, 80));
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
