// Auto-advance and Hebrew narration on the presentation (added 2026-09-10).
//
//   node test/test-deck-play.mjs
//   node test/test-deck-play.mjs --selftest
//
// Daniel asked for "another attempt at Hebrew narration — THIS TIME WITH A CHECK THAT SAYS
// IMMEDIATELY IF NO HEBREW VOICE EXISTS." The previous attempt failed silently, which is this
// repo's recurring shape: the button does nothing and nothing says why.
//
// So the assertions here are about WHAT THE PAGE SAYS, not about whether audio came out.
// Headless Chromium ships zero voices, which is exactly the case that has to keep working:
// the deck must still advance, and must still explain itself.
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
await new Promise((r) => srv.listen(4342, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto('http://localhost:4342/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });
await page.evaluate(() => navigateTo('help'));
await page.waitForTimeout(350);

// SELFTEST breaks the thing under test: a voice check that says nothing, which IS the bug
// being fixed. The three assertions naming it must go red.
if (SELFTEST) await page.evaluate(() => { window.gpDeckVoiceCheck = function () {}; });

const controls = await page.evaluate(() => ({
  play: !!document.getElementById('gpdPlay'),
  speak: !!document.getElementById('gpdSpeak'),
  note: !!document.getElementById('gpdVoiceNote'),
  slides: document.querySelectorAll('#gpDeck .gpd-slide').length,
}));
check('the deck has a play button', controls.play, controls.play);
check('and a narration toggle', controls.speak, controls.speak);
check('and a place to report the voice state', controls.note, controls.note);
check('the deck still has its slides', controls.slides >= 10, controls.slides);

const voices = await page.evaluate(() => (window.speechSynthesis ? (speechSynthesis.getVoices() || []).length : -1));
console.log(`  (this browser reports ${voices} voices)`);

await page.evaluate(() => gpDeckVoiceCheck());
await page.waitForTimeout(900);
const note = await page.evaluate(() => {
  const n = document.getElementById('gpdVoiceNote');
  return { shown: !!n && getComputedStyle(n).display !== 'none', text: n ? n.textContent.trim() : '' };
});
check('the voice check reports visibly', note.shown, note.shown);
// "בודק…" is the interim state; being stuck on it is the silent failure wearing a hat.
check('and says in words what it found', /קול עברי|מנוע הקראה/.test(note.text) && !/בודק/.test(note.text), note.text);
check('it never leaves the user guessing', note.text.length > 10, note.text);

const adv = await page.evaluate(async () => {
  window.GPD_SECONDS = 1;                       // the no-voice pace, sped up
  const start = window.gpDeckI;
  gpDeckTogglePlay();
  await new Promise((r) => setTimeout(r, 2600));
  const moved = window.gpDeckI;
  gpDeckStop();
  return { start, moved, playing: window.gpdPlaying };
});
check('auto-advance moves the deck on even with no voice', adv.moved > adv.start, `${adv.start} -> ${adv.moved}`);
check('and stop actually stops it', adv.playing === false, adv.playing);

const end = await page.evaluate(async () => {
  window.GPD_SECONDS = 0.2;
  const total = document.querySelectorAll('#gpDeck .gpd-slide').length;
  while (window.gpDeckI < total - 1) gpDeckGo(1);
  gpDeckTogglePlay();
  await new Promise((r) => setTimeout(r, 900));
  return { i: window.gpDeckI, total, playing: window.gpdPlaying };
});
check('it stops on the last slide instead of looping for ever',
  end.i === end.total - 1 && end.playing === false, `slide ${end.i + 1}/${end.total} playing=${end.playing}`);

const left = await page.evaluate(async () => {
  window.GPD_SECONDS = 0.2;
  gpDeckGo(1);
  gpDeckTogglePlay();
  navigateTo('home');
  await new Promise((r) => setTimeout(r, 700));
  return window.gpdPlaying;
});
check('leaving the help page stops it talking', left === false, left);

await page.evaluate(() => { try { gpDeckStop(); } catch (e) { /* already stopped */ } });
if (SELFTEST) console.log('\n[selftest] the voice check was silenced; the three checks naming it must have gone red.');
check('no page errors', errs.length === 0, errs);

await browser.close(); srv.close();
process.exit(finish());
