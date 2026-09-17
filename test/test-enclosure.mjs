// The enclosure: why an e-bike pack is not the same cost as a scooter pack (2026-09-17).
//
//   node test/test-enclosure.mjs
//   node test/test-enclosure.mjs --selftest
//
// Daniel asked why the price of an e-bike matched every other category at the same voltage and
// capacity. It matched because the cost model had one flat MATERIALS number for all of them and
// the category was not an input to the price at all — 168 variants existed in more than one
// family at the same V/Ah, and not one of them was priced differently.
//
// The real difference is the enclosure, and the catalogue had it backwards: `caseByTier` gave
// the scooter a shrink line and the e-bike an EMPTY string, so the one family that buys a case
// was the one described as having none. His answer: "האופניים הם עם סילבר פיש, השאר זה עם שרינק
// ואותו [דבר]". Checked against the supplier list before believing the other half — a 21700
// holder for 140 cells is $0.59 and a kilo of PVC sleeve is $5-10, so the holders and the
// shrink genuinely are not a cost difference.
//
// This suite tests the HUB's copy of the model. sync-prices separately compares that copy
// against packCost on all 806 rows, so between the two the enclosure cannot end up on one side
// of the pipeline only — which is the failure mode that produced 219 phantom deviations once
// before, when the checker itself held the wrong series count.
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

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4352, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4352/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

if (SELFTEST) {
  // The bug this suite was written against: the model knows nothing about the family, so every
  // pack is costed as though it were shrink-wrapped. Restoring that must turn the comparisons
  // below red — if it does not, the checks are not measuring the enclosure at all.
  await page.evaluate(() => {
    const orig = window.estimateBatteryCost;
    window.estimateBatteryCost = function (it, b2b) {
      const flat = { name: it.name, cat: String(it.cat).replace(/^סוללות (אופניים|Sur-Ron[^-]*)/, 'סוללות קורקינטים וקולנועיות') };
      return orig(flat, b2b);
    };
  });
}

// ---------------------------------------------------------------- 1. the same pack, two families
const pair = await page.evaluate(() => {
  const find = (re) => PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && re.test(x.cat) && /CLASSIC/.test(x.cat));
  const e = find(/^סוללות אופניים/), s = find(/^סוללות קורקינטים/);
  if (e < 0 || s < 0) return { missing: true, e, s };
  return {
    ebike: estimateBatteryCost(PRICING[e], false),
    scooter: estimateBatteryCost(PRICING[s], false),
    ecat: PRICING[e].cat, scat: PRICING[s].cat,
  };
});
check('a 48V 20Ah CLASSIC exists in both the e-bike and the scooter family', !pair.missing, pair);
check('the e-bike pack costs MORE than the scooter pack — it buys a case',
  !pair.missing && pair.ebike > pair.scooter, pair);
check('and the gap is exactly the Silver Fish, ₪240',
  !pair.missing && pair.ebike - pair.scooter === 240, pair);

// ---------------------------------------------------------------- 2. the families that buy nothing
const rest = await page.evaluate(() => {
  const at = (re) => {
    const i = PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && re.test(x.cat) && /CLASSIC/.test(x.cat));
    return i < 0 ? null : estimateBatteryCost(PRICING[i], false);
  };
  return { scooter: at(/^סוללות קורקינטים/), heavy: at(/^סוללות אינדורו/) };
});
// His answer was that these two are the same build — shrink, same work. The supplier list
// agrees: the holders an enduro pack uses cost under an agora a cell.
check('the scooter and the enduro pack cost the SAME — both are shrink, neither buys a case',
  rest.scooter != null && rest.heavy != null && rest.scooter === rest.heavy, rest);

// ---------------------------------------------------------------- 3. Sur-Ron, ₪1,500
// This one was already wrong before today: SURRON_CASE went into the model on 2026-09-01 and
// was applied inside audit-pricing only, so the hub showed every Sur-Ron pack ₪1,500 light.
const surron = await page.evaluate(() => {
  const i = PRICING.findIndex((x) => /^סוללות Sur-Ron/.test(x.cat) && /(\d+)V\s*(\d+)Ah/.test(x.name));
  if (i < 0) return { missing: true };
  const it = PRICING[i];
  const m = it.name.match(/(\d+)V\s*(\d+)Ah/);
  // A Sur-Ron row is named 'Light Bee 72V 70Ah', not '72V 70Ah' — match on the V/Ah part or
  // the comparison row is never found and the check passes vacuously on a null.
  const size = m[0];
  const j = PRICING.findIndex((x) => x.name === size && /^סוללות אינדורו/.test(x.cat) && /PRO/.test(x.cat));
  return { name: it.name, cat: it.cat, surron: estimateBatteryCost(it, false),
    heavy: j < 0 ? null : estimateBatteryCost(PRICING[j], false), V: +m[1] };
});
check('a Sur-Ron pack carries its ₪1,500 OEM case',
  !surron.missing && surron.heavy != null && surron.surron - surron.heavy === 1500, surron);

// ---------------------------------------------------------------- 4. the breakdown says so
const parts = await page.evaluate(() => {
  const i = PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && /^סוללות אופניים/.test(x.cat) && /CLASSIC/.test(x.cat));
  const p = batteryCostParts(PRICING[i], false);
  const j = PRICING.findIndex((x) => /^48V 20Ah$/.test(x.name) && /^סוללות קורקינטים/.test(x.cat) && /CLASSIC/.test(x.cat));
  const q = batteryCostParts(PRICING[j], false);
  return {
    ebikeLine: (p.parts.find((x) => /מארז/.test(x.k)) || null),
    scooterHasOne: q.parts.some((x) => /מארז/.test(x.k)),
    // The case must be INSIDE the figures the editor prints, not just in the list of lines.
    // `total` is deliberately unrounded here, so compare the two breakdowns rather than rounding.
    materialsGap: Math.round(p.materialsTotal - q.materialsTotal),
    totalGap: Math.round(p.total - q.total),
  };
});
check('the cost breakdown shows the case as its own named line', !!parts.ebikeLine, parts.ebikeLine);
check('at the right amount', (parts.ebikeLine || {}).v === 240, parts.ebikeLine);
check('a scooter pack shows no case line at all', parts.scooterHasOne === false, parts);
check('the case is inside the materials subtotal the editor prints', parts.materialsGap === 240, parts);
check('and inside the pack total', parts.totalGap === 240, parts);

if (SELFTEST) console.log('\n[selftest] every pack was re-costed as a scooter;\n[selftest] the e-bike and Sur-Ron comparisons above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
