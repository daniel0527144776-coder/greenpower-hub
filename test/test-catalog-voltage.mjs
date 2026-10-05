// The voltage sub-heading in the full price list (Daniel, 2026-09-10).
//
//   node test/test-catalog-voltage.mjs
//   node test/test-catalog-voltage.mjs --selftest
//
// The hierarchy is topic -> VOLTAGE -> category for the batteries. The check that matters is
// not that the headings appear — it is the CLICK-BY-INDEX invariant underneath them:
// toggleCatCat(i) addresses a category by its position in catCatKeys, so inserting headings
// into the render without inserting them into the keys opens a DIFFERENT category than the one
// touched. That failure is silent and it is why the keys and the markup are now built from one
// plan. This suite clicks every category header and checks the one that opened is the one hit.
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
await new Promise((r) => srv.listen(4346, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4346/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });
await page.evaluate(() => navigateTo('catalog'));
await page.waitForTimeout(400);

if (SELFTEST) {
  // Put the original hazard back: keys built separately from the render, so the headings shift
  // every index by one. Everything about clicking must go red.
  await page.evaluate(() => {
    const real = window.renderCatalog;
    window.renderCatalog = function () { real(); catCatKeys = catCatKeys.slice(1); };
    renderCatalog();
  });
}

// ---------------------------------------------------------------- the headings
const shape = await page.evaluate(() => {
  const list = document.getElementById('catalogList');
  const out = [];
  for (const el of list.children) {
    if (el.classList.contains('price-series')) out.push({ topic: el.innerText.trim() });
    else if (el.classList.contains('price-volt')) out.push({ volt: el.innerText.trim() });
    else if (el.classList.contains('price-cat')) out.push({ cat: el.innerText.replace(/^[▾▸]\s*/, '').trim() });
  }
  return out;
});
const volts = shape.filter((x) => x.volt).map((x) => x.volt);
check('the price list has voltage headings', volts.length > 0, volts);
check('and they read as a voltage', volts.every((v) => /^\d+V$/.test(v)), volts);

// every category under a voltage heading must actually carry that voltage
let curTopic = null, curVolt = null, mismatched = [], toolTopicHasVolt = false;
for (const row of shape) {
  if (row.topic) { curTopic = row.topic; curVolt = null; continue; }
  if (row.volt) { curVolt = row.volt; if (/כלי עבודה/.test(curTopic || '')) toolTopicHasVolt = true; continue; }
  if (row.cat && curVolt && !row.cat.includes(' ' + curVolt.replace('V', 'V'))) {
    if (!new RegExp('\\b' + parseInt(curVolt, 10) + 'V\\b').test(row.cat)) mismatched.push(curVolt + ' -> ' + row.cat);
  }
}
check('every category sits under its own voltage', mismatched.length === 0, mismatched);

// grouping must only appear where it collapses something
const toolCats = shape.filter((x) => x.cat && /כלי עבודה/.test(x.cat)).length;
check('the power tools are NOT split by voltage (3 categories, 3 voltages)',
  !toolTopicHasVolt, `toolCats=${toolCats} headingsInTools=${toolTopicHasVolt}`);

const nonBattery = await page.evaluate(() => {
  // no non-battery category carries a voltage at all, so none of them may gain a heading
  const list = document.getElementById('catalogList');
  let topic = null, bad = [];
  for (const el of list.children) {
    if (el.classList.contains('price-series')) topic = el.innerText.trim();
    else if (el.classList.contains('price-volt') && !/סוללות/.test(topic || '')) bad.push(topic + ' / ' + el.innerText.trim());
  }
  return bad;
});
check('no voltage heading appears outside the batteries', nonBattery.length === 0, nonBattery);

// highest voltage first within a topic
const order = await page.evaluate(() => {
  const list = document.getElementById('catalogList');
  let topic = null, seq = {}, cur = [];
  for (const el of list.children) {
    if (el.classList.contains('price-series')) { if (cur.length) seq[topic] = cur; topic = el.innerText.trim(); cur = []; }
    else if (el.classList.contains('price-volt')) cur.push(parseInt(el.innerText, 10));
  }
  if (cur.length) seq[topic] = cur;
  return seq;
});
const descending = Object.values(order).every((a) => a.every((v, i) => i === 0 || a[i - 1] >= v));
check('voltages run highest first', descending, order);

// ---------------------------------------------------------------- the click invariant
const clicks = await page.evaluate(() => {
  catOpenCats = new Set(); renderCatalog();
  const wrong = [];
  const heads = () => [...document.getElementById('catalogList').querySelectorAll('.price-cat')];
  const total = heads().length;
  for (let i = 0; i < total; i++) {
    const before = heads();
    const label = before[i].innerText.replace(/^[▾▸]\s*/, '').trim();
    before[i].click();
    const opened = [...catOpenCats];
    if (opened.length !== 1 || opened[0] !== label) wrong.push({ clicked: label, opened: opened.join('|') });
    catOpenCats = new Set(); renderCatalog();
  }
  return { total, wrong: wrong.slice(0, 6), wrongCount: wrong.length };
});
check('clicking a category opens THAT category, every time',
  clicks.wrongCount === 0, `${clicks.wrongCount} of ${clicks.total} wrong: ${JSON.stringify(clicks.wrong)}`);
check('and every category is reachable', clicks.total >= 60, clicks.total);

// ---------------------------------------------------------------- the rest still works
const still = await page.evaluate(() => {
  catExpandAll(true);
  const openAll = catOpenCats.size;
  catExpandAll(false);
  const closedAll = catOpenCats.size;
  document.getElementById('catalogSearch').value = '72V 30';
  renderCatalog();
  const hits = document.getElementById('catalogList').querySelectorAll('.price-item').length;
  document.getElementById('catalogSearch').value = '';
  setCatalogTier('PRO');
  const proCats = [...document.getElementById('catalogList').querySelectorAll('.price-cat')].map((e) => e.innerText);
  setCatalogTier('');
  renderCatalog();
  return { openAll, closedAll, hits, proOnly: proCats.every((c) => /PRO/.test(c)), proCount: proCats.length };
});
check('open-all still opens every category', still.openAll === clicks.total, `${still.openAll} vs ${clicks.total}`);
check('close-all still closes them', still.closedAll === 0, still.closedAll);
check('search still finds rows', still.hits > 0, still.hits);
check('the tier filter still filters', still.proOnly && still.proCount > 0, still);

if (SELFTEST) console.log('\n[selftest] catCatKeys was shifted out of step with the render;\n[selftest] the click-by-index check must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
