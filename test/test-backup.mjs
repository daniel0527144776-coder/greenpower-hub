// The daily backup, in the cloud (2026-10-06).
//
//   node test/test-backup.mjs
//   node test/test-backup.mjs --selftest     (the upload refused; the restore finds nothing)
//
// Daniel: "תעשה שיהיה העלה לענן וגם גיבוי אטומטי זה כל פעם קופץ לי". What must hold: once a day the
// whole store goes up as bk_<weekday>, packed, and comes back whole; a second run the same day sends
// nothing; pull() never downloads the backups; the reminder on the home page stays away while the
// daily one runs; and a restore from a day only ADDS the rows missing here — a row changed since is
// left as it is now.
//
// The cloud is simulated in the page: a small hub_state answering the requests made here.
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
await new Promise((r) => srv.listen(4374, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto('http://localhost:4374/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.cloudBackup === 'function', null, { timeout: 30000 });
await page.evaluate(() => {
  localStorage.clear();
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  window.CLOUD = {};
  window.REQS = [];
  const real = window.fetch;
  window.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!/hub_state/.test(u)) return real(url, opt);
    window.REQS.push((opt.method || 'GET') + ' ' + u.replace(/^.*hub_state/, ''));
    if (opt.method === 'POST') {
      const b = JSON.parse(opt.body);
      window.CLOUD[b.key] = { value: b.value, updated_at: b.updated_at };
      return new Response('[]', { status: 201 });
    }
    const like = u.match(/key=like\.([a-z_]+)\*/), notLike = u.match(/key=not\.like\.([a-z_]+)\*/), eq = u.match(/key=eq\.([^&]+)/);
    const out = Object.entries(window.CLOUD)
      .filter(([k]) => (!like || k.startsWith(like[1])) && (!notLike || !k.startsWith(notLike[1])) && (!eq || k === decodeURIComponent(eq[1])))
      .map(([k, v]) => ({ key: k, value: v.value, updated_at: v.updated_at }));
    return new Response(JSON.stringify(out), { status: 200 });
  };
  Sync.isAuthed = () => true;
  Sync.userId = 'u1';
  Sync._headers = async () => ({});
});
if (SELFTEST) await page.evaluate(() => {
  window.cloudBackupRun = async () => false;
  window.missingRowsFrom = () => ({});
});

const r = await page.evaluate(async () => {
  const out = {};
  Store.set('customers', [{ id: 'c1', name: 'רונן', phone: '0501111111' }, { id: 'c2', name: 'משה', phone: '0502222222' }]);
  Store.set('worktime', [{ id: 'w1', workerName: 'יוסי', hours: 5, rate: 40, date: new Date().toISOString() }]);
  await Promise.all(Object.values(Sync._pushChain));
  REQS.length = 0;
  out.ok = await cloudBackup();
  const key = 'bk_' + new Date().getDay();
  const row = CLOUD[key];
  out.key = !!row;
  out.packed = row ? row.value.enc : null;
  const back = row ? await bkUnpack(row.value) : null;
  out.back = back ? { customers: (back.customers || []).length, worktime: (back.worktime || []).length } : null;
  out.posts = REQS.filter((x) => x.startsWith('POST')).length;
  out.stamp = !!Store.get('lastCloudBackup');
  REQS.length = 0;
  await cloudBackup();
  out.secondPosts = REQS.filter((x) => x.startsWith('POST')).length;
  // pull: asks for everything except the backups
  REQS.length = 0;
  await Sync.pull();
  out.pullUrl = REQS.find((x) => x.startsWith('GET ?select=key,value,updated_at')) || '';
  // the reminder on the home page
  navigateTo('home');
  out.bannerFresh = document.getElementById('backupReminder').style.display;
  localStorage.setItem('gp_lastCloudBackup', JSON.stringify(Date.now() - 9 * 864e5));
  navigateTo('settings'); navigateTo('home');
  out.bannerOld = { shown: document.getElementById('backupReminder').style.display, text: document.getElementById('backupReminderText').textContent,
    btn: (document.querySelector('#backupReminder button') || {}).getAttribute && document.querySelector('#backupReminder button').getAttribute('onclick') };
  // the restore: a customer deleted by mistake, an hour changed since the backup
  Store.set('customers', [{ id: 'c1', name: 'רונן', phone: '0501111111' }]);
  Store.set('worktime', [{ id: 'w1', workerName: 'יוסי', hours: 7, rate: 40, date: new Date().toISOString() }]);
  await Promise.all(Object.values(Sync._pushChain));
  await openCloudRestore();
  out.listed = document.querySelectorAll('[data-bk]').length;
  await restoreFromCloud(key);
  out.ask = (document.getElementById('noticeBody') || {}).textContent || '';
  if (typeof noticeConfirm === 'function') noticeConfirm();
  await new Promise((res) => setTimeout(res, 50));
  out.after = { customers: (Store.get('customers') || []).map((c) => c.id).sort().join(','), hours: (Store.get('worktime') || [])[0].hours };
  return out;
});
check('a day\'s backup goes up as bk_<weekday>, packed', r.ok === true && r.key && r.packed === 'gzip64' && r.posts === 1, r);
check('and comes back whole', r.back && r.back.customers === 2 && r.back.worktime === 1, r.back);
check('it is stamped, and a second run the same day sends nothing', r.stamp && r.secondPosts === 0, [r.stamp, r.secondPosts]);
check('a pull never downloads the backups', /key=not\.like\.bk_\*/.test(r.pullUrl), r.pullUrl);
check('with the daily backup running, the home page asks nothing', r.bannerFresh === 'none', r.bannerFresh);
check('nine days without it, it says so, and its button backs up to the cloud', r.bannerOld.shown === 'block' && /9 ימים/.test(r.bannerOld.text) && r.bannerOld.btn === 'backupNow()', r.bannerOld);
check('the restore lists the days in the cloud', r.listed >= 1, r.listed);
check('it asks before adding what is missing, and names it', /להחזיר 1 שורות/.test(r.ask), r.ask.slice(0, 120));
check('the deleted customer comes back, and the hour changed since keeps its new value', r.after.customers === 'c1,c2' && r.after.hours === 7, r.after);
check('no page errors', errs.length === 0, errs.join(' | '));
check('no native dialogs', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
