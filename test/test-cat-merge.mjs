// The scooter and the enduro packs are one price-list category (2026-11-15), and what was saved before still works.
//
//   node test/test-cat-merge.mjs
//   node test/test-cat-merge.mjs --selftest     (a saved category read as written, and nothing moved; must go red)
//
// Daniel, 2026-11-14: "למה שלא נאחד את הקטגוריות חוץ מאופניים שזה מארז מיוחד סילבר פיש כי כל השאר זה שרינק". Since the
// one-price rule of that day a scooter pack and an enduro pack of one voltage, capacity and series are one pack at one
// price, and the price list carried each twice. What must hold:
//   - the price list has the merged category and neither old one, each pack once, under one topic with the scooters'
//     18650 packs;
//   - a sale saved under an old category still finds its row: its cost and profit are known, and opening it to
//     correct a phone number keeps the line a price-list line (it would have become a hand-typed one, and its spec
//     and its profit would have gone);
//   - a cost typed by hand and a board picked for a row move to the merged category once, and the flag for that is in
//     the synced settings (a device-only flag would run it again on a new phone);
//   - nothing else in those two stores is touched.
// Every name, number and amount here is made up; this repo is public.
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
await new Promise((r) => srv.listen(4438, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4438/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.catNow === 'function' && typeof window.mergeShrinkKeysOnce === 'function', null, { timeout: 30000 });

const r = await page.evaluate((SELF) => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  if (SELF) {
    window.catNow = (c) => String(c || '');
    window.mergeShrinkKeysOnce = () => {};
  }
  const M = 'סוללות קורקינטים, אינדורו וטרקטורונים - ';
  const OLD = ['סוללות קורקינטים וקולנועיות - ', 'סוללות אינדורו וטרקטורונים - '];
  const out = {};
  out.old = PRICING.filter((x) => OLD.some((o) => String(x.cat).startsWith(o))).length;
  const merged = PRICING.filter((x) => String(x.cat).startsWith(M));
  out.merged = merged.length;
  out.volts = [...new Set(merged.map((x) => (x.cat.match(/ - (\d+)V /) || [])[1]))].sort((a, b) => a - b).join(',');
  const keys = merged.map((x) => x.cat + '|' + x.name);
  out.twice = keys.filter((k, i) => keys.indexOf(k) !== i).length;
  out.topics = [topicOf(M + '60V PRO'), topicOf('סוללות קורקינטים 18650 - 48V CLASSIC'), topicOf('סוללות אופניים - 48V PRO')];
  out.mains = new Set(PRICING.map((x) => catPath(x.cat)[0])).size;

  // a sale of before the merge, under each old category
  const a = PRICING.find((x) => x.cat === M + '24V CLASSIC'), b = PRICING.find((x) => x.cat === M + '88V PRO'), c = PRICING.find((x) => x.cat === M + '60V ADVANCED');
  out.have = [!!a, !!b, !!c];
  if (!a || !b || !c) return out;
  const sale = { id: 'old1', date: '2026-10-01T10:00:00.000Z', customer: 'לקוח דוגמה', phone: '050-0000000', status: 'שולם', isBusiness: false,
    total: 9000, items: [
      { name: a.name, cat: OLD[0] + '24V CLASSIC', qty: 1, unit: 1111 },
      { name: b.name, cat: OLD[1] + '88V PRO', qty: 1, unit: 2222 },
      { name: c.name, cat: OLD[0] + '60V ADVANCED', qty: 2, unit: 3333 },
    ] };
  Store.set('orders', [sale]);
  out.rows = sale.items.map((it) => { const row = pricingRowOf(it); return row ? row.cat : null; });
  const p = saleProfit(sale);
  out.profit = p && Number.isFinite(p.cost) && p.cost > 0;
  out.spec = sale.items.map((it) => { const s = orderItemSpec(it); return s ? s.tier : null; });
  openOrderEditor('old1');
  out.draft = (orderDraft.items || []).map((it) => ({ custom: !!it.custom, cat: it.custom ? null : PRICING[it.ci].cat, sold: it.sold }));
  try { closeModal(); } catch (e) { /* none */ }

  // what was saved under the old names
  const keep = { 'סוללות אופניים - 48V PRO|48V 12Ah': 901 };
  Store.set('costs', { ...keep, [OLD[0] + '24V CLASSIC|' + a.name]: 111, [OLD[1] + '88V PRO|' + b.name]: 222,
    [OLD[0] + '60V ADVANCED|' + c.name]: 333, [OLD[1] + '60V ADVANCED|' + c.name]: 444 });
  Store.set('bms_pick', { [OLD[1] + '88V PRO|' + b.name]: 'לוח דוגמה 100A' });
  const s0 = Store.get('settings') || {}; delete s0.catMerge20261115; Store.set('settings', s0);
  mergeShrinkKeysOnce();
  const costs = Store.get('costs') || {}, picks = Store.get('bms_pick') || {};
  out.moved = [costs[M + '24V CLASSIC|' + a.name], costs[M + '88V PRO|' + b.name], costs[M + '60V ADVANCED|' + c.name]];
  out.left = Object.keys(costs).filter((k) => OLD.some((o) => k.startsWith(o))).length + Object.keys(picks).filter((k) => OLD.some((o) => k.startsWith(o))).length;
  out.kept = costs['סוללות אופניים - 48V PRO|48V 12Ah'];
  out.pick = picks[M + '88V PRO|' + b.name];
  out.flag = !!(Store.get('settings') || {}).catMerge20261115;
  out.costRead = getCosts()[catKey(a)];
  // once: a cost typed under an old name after the move (an old device syncing in) is not swept again
  Store.set('costs', { ...Store.get('costs'), [OLD[0] + '24V CLASSIC|' + a.name]: 999 });
  mergeShrinkKeysOnce();
  out.once = (Store.get('costs') || {})[M + '24V CLASSIC|' + a.name];
  Store.set('costs', {}); Store.set('bms_pick', {}); Store.set('orders', []);
  return out;
}, SELFTEST);

