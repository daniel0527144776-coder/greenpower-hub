// Four bugs found on 2026-09-10, all of the same family: the button does nothing, and
// nothing says why. None of them threw anywhere a person would look.
//
//   node test/test-silent-failures.mjs
//   node test/test-silent-failures.mjs --selftest
//
// 1. THE SAVED-MODELS EDITOR. seedOxTub wrote `id: Date.now()` — a NUMBER, and the only
//    numeric id in the file; every other record uses a string prefix. The id round-trips
//    through an HTML attribute and comes back a string, and both lookups used ===. So on
//    every hub that had ever opened the calculators page, ✏️ threw and 🗑 removed nothing.
//
// 2. THE PICKER CSS INSIDE A GENERATED BLOCK. v277 put .cust-pick* between the
//    <!-- deck: generated --> markers, which tools/gen-deck.mjs rewrites wholesale. Running
//    the fix its own error message tells you to run deleted the rules (12 lines), and
//    sync-prices runs that generator as a WRITE step — so the next price change would have
//    shipped the customer picker unstyled.
//
// 3. copyJobSummary's CLIPBOARD. writeText returns a PROMISE, so a refusal was never caught:
//    the .then never ran, nothing was copied and nothing was said. That summary goes to his
//    shops every week.
//
// 4. o.items UNGUARDED in three places, where the file guards it twelve times elsewhere.
//    One malformed row blanked the whole sales page.
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
await new Promise((r) => srv.listen(4344, r));

// ---------------------------------------------------------------- 2. a file check, no browser
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const regions = [...html.matchAll(/<!-- ([a-z-]+): generated[\s\S]*?<!-- \/\1 -->/g)].map((m) => m[0]);
check('the generated regions are still delimited', regions.length >= 2, regions.length);
const pickerRules = ['.cust-pick {', '.cust-pick-rows', '.cust-pick-row {', '.cust-pick-name', '.cust-pick-empty'];
check('the customer picker still has its CSS', pickerRules.every((r) => html.includes(r)), pickerRules.filter((r) => !html.includes(r)));
// The point: hand-written CSS must live where a generator cannot reach it.
const trapped = pickerRules.filter((r) => regions.some((reg) => reg.includes(r)));
check('and none of it sits inside a generated block', trapped.length === 0, trapped);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4344/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

// SELFTEST puts the ORIGINAL bugs back, one per area, so the real assertions go red.
if (SELFTEST) {
  await page.evaluate(() => {
    const dims = window.getDims;
    window.getDims = function () { return (Store.get('dims') || []).map((d) => ({ ...d, id: Number(String(d.id).replace(/\D/g, '')) || 1 })); };
    window.__origFind = true;
    // the pre-fix strict comparison
    window.openDimEditor = function (id) {
      const d = window.getDims().find((x) => x.id === id);
      openModal('עריכת דגם', '<input id="dimModel" value="' + d.model + '">', '');
    };
  });
}

// ---------------------------------------------------------------- 1. the saved-models editor
await page.evaluate(() => navigateTo('calcs'));
await page.waitForTimeout(400);
const seeded = await page.evaluate(() => (JSON.parse(localStorage.getItem('gp_dims') || '[]')).map((d) => typeof d.id));
check('every seeded saved-model id is a string', seeded.length > 0 && seeded.every((t) => t === 'string'), seeded);

const edit = await page.evaluate(() => {
  const before = window.__err;
  const row = [...document.querySelectorAll('#dimsList .list-item')][0];
  if (!row) return { none: true };
  const name = row.querySelector('.list-item-title').innerText.trim();
  let threw = null;
  try { row.querySelector('button').click(); } catch (e) { threw = String(e); }
  const m = document.getElementById('modalBackdrop');
  return { name, threw, opened: !!m && getComputedStyle(m).display !== 'none', prefilled: (document.getElementById('dimModel') || {}).value };
});
check('editing the auto-seeded row opens its editor', edit.opened === true, edit);
check('and prefills the model it belongs to', !!edit.prefilled, edit.prefilled);
await page.evaluate(() => { try { closeModal(); } catch (e) { /* none open */ } });

