// A new version arrives by itself (v444, Daniel 2026-10-15: "שגרסה חדשה מתעדכן אוטומטי").
//
//   node test/test-auto-update.mjs
//   node test/test-auto-update.mjs --selftest   (the live version is never read: every "reloads" check fails)
//
// What must happen: a newer live build reloads the page. What must NOT: a reload over his work —
// a window open, a field he is typing in or has changed, the label editor — or for the same build.
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

let liveTag = null;   // null: serve dist/sw.js as it is
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  let body = fs.readFileSync(f);
  if (rel === 'sw.js' && liveTag) body = Buffer.from(String(body).replace(/gp-hub-v\d+/, liveTag));
  r.writeHead(200); r.end(body);
});
await new Promise((r) => srv.listen(4233, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto('http://localhost:4233/index.html');
await page.waitForFunction(() => typeof window.checkForNewBuild === 'function', null, { timeout: 30000 });
await page.evaluate((SELF) => {
  document.getElementById('loginOverlay').style.display = 'none';
  if (typeof init === 'function') init();
  window.__reloads = 0;
  window.hubReload = () => { window.__reloads++; };
  if (SELF) window.liveBuild = async () => 0;
}, SELFTEST);
const now = await page.evaluate(() => buildNum(HUB_BUILD));
const run = (prep) => page.evaluate(async (prep) => {
  closeModal(); if (typeof closeNotice === 'function') closeNotice();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  navigateTo(prep.page || 'home');
  if (prep.modal) openModal('x', 'y');
  if (prep.type) { const el = document.getElementById(prep.type); el.value = 'דני'; if (prep.focus) el.focus(); }
  const before = window.__reloads;
  const said = await checkForNewBuild();
  if (prep.type) { const el = document.getElementById(prep.type); el.value = el.defaultValue; el.blur(); }
  return { reloaded: window.__reloads - before, said };
}, prep);

liveTag = 'gp-hub-v' + now;
check('the same build: no reload', (await run({})).reloaded === 0, '');
liveTag = 'gp-hub-v' + (now + 1);
check('a newer build on a quiet page reloads it', (await run({})).reloaded === 1, '');
check('not with a window open', (await run({ modal: true })).reloaded === 0, '');
check('not while he is typing', (await run({ page: 'calc', type: 'custName', focus: true })).reloaded === 0, '');
check('not with a field on the page he has changed', (await run({ page: 'calc', type: 'custName' })).reloaded === 0, '');
check('not on the label editor', (await run({ page: 'stickers' })).reloaded === 0, '');
check('and when he is done, the next look reloads it', (await run({ page: 'calc' })).reloaded === 1, '');
liveTag = 'gp-hub-v' + (now - 1);
check('an older live build (a deploy still on its way) never reloads', (await run({})).reloaded === 0, '');
check('no JS errors', errs.length === 0, errs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
