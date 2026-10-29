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
// holder for 140 cells and a kilo of PVC sleeve each cost a few dollars, so the holders and the
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

// ---------------------------------------------------------------- 3. Sur-Ron, ₪1,500 / ₪1,150
// This one was already wrong before today: SURRON_CASE went into the model on 2026-09-01 and
// was applied inside audit-pricing only, so the hub showed every Sur-Ron pack ₪1,500 light.
// Two OEM cases since 2026-10-18: the Ultra Bee's ₪1,500 and the Light Bee's DHS case at ₪1,150
// (SURRON_CASE_LIGHT, from its PI). Each is checked on a row of its own family, so the list's
// order cannot decide which one is tested.
// Since 2026-10-29 the catalogue's Sur-Ron rows are DHS's ready packs, bought, not built (test-dhs-packs.mjs).
// The build's cost stays for an old sale or quote of one, so it is checked on a row in that old form.
const surronRow = (light) => page.evaluate((light) => {
  const it = light ? { cat: 'סוללות Sur-Ron Light Bee - 72V PRO', name: 'Light Bee 72V 45Ah' }
    : { cat: 'סוללות Sur-Ron Ultra Bee - 72V PRO', name: 'Ultra Bee 72V 55Ah' };
  const m = it.name.match(/(\d+)V\s*(\d+)Ah/);
  // A Sur-Ron row is named 'Light Bee 72V 45Ah', not '72V 45Ah' — match on the V/Ah part or
  // the comparison row is never found and the check passes vacuously on a null.
  const size = m[0];
  const j = PRICING.findIndex((x) => x.name === size && /^סוללות אינדורו/.test(x.cat) && /PRO/.test(x.cat));
  const caseLine = batteryCostParts(it, false).parts.find((x) => /מארז/.test(x.k)) || null;
  return { name: it.name, cat: it.cat, surron: estimateBatteryCost(it, false),
    heavy: j < 0 ? null : estimateBatteryCost(PRICING[j], false), V: +m[1], caseLine };
}, light);
// Since 2026-10-18 a Sur-Ron is not an enduro pack plus a case: it is copper-nickel and an
// ANT 420A as well (test-surron-cost.mjs holds that sum), so the gap to the enduro row is the
// case AND more, never less — and the case is still its own line.
for (const [label, light, amount] of [['Ultra Bee', false, 1500], ['Light Bee', true, 1150]]) {
  const r = await surronRow(light);
  check(`a Sur-Ron ${label} pack carries its ₪${amount.toLocaleString('en')} OEM case`,
    !r.missing && r.heavy != null && r.surron - r.heavy >= amount, r);
  check(`the ${label} breakdown names the case at ₪${amount.toLocaleString('en')}`, (r.caseLine || {}).v === amount, r.caseLine);
}

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