// A hub that already stored the numeric id must be repaired, not merely stop being created.
const legacy = await page.evaluate(() => {
  localStorage.setItem('gp_dims', JSON.stringify([
    { id: 1789029139248, model: 'Legacy Numeric', l: 300, w: 120, h: 90, notes: '' },
    { id: 'd999', model: 'Keep Me', l: 200, w: 100, h: 80, notes: '' },
  ]));
  renderDims();
  deleteDim(String(1789029139248));
  const yes = [...document.querySelectorAll('button')].find((b) => /אישור|כן|מחק|אשר/.test(b.innerText) && b.offsetParent !== null);
  if (yes) yes.click();
  const left = JSON.parse(localStorage.getItem('gp_dims'));
  return { n: left.length, gone: !left.some((d) => d.model === 'Legacy Numeric'), kept: left.some((d) => d.model === 'Keep Me') };
});
check('deleting a legacy numeric-id row actually removes it', legacy.gone === true, legacy);
check('and removes only that one', legacy.kept === true && legacy.n === 1, legacy);

// ---------------------------------------------------------------- 3. the clipboard fallback
// Headless denies the clipboard, which is exactly the WebView case. The summary must still
// reach the screen instead of vanishing.
const clip = await page.evaluate(async () => {
  localStorage.setItem('gp_jobs', JSON.stringify([{
    id: 'jc1', date: new Date().toISOString(), customerName: 'אבי', customerPhone: '0501234567',
    voltage: '60', capacity: '20', jobs: ['full'], price: 2600, jobStatus: 'מוכן',
  }]));
  copyJobSummary('jc1');
  await new Promise((r) => setTimeout(r, 400));
  const m = document.getElementById('modalBackdrop');
  const open = !!m && getComputedStyle(m).display !== 'none';
  const ta = document.querySelector('#modalBackdrop textarea');
  return { open, text: ta ? ta.value : '', notice: (document.body.innerText.match(/הועתק/) || [])[0] || '' };
});
check('a refused clipboard still puts the summary on screen', clip.open === true, clip.open);
check('and the summary is the real one', /סיכום בדיקת מעבדה/.test(clip.text), clip.text.slice(0, 60));
await page.evaluate(() => { try { closeModal(); } catch (e) { /* none open */ } });

// ---------------------------------------------------------------- 4. one bad row must not blank a page
const bad = await page.evaluate(() => {
  localStorage.setItem('gp_orders', JSON.stringify([
    { id: 'ok1', date: new Date().toISOString(), customer: 'תקין', items: [{ name: 'x', cat: 'c', qty: 1, unit: 100 }], total: 100, status: 'שולם' },
    { id: 'bad1', date: new Date().toISOString(), customer: 'שורה פגומה', total: 50, status: 'שולם' },   // no items at all
  ]));
  let threw = null;
  try { renderOrders(); } catch (e) { threw = String(e); }
  const t = document.getElementById('page-orders').innerText;
  return { threw, showsGood: t.includes('תקין'), showsBad: t.includes('שורה פגומה') };
});
check('a sale with no items does not throw', bad.threw === null, bad.threw);
check('the healthy rows still render beside it', bad.showsGood === true, bad);
check('and the malformed row is shown rather than swallowed', bad.showsBad === true, bad);

const quote = await page.evaluate(() => {
  const o = { id: 'bad1', date: new Date().toISOString(), customer: 'שורה פגומה', total: 50, status: 'הצעה' };
  try { return { ok: typeof buildQuoteText(o) === 'string' }; } catch (e) { return { ok: false, err: String(e) }; }
});
check('and a quote can still be built from it', quote.ok === true, quote);

if (SELFTEST) console.log('\n[selftest] the numeric id and the strict === lookup were put back;\n[selftest] the saved-models checks must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
