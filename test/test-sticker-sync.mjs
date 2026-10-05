// A printed sticker must survive the next cloud sync (2026-09-24).
//
//   node test/test-sticker-sync.mjs
//   node test/test-sticker-sync.mjs --selftest
//
// Daniel: "יש מדבקות שהוצאתי וזה לא נשמר". The editor wrote gp_sticker_history straight to
// localStorage and never told Sync, so the next pull() saw the server's OLDER row as newer
// and overwrote the list — the label just printed was gone. Now the editor saves through the
// hub (hubAddSticker) and pull() MERGES this key instead of replacing it; a deletion is a
// tombstone so the merge cannot bring it back.
//
// --selftest restores the old pull behaviour for this key (plain replace) and must go red.
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
await new Promise((r) => srv.listen(4361, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.goto('http://localhost:4361/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await page.evaluate(() => {
  localStorage.clear();
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  init();
});

// 1. the editor, running inside the hub, saves a label
await page.evaluate(() => navigateTo('stickers'));
const frame = await (await page.waitForSelector('#page-stickers iframe', { timeout: 30000 })).contentFrame();
await frame.waitForFunction(() => typeof window.resetStickerDesign === 'function', null, { timeout: 60000 });
await page.waitForTimeout(800);
// the real download button — the same path a printed label takes to saveStickerRecord()
const dl = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
await frame.locator('.download-btn[data-format="pdf"]').click();
await dl;
await page.waitForTimeout(800);
const afterPrint = await page.evaluate(() => {
  const arr = Store.get('sticker_history') || [];
  return { n: arr.length, hasId: !!(arr[0] && arr[0].id), queued: Sync.dirty.has('sticker_history') };
});
check('a label saved in the editor lands in the hub\'s list', afterPrint.n === 1 && afterPrint.hasId, afterPrint);
check('and is queued for the cloud, not just written to the phone', afterPrint.queued, afterPrint);

// 2. a pull against an OLDER server copy keeps it
if (SELFTEST) {
  await page.evaluate(() => { window.mergeStickerHistory = (local, server) => server; });
}
const pulled = await page.evaluate(async () => {
  Sync.dirty.clear();                      // pretend the queue was lost (reload, tab closed)
  const old = { id: 'srv1', type: 'new', date: '2026-09-01T10:00:00.000Z', sku: 'GP-OLD', client: 'ישן' };
  Sync.isAuthed = () => true;
  Sync._headers = async () => ({});
  const pushed = [];
  Sync.push = async (k, v) => { pushed.push([k, v.length]); };
  const real = window.fetch;
  window.fetch = async (url) => /hub_state/.test(String(url))
    ? new Response(JSON.stringify([{ key: 'sticker_history', value: [old], updated_at: new Date(Date.now() + 60000).toISOString() }]), { status: 200 })
    : real(url);
  await Sync.pull();
  window.fetch = real;
  const arr = Store.get('sticker_history') || [];
  return { n: arr.length, skus: arr.map((s) => s.sku || s.id), pushed };
});
check('a sync with an older cloud copy keeps the new label AND the old one', pulled.n === 2, pulled);
check('and sends the merged list back up', pulled.pushed.some(([k, n]) => k === 'sticker_history' && n === 2), pulled);

// 3. a deleted label stays deleted through the next merge
const del = await page.evaluate(async () => {
  navigateTo('stickerlog');
  const arr = Store.get('sticker_history');
  const i = arr.findIndex((s) => s.id === 'srv1');
  deleteSticker(i);
  await new Promise((r) => setTimeout(r, 100));
  noticeConfirm();
  const merged = mergeStickerHistory(Store.get('sticker_history'), [{ id: 'srv1', type: 'new', date: '2026-09-01T10:00:00.000Z', sku: 'GP-OLD' }]);
  const shown = document.getElementById('stickerlogList').innerText;
  return { stillDeleted: merged.find((s) => s.id === 'srv1').deleted === true, shown: !/GP-OLD/.test(shown) };
});
check('a deleted label is gone from the list', del.shown, del);
check('and a device still holding it cannot bring it back', del.stillDeleted, del);
check('no "clear all" button is left on the stickers page',
  await page.evaluate(() => ![...document.querySelectorAll('#page-stickerlog button')].some((b) => /נקה הכל/.test(b.textContent))));

check('no page errors', errs.length === 0, errs.join(' | '));
check('no native dialogs', dialogs.length === 0, dialogs.join(' | '));
await browser.close();
srv.close();
process.exit(finish());
