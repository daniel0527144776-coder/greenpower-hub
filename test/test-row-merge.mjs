// Two devices must not overwrite each other's rows (2026-09-25).
//
//   node test/test-row-merge.mjs
//   node test/test-row-merge.mjs --selftest
//
// Daniel: four of seven cell models vanished from stock. Every write pushed the WHOLE list and
// every pull adopted the whole list, so a device holding an old copy wiped rows it never had.
// Stock, hours and wage payments now merge row by row, on pull AND on push (read-merge-write),
// with tombstones for rows deleted on purpose.
//
// The cloud is simulated in the page: a small in-memory hub_state that answers the same three
// requests Sync makes (read all, read two keys, upsert).
//
// --selftest makes the merge adopt the cloud's list wholesale — the old behaviour — and the
// "old device cannot wipe rows" checks must go red.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4371, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4371/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => {
  localStorage.clear();
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  // a fake cloud
  window.CLOUD = {};
  const real = window.fetch;
  window.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!/hub_state/.test(u)) return real(url, opt);
    if (opt.method === 'POST') {
      const b = JSON.parse(opt.body);
      window.CLOUD[b.key] = { value: b.value, updated_at: b.updated_at };
      return new Response('[]', { status: 201 });
    }
    const m = u.match(/key=in\.\(([^)]*)\)/);
    const keys = m ? m[1].split(',') : null;
    const out = Object.entries(window.CLOUD).filter(([k]) => !keys || keys.includes(k))
      .map(([k, v]) => ({ key: k, value: v.value, updated_at: v.updated_at }));
    return new Response(JSON.stringify(out), { status: 200 });
  };
  Sync.isAuthed = () => true;
  Sync.userId = 'u1';
  Sync._headers = async () => ({});
});
if (SELFTEST) await page.evaluate(() => { window.mergeRows = (k, local, server) => (Array.isArray(server) ? server : local); });

const later = () => new Date(Date.now() + 60000).toISOString();
const r = await page.evaluate(async (LATER) => {
  const wait = async (k) => { await (Sync._pushChain[k] || Promise.resolve()); };
  const cell = (id, name, qty) => ({ id, name: 'תאי EVE ' + name, qty, cat: 'תאים' });
  const out = {};

  // 1. this device has 7 cell models; the cloud holds an OLD list of 3, stamped newer
  Store.set('inventory', ['50E', '50SG', '50PL', '40P', '35V', '26V', '25P'].map((n, i) => cell('c' + i, n, 100 + i)));
  await wait('inventory');
  window.CLOUD.inventory = { value: [cell('c0', '50E', 100), cell('c1', '50SG', 101), cell('c2', '50PL', 102)], updated_at: LATER };
  Sync.dirty.clear();
  await Sync.pull();
  await wait('inventory');
  out.afterPull = (Store.get('inventory') || []).length;
  out.cloudAfterPull = window.CLOUD.inventory.value.length;

  // 2. an OLD device (only 3 rows) changes one count and pushes — it must not wipe the other 4
  const deviceB = [cell('c0', '50E', 100), cell('c1', '50SG', 101), cell('c2', '50PL', 102)];
  localStorage.setItem('gp_inventory', JSON.stringify(deviceB));
  const b = Store.get('inventory'); b[0].qty = 80;
  Store.set('inventory', b);
  await wait('inventory');
  const cloud = window.CLOUD.inventory.value;
  out.cloudAfterOldPush = cloud.length;
  out.editKept = (cloud.find((x) => x.id === 'c0') || {}).qty;

  // 3. a row deleted on purpose stays deleted, even though the cloud still has it
  Store.set('inventory', Store.get('inventory').filter((x) => x.id !== 'c6'));
  await wait('inventory'); await wait('tomb_inventory');
  await Sync.pull();
  out.deletedStays = !(Store.get('inventory') || []).some((x) => x.id === 'c6') && !window.CLOUD.inventory.value.some((x) => x.id === 'c6');

  // 4. a newer edit made on another device wins over this device's older copy
  const cv = window.CLOUD.inventory.value.map((x) => (x.id === 'c1' ? { ...x, qty: 55, _u: Date.now() + 5000 } : x));
  window.CLOUD.inventory = { value: cv, updated_at: LATER };
  await Sync.pull();
  out.newerWins = (Store.get('inventory').find((x) => x.id === 'c1') || {}).qty;

  // 5. hours: two devices each add a shift — both survive
  Store.set('worktime', [{ id: 'wA', workerName: 'יוסי', rate: 45, hours: 3, date: '2026-09-20T09:00:00.000Z' }]);
  await wait('worktime');
  window.CLOUD.worktime = { value: [{ id: 'wB', workerName: 'יוסי', rate: 45, hours: 5, date: '2026-09-21T09:00:00.000Z', _u: Date.now() }], updated_at: LATER };
  Sync.dirty.clear();
  await Sync.pull();
  await wait('worktime');
  out.hours = (Store.get('worktime') || []).map((x) => x.id).sort().join(',');
  return out;
}, later());

check('a pull from a cloud holding an old list keeps all 7 models here', r.afterPull === 7, r);
check('and puts the missing 4 back into the cloud', r.cloudAfterPull === 7, r);
check('a device with an old list cannot wipe rows it never had', r.cloudAfterOldPush === 7, r);
check('while its own change still goes through', r.editKept === 80, r);
check('a row deleted on purpose stays deleted', r.deletedStays === true, r);
check('a newer change from another device wins', r.newerWins === 55, r);
check('hours added on two devices both survive', r.hours === 'wA,wB', r);
check('no page errors', errs.length === 0, errs.join(' | '));
check('no native dialogs', dialogs.length === 0, dialogs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