check('the price list has the merged category for every voltage, 24V to 88V', r.merged > 300 && r.volts === '24,36,48,52,60,72,84,88', [r.merged, r.volts]);
check('…and no row under the scooter or the enduro category of before', r.old === 0, r.old);
check('…each pack once', r.twice === 0, r.twice);
check('one topic for it, the scooters\' 18650 packs under the same one, the e-bikes under their own', r.topics[0] === r.topics[1] && r.topics[0] !== r.topics[2] && /קורקינטים/.test(r.topics[0] || ''), r.topics);
check('the sale picker has no more main categories than it shows well (16)', r.mains <= 16, r.mains);
check('the rows the checks below use are in the price list', r.have && r.have.every(Boolean), r.have);
check('a sale line saved under either old category finds its row', r.rows && r.rows.length === 3 && r.rows.every((c) => /^סוללות קורקינטים, /.test(c || '')), r.rows);
check('…so the sale\'s cost and profit are known', r.profit === true, r.profit);
check('…its quote still names each line\'s series', (r.spec || []).join(',') === 'CLASSIC,PRO,ADVANCED', r.spec);
check('…and opening it keeps each a price-list line, at the price it sold for', r.draft && r.draft.length === 3 && r.draft.every((d) => !d.custom && /^סוללות קורקינטים, /.test(d.cat)) && r.draft.map((d) => d.sold).join(',') === '1111,2222,3333', r.draft);
check('a cost typed by hand moves to the merged category (the enduro\'s where both old ones had one)', r.moved && r.moved.join(',') === '111,222,444', r.moved);
check('…and is the one the price list reads for that row', r.costRead === 111, r.costRead);
check('…a board picked for a row moves with it', r.pick === 'לוח דוגמה 100A', r.pick);
check('…nothing is left under the old names, and another category\'s cost is untouched', r.left === 0 && r.kept === 901, [r.left, r.kept]);
check('…once, by a flag in the synced settings', r.flag === true && r.once === 111, [r.flag, r.once]);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
