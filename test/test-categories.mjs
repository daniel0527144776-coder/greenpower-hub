// Every product and every stock row sits in a category and a sub-category (2026-10-22).
//
//   node test/test-categories.mjs [--selftest]
//
// Daniel: "תחלק לי בבקשה את כל המלאי לפי קטגוריות ותת קטגוריות כדי שאני ימצא מהר כל מוצר ... אותו
// דבר גם לגבי מכירות ... תבדוק בכל לוח הבקרה שכל המוצרים מחולקים". The sale picker was one list of
// ~95 categories in alphabetical order; the stock page put everything that was not a BMS, charger,
// cell or nickel under אחר.
//
// --selftest flattens catPath back to one level and drops the name rules; the checks must go red.
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
await new Promise((r) => srv.listen(4384, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4384/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });
if (SELFTEST) {
  await page.evaluate(() => {
    window.catPath = (c) => [String(c), ''];
    INV_CAT_WORDS.length = 0;
  });
}

// ---------------------------------------------------------------- 1. sales: main, then sub
const S = await page.evaluate(() => {
  const cats = [...new Set(PRICING.filter((c) => typeof c.retail === 'number').map((c) => c.cat))];
  const mains = [...new Set(cats.map((c) => catPath(c)[0]))];
  // Drive the real modal: open a sale, pick the chargers, read what the two lists offer.
  openOrderEditor();
  const opts = (id) => [...document.getElementById(id).options].map((o) => o.textContent);
  const main0 = opts('ordMain');
  document.getElementById('ordMain').value = 'מטענים'; onOrderMainChange();
  const chargerSubs = opts('ordCat');
  const chargerProds = opts('ordProd');
  document.getElementById('ordMain').value = 'סוללות Sur-Ron'; onOrderMainChange();
  const surronSubs = opts('ordCat');
  document.getElementById('ordMain').value = 'סוללות אופניים'; onOrderMainChange();
  const bikeSubs = opts('ordCat');
  closeModal();
  return { cats: cats.length, mains: mains.length, main0, chargerSubs, chargerProds, surronSubs, bikeSubs };
});
check(`${S.cats} sale categories fold into a short list of main ones`, S.mains >= 8 && S.mains <= 16, S.mains);
check('the picker opens on the main categories', S.main0.length === S.mains && S.main0.includes('מטענים'), S.main0);
check('chargers: four sub-categories, named without the "מטענים - " prefix',
  S.chargerSubs.length === 4 && S.chargerSubs.every((s) => !/^מטענים/.test(s)), S.chargerSubs);
check('and a sub-category lists its products', S.chargerProds.length >= 1 && S.chargerProds.every((p) => /מטען/.test(p)), S.chargerProds);
check('Sur-Ron: one main category, the bike in the sub-category', S.surronSubs.some((s) => /^Light Bee/.test(s)) && S.surronSubs.some((s) => /^Ultra Bee/.test(s)), S.surronSubs);
check('e-bike packs by voltage, then PRO / ADVANCED / CLASSIC',
  S.bikeSubs.slice(0, 3).join(',') === '36V PRO,36V ADVANCED,36V CLASSIC' && /^72V/.test(S.bikeSubs[S.bikeSubs.length - 1]), S.bikeSubs);

// ---------------------------------------------------------------- 2. stock: every row has a home
const I = await page.evaluate(() => {
  const rows = [
    ['שרוולי כיווץ PVC 0.3mm 260', 'בידוד וכיווץ', 'שרוולי כיווץ'],
    ['נייר בידוד ירוק 21700', 'בידוד וכיווץ', 'נייר בידוד'],
    ['מחזיק 21700 4P', 'מחזיקי תאים', '21700'],
    ['כבל סיליקון 10AWG אדום', 'כבלים ומחברים', 'כבלים'],
    ['מחבר XT90 זכר', 'כבלים ומחברים', 'מחברים'],
    ['בקר Far Driver ND72450', 'הנעה', 'בקרים'],
    ['צג DKD', 'הנעה', 'צגים'],
    ['מארז סילבר פיש', 'מארזים', ''],
    ['מאזן אקטיבי 20S', 'כלים וציוד', ''],
  ];
  return rows.map(([name, cat, sub]) => {
    const row = { name, cat: 'אחר' };          // saved under אחר, as the old form left them
    const got = invCatOf(row);
    return { name, cat: got, sub: invSubFromName(got, name), want: cat, wantSub: sub };
  });
});
for (const r of I) {
  check(`"${r.name}" files under ${r.want}${r.wantSub ? ' / ' + r.wantSub : ''}`, r.cat === r.want && r.sub === r.wantSub, r);
}
// And the page shows them that way: one heading per category, a sub-heading per sub-category.
const P = await page.evaluate(() => {
  Store.set('inventory', [
    { id: 'a', name: 'שרוולי כיווץ PVC 0.3mm 260', qty: 3 }, { id: 'b', name: 'נייר בידוד ירוק', qty: 2 },
    { id: 'c', name: 'מחבר XT90 זכר', qty: 20 }, { id: 'd', name: 'כבל סיליקון 10AWG', qty: 5 },
    { id: 'e', name: 'מטען 72V 5A', qty: 9 },
  ]);
  INV_OPEN.add('בידוד וכיווץ'); INV_OPEN.add('כבלים ומחברים');
  navigateTo('inventory'); renderInventory();
  for (let k = 0; k < 400; k++) { const g = document.querySelector('#inventoryList .inv-grp-fold[data-open="0"]'); if (!g) break; g.click(); }
  const t = document.getElementById('inventoryList').innerText;
  return { t, subs: [...document.querySelectorAll('#inventoryList .inv-grp, #inventoryList .inv-sub')].map((e) => e.innerText.replace(/\s+/g, ' ')) };
});
check('the stock page has the new categories as headings', /בידוד וכיווץ/.test(P.t) && /כבלים ומחברים/.test(P.t) && !/📦 אחר/.test(P.t), P.t.slice(0, 300));
check('and sub-headings inside them', ['שרוולי כיווץ', 'נייר בידוד', 'מחברים', 'כבלים'].every((s) => P.subs.some((x) => x.startsWith(s))), P.subs);

if (SELFTEST) console.log('\n[selftest] catPath was flattened and the name rules emptied; the checks above must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
