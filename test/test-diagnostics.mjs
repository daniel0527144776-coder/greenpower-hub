// The diagnostic helper (page 'diag', added 2026-09-10).
//
//   node test/test-diagnostics.mjs
//   node test/test-diagnostics.mjs --selftest
//
// Asked for on 2026-09-01 and not built until now: "Diagnostic helper, in the hub, for him.
// Symptoms in, ordered checks out. Built on his own experience, not invented."
//
// The two checks worth having are the ones that fail SILENTLY:
//
//   * a price typed into the draft prose. This repo's oldest rule is that a restated price is
//     a copy, not a derivation, and rots without saying so — the ChatBot quoted ₪4,800 against
//     a real ₪6,100. So a step names a catalogue row and the price is read from PRICING when
//     the row is drawn. A ₪ figure appearing in the draft text is the defect.
//
//   * Daniel's own corrections being wiped. The draft lives in code and his additions live in
//     the synced `diag_notes` key, never merged into one another — the DEFAULT_REPLIES trap,
//     where a seed copied into storage means no later improvement ever reaches the device.
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
await new Promise((r) => srv.listen(4341, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
// Recorded, not accepted: a native dialog is invisible in the WebView on Daniel's phone, so
// raising one at all is the bug.
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

await page.goto('http://localhost:4341/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });
await page.evaluate(() => navigateTo('diag'));
await page.waitForTimeout(350);

const base = await page.evaluate(() => ({
  cards: document.querySelectorAll('#diagList .card').length,
  symptoms: DIAG.length,
  text: document.getElementById('page-diag').innerText,
}));
check('every symptom renders a card', base.cards === base.symptoms && base.cards >= 8, `${base.cards} cards / ${base.symptoms} symptoms`);
check('the page says plainly that it is a draft to correct', /טיוטה/.test(base.text), base.text.slice(0, 60));

const open = await page.evaluate(() => {
  toggleDiag('range');
  return { steps: document.querySelectorAll('#diagList ol li').length, text: document.getElementById('page-diag').innerText };
});
check('opening a symptom lists ordered checks', open.steps >= 4, open.steps);
// His framing, kept: the common failure is cells that drop, not welds.
check('the range symptom leads on cells, not welds', /תאים|קבוצ/.test(open.text), open.text.slice(0, 90));

// SELFTEST breaks the THING UNDER TEST, so it is the real assertions below that go red.
if (SELFTEST) {
  await page.evaluate(() => {
    DIAG[0].checks.push('החלפת שורה שלמה עולה ₪260');   // a price restated in prose
    DIAG[0].services.push('שירות שנמחק מהמחירון');       // a catalogue row that no longer exists
  });
}

const prices = await page.evaluate(() => {
  const typed = [];
  for (const d of DIAG) {
    const m = [d.usually, ...d.checks].join(' ').match(/₪\s?\d[\d,]*/g);
    if (m) typed.push(d.id + ':' + m.join(','));
  }
  const missing = [];
  for (const d of DIAG) for (const s of d.services) if (!PRICING.some((p) => p.name === s)) missing.push(d.id + ':' + s);
  return { typed, missing };
});
check('no price is written into the draft text', prices.typed.length === 0, prices.typed);
check('every linked service still exists in the catalogue by name', prices.missing.length === 0, prices.missing);

const live = await page.evaluate(() => {
  const name = 'איזון תאים עמוק';
  const row = PRICING.find((p) => p.name === name);
  return { shown: diagPrice(name), catalogue: row ? String(row.retail) : null };
});
check('a service price is read from the catalogue, not stored',
  !!live.shown && live.shown.replace(/\D/g, '') === String(live.catalogue).replace(/\D/g, ''),
  `${live.shown} vs catalogue ${live.catalogue}`);

// His corrections: additive, and never seeded over.
const mine = await page.evaluate(() => {
  const seeded = localStorage.getItem('gp_diag_notes');
  localStorage.setItem('gp_diag_notes', JSON.stringify({
    range: { checks: ['לבדוק את המחבר של הבקר'], note: 'אצלי זה תמיד הקבוצה האחרונה' },
  }));
  state.diagOpen = 'range';
  renderDiag();
  const t = document.getElementById('page-diag').innerText;
  return {
    seeded,
    myCheck: t.includes('לבדוק את המחבר של הבקר'),
    myNote: t.includes('אצלי זה תמיד הקבוצה האחרונה'),
    draftKept: t.includes('מדוד מתח מנוחה'),
  };
});
check('the draft is NOT copied into storage on load', mine.seeded === null, mine.seeded);
check('a check he added is shown', mine.myCheck, mine.myCheck);
check('a note he wrote is shown', mine.myNote, mine.myNote);
check('and the draft is still there beside his', mine.draftKept, mine.draftKept);

if (SELFTEST) console.log('\n[selftest] a typed price and a dead service name were injected into the draft;\n[selftest] the two checks naming them must have gone red.');

check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
