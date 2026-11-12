// The Sur-Ron packs in the hub, built in the lab in DHS's cases (2026-11-12).
//
//   node test/test-surron-packs.mjs
//   node test/test-surron-packs.mjs --selftest     (the hub costs a lab-built pack as an old DHS ready pack again)
//
// Daniel, 2026-11-10/12: he buys only the cases from DHS and builds the packs, ADVANCED on Tenpower 50SG and PRO on Great
// Power 60Q. So the catalogue's Sur-Ron rows are the lab's builds again: costed by their own bill (cells, the case, the
// raised lid above the stock cells, an ANT board, copper, a day's work a 300 cells), which sync-prices holds to the
// tools' surronPackCost; listed by bike and then voltage; a sale takes its cells off the shelf; 24 months; and the label
// names its series' cell, the 60Q for PRO, never the e-bike PRO's 50PL. An old record of DHS's ready packs keeps what it
// had: no build of ours, and its 24 months.
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
await new Promise((r) => srv.listen(4397, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4397/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.productEstimate === 'function' && typeof window.warrantyForItem === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.surronLab = () => null; });

const r = await page.evaluate(() => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const rows = PRICING.filter((x) => /^(Light|Ultra) Bee (ADVANCED|PRO) \d+V \d+Ah$/.test(x.name));
  const out = { n: rows.length, cats: [...new Set(rows.map((x) => x.cat))] };
  // by bike, then voltage: each category one bike at one voltage, its rows the series and then the capacity
  out.catsOk = out.cats.every((c) => /^סוללות Sur-Ron (Light|Ultra) Bee - \d+V$/.test(c) && rows.filter((x) => x.cat === c).every((x) => x.name.includes(c.match(/(Light|Ultra) Bee/)[0]) && x.name.includes(c.match(/\d+V$/)[0])));
  navigateTo('catalog');
  const topic = [...document.querySelectorAll('#catalogList details')].find((d) => /סוללות Sur-Ron/.test(d.querySelector('summary')?.textContent || ''));
  out.topic = !!topic;
  const pro = rows.find((x) => x.name === 'Ultra Bee PRO 72V 72Ah'), adv = rows.find((x) => x.name === 'Light Bee ADVANCED 72V 50Ah');
  const raised = rows.find((x) => x.name === 'Ultra Bee PRO 72V 90Ah');
  out.est = rows.map((x) => estimateBatteryCost(x));
  out.parts = batteryCostParts(pro);
  out.partsRaised = batteryCostParts(raised);
  out.estPro = estimateBatteryCost(pro);
  out.stock = batteryStockParts(pro);
  out.stockAdv = batteryStockParts(adv);
  out.months = saleWarrantyMonths({ items: [{ cat: pro.cat, name: pro.name, unit: pro.retail, qty: 1 }] });
  out.cellPro = stickerCellFromText(pro.cat + ' ' + pro.name);
  out.cellAdv = stickerCellFromText(adv.cat + ' ' + adv.name);
  // an old record of DHS's ready packs, and of the lab's old Sur-Ron build
  out.oldDhs = { est: estimateBatteryCost({ cat: 'סוללות Sur-Ron Ultra Bee - DHS', name: 'DHS 8078-15C 80V 78Ah' }), months: warrantyForItem({ cat: 'x', name: 'DHS 8078-15C 80V 78Ah' }) };
  out.oldBuild = { months: warrantyForItem({ cat: 'סוללות Sur-Ron Light Bee - 72V PRO', name: 'Light Bee 72V 45Ah' }), cell: stickerCellFromText('סוללות Sur-Ron Light Bee - 72V PRO Light Bee 72V 45Ah') };
  return out;
});
check('the catalogue holds the 82 lab-built Sur-Ron packs', r.n === 82, r.n);
check('…a category for each bike at each voltage, its rows that bike\'s and that voltage\'s', r.catsOk && r.cats.length === 9 && r.topic, r.cats);
check('every pack is costed as the lab\'s build', r.est.every((x) => x > 1000), r.est.slice(0, 4));
const partsOf = (p) => p && p.parts.map((x) => x.k).join(' | ');
check('its cost shows its parts: the 60Q cells, the ANT board, the Ultra Bee case of DHS, and adds up', !!r.parts && /240 תאים Great Power 60Q/.test(partsOf(r.parts))
  && /BMS ANT 450A\/1050A/.test(partsOf(r.parts)) && /מארז Ultra Bee של DHS/.test(partsOf(r.parts)) && Math.round(r.parts.total) === r.estPro, [partsOf(r.parts), r.parts && r.parts.total, r.estPro]);
check('a pack over the stock cells (300 > 260) carries the raised lid, one at 240 does not', /מכסה מוגבה/.test(partsOf(r.partsRaised)) && !/מכסה מוגבה/.test(partsOf(r.parts)), [partsOf(r.partsRaised)]);
check('a sale takes its series\' cells off the shelf, and its board', r.stock && r.stock.cellModel === 'Great Power 60Q' && r.stock.cells === 240 && r.stock.bmsName === 'BMS 20S 450A'
  && r.stockAdv && r.stockAdv.cellModel === 'Tenpower 50SG' && r.stockAdv.cells === 200, [r.stock, r.stockAdv]);
check('it carries 24 months', r.months === 24, r.months);
check('the label names the 60Q on a PRO pack and the 50SG on an ADVANCED one', r.cellPro === 'Great Power 21700 60Q' && r.cellAdv === 'Tenpower 21700 50SG', [r.cellPro, r.cellAdv]);
check('an old DHS ready pack keeps no build of ours and its 24 months', r.oldDhs.est == null && r.oldDhs.months === 24, r.oldDhs);
check('an old sale of the lab\'s old Sur-Ron build keeps 12 months and its 50PL', r.oldBuild.months === 12 && r.oldBuild.cell === 'EVE 21700 50PL', r.oldBuild);
check('no page errors', errs.length === 0, errs);
await browser.close();
srv.close();
process.exit(finish());
