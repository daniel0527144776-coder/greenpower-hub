// The accountant's import, and whether it survives the trip to the cloud.
//
//   node test/test-import-and-sync.mjs
//   node test/test-import-and-sync.mjs --selftest
//
// Daniel, 2026-09-10: "כל הלקוחות 144 לא נכנסו ללקוחות קיימים וגם כל החשבונות הכספיים של כל
// השנים אחורה לא נכנסו." The import CODE was fine — on a clean profile it writes 144 customers
// and 153 income rows going back to May 2020. Two other things lost it, and both were silent:
//
// 1. STORAGE. A job carries two downscaled photos, so EIGHTEEN jobs reach the ~5M-character
//    localStorage ceiling. Past it Store.set returns false — and importAccounting ignored the
//    return value and fired its own "✅ … 153 רשומות הכנסה" straight over Store.set's error.
//    Measured before the fix: customers 144, incomes 0, notice ✅.
//
// 2. SYNC. Sync.dirty is the only record that a key still owes the server, and it lived in
//    memory. A push that failed once was forgotten on the next open — flush() had nothing to
//    retry, and pull()'s "push the keys the server is missing" loop does not fire for a key the
//    server already holds an older row for. The PC kept 144, the server kept 2, and the first
//    write from the phone then overwrote the PC.
//
// This suite reads the REAL accounting-import.json when it is there. That file lives in the
// tools root, which CI cannot see (see the memory note), so the payload falls back to a
// generated one of the same shape — the assertions are about behaviour, not about his data.
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

// The real file if this machine has it; otherwise the same shape, so CI can run this at all.
const REAL = path.join(HERE, '..', '..', 'accounting-import.json');
let PAYLOAD, REALDATA = false;
try {
  PAYLOAD = fs.readFileSync(REAL, 'utf8'); JSON.parse(PAYLOAD); REALDATA = true;
} catch {
  const customers = Array.from({ length: 144 }, (_, i) => ({
    name: 'לקוח ' + i, phone: '05' + String(20000000 + i), firstVisit: new Date(2020, 4, 7).toISOString(),
  }));
  const incomes = Array.from({ length: 153 }, (_, i) => ({
    amount: 500 + i, date: new Date(2020 + (i % 5), i % 12, 1 + (i % 27)).toISOString(),
    customer: 'לקוח ' + i, invoice: 'INV' + i,
  }));
  PAYLOAD = JSON.stringify({ customers, incomes });
}
console.log(`  (payload: ${REALDATA ? 'the real accounting-import.json' : 'a generated stand-in — the tools root is not visible here'})`);

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4345, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

// a hub_state server that lives in the page, so it outlives evaluate() but not a reload
await page.addInitScript(() => {
  window.__srv = { rows: {}, online: true };
  window.__srv.rows['customers'] = {
    key: 'customers',
    value: [{ name: 'ישן א', phone: '0500000001' }, { name: 'ישן ב', phone: '0500000002' }],
    updated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  };
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('/rest/v1/hub_state')) {
      if (!window.__srv.online) throw new TypeError('Failed to fetch');
      if (!opts || (opts.method || 'GET') === 'GET') {
        return new Response(JSON.stringify(Object.values(window.__srv.rows)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (opts.method === 'POST') {
        const b = JSON.parse(opts.body);
        window.__srv.rows[b.key] = { key: b.key, value: b.value, updated_at: b.updated_at };
        return new Response('[]', { status: 201 });
      }
    }
    return realFetch(url, opts);
  };
});
const auth = () => page.evaluate(() => {
  Sync.session = { access_token: 'fake', refresh_token: 'fake', expires_at: Date.now() + 3600e3, email: 'x@y.z' };
  Sync.userId = 'u1'; Sync.email = 'x@y.z';
  Sync._headers = async () => ({ apikey: 'k', Authorization: 'Bearer fake', 'Content-Type': 'application/json' });
});

await page.goto('http://localhost:4345/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await auth();
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; init(); });

// ---------------------------------------------------------------- 1. a clean import
const clean = await page.evaluate(async (p) => {
  openAccountingImport();
  document.getElementById('acctJson').value = p;
  importAccounting();
  await new Promise((r) => setTimeout(r, 600));
  const cust = JSON.parse(localStorage.getItem('gp_customers') || '[]');
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  return { cust: cust.length, inc: inc.length, books: cust.filter((c) => c.src === 'books').length,
           oldest: inc.length ? inc.map((r) => r.date).sort()[0] : null };
}, PAYLOAD);
check('the import writes every customer', clean.cust === 144, clean.cust);
check('and every income row', clean.inc === 153, clean.inc);
check('and marks them as coming from the books', clean.books === 144, clean.books);
check('and the history really does go years back', clean.oldest && new Date(clean.oldest).getFullYear() <= 2021, clean.oldest);

// they must be findable where he looks for them
const findable = await page.evaluate(() => {
  const target = JSON.parse(localStorage.getItem('gp_customers'))
    .filter((c) => c.src === 'books' && c.phone && c.name)
    .sort((a, b) => new Date(a.lastVisit || 0) - new Date(b.lastVisit || 0))[0];
  navigateTo('calc');
  const s = document.getElementById('custSearch');
  s.value = target.name.slice(0, 6);
  refreshCustomerSelect();
  const box = document.getElementById('custPickRows') || document.querySelector('.cust-pick-rows');
  const rows = box ? box.querySelectorAll('.cust-pick-row').length : 0;
  navigateTo('customers');
  const listed = ((document.getElementById('customersList') || {}).innerText || '').match(/📱/g) || [];
  return { name: target.name, rows, listed: listed.length };
});
check('the OLDEST imported customer is findable by search', findable.rows > 0, findable);
check('and the customers page lists them all', findable.listed === 144, findable.listed);

// ---------------------------------------------------------------- 2. it must reach the cloud
const cloud = await page.evaluate(async () => {
  await Sync.flush().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  return { server: (window.__srv.rows['customers'].value || []).length, owed: Sync.pending() };
});
check('the import is pushed to the cloud, so the phone gets it', cloud.server === 144, cloud);

// ---------------------------------------------------------------- 3. the queue outlives a reload
const queued = await page.evaluate(async () => {
  window.__srv.online = false;                       // the network drops mid-edit
  const c = JSON.parse(localStorage.getItem('gp_customers'));
  c.push({ name: 'נוסף בלי רשת', phone: '0507654321' });
  Store.set('customers', c);
  await new Promise((r) => setTimeout(r, 300));
  return Sync.pending();
});
check('a failed push is queued', queued.includes('customers'), queued);

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.navigateTo === 'function', null, { timeout: 30000 });
await auth();
if (SELFTEST) {
  // Put the bug back: a queue that does not survive a reload. Everything below must go red.
  await page.evaluate(() => { Sync.dirty = new Set(); Sync._saveDirty = () => {}; Sync._dirtyAdd = (k) => Sync.dirty.add(k); });
}
const survived = await page.evaluate(() => Sync.pending());
check('and the queue survives the reload', survived.includes('customers'), survived);

const banner = await page.evaluate(() => {
  const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
  init(); navigateTo('home'); refreshHome();
  const b = document.getElementById('syncPending');
  return { shown: !!b && getComputedStyle(b).display !== 'none', text: (document.getElementById('syncPendingText') || {}).innerText || '' };
});
check('the home page says something has not reached the cloud', banner.shown, banner);

// pull must not overwrite a key that still owes the server
const protectedPull = await page.evaluate(async () => {
  window.__srv.online = true;
  await Sync.pull().catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  return JSON.parse(localStorage.getItem('gp_customers') || '[]').length;
});
check('a pull does not overwrite data that is still owed to the server', protectedPull >= 145, protectedPull);

const recovered = await page.evaluate(async () => {
  const left = await Sync.flush().catch(() => -1);
  await new Promise((r) => setTimeout(r, 400));
  return { left, server: (window.__srv.rows['customers'].value || []).length };
});
check('and the retry finally lands it', recovered.server >= 145 && recovered.left === 0, recovered);

// ---------------------------------------------------------------- 4. a full disk must not lie
const full = await page.evaluate(async (p) => {
  localStorage.setItem('gp_incomes', '[]');
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(140 * 1024);
  const jobs = [];
  try {
    for (let i = 0; i < 40; i++) {
      jobs.push({ id: 'j' + i, date: new Date(Date.now() - i * 86400000).toISOString(), customerName: 'לקוח ' + i,
        customerPhone: '05' + (10000000 + i), price: 1000, cost: 500, profit: 500, jobs: ['full'], photoBefore: photo, photoAfter: photo });
      localStorage.setItem('gp_jobs', JSON.stringify(jobs));
    }
  } catch (e) { /* full, which is the point */ }
  navigateTo('home'); refreshHome();
  const warn = document.getElementById('storageWarn');
  const warned = !!warn && getComputedStyle(warn).display !== 'none';
  const info = storageInfo();
  openAccountingImport();
  document.getElementById('acctJson').value = p;
  importAccounting();
  await new Promise((r) => setTimeout(r, 500));
  const notice = ((document.getElementById('noticeBackdrop') || {}).innerText || '');
  return { warned, pct: info.pct, incomes: JSON.parse(localStorage.getItem('gp_incomes') || '[]').length, notice: notice.replace(/\s+/g, ' ').slice(0, 120) };
}, PAYLOAD);
check('a nearly-full device says so before he tries', full.warned, full);
check('the meter is a percentage, not a number over 100', full.pct <= 100, full.pct);
// This is the one that was silent, and it is the whole reason the years of accounts vanished.
check('an import that could not save must NOT report success', !/^✅/.test(full.notice.trim()), full.notice);
check('and it must say what failed', /לא הושלם|אין מקום/.test(full.notice), full.notice);

// ---------------------------------------------------------------- 5. freeing space, and retrying
const freed = await page.evaluate(async () => {
  const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none';
  const before = storageInfo().pct;
  freeUpSpace();
  await new Promise((r) => setTimeout(r, 150));
  noticeConfirm();                      // offsetParent is null for a fixed element; call it
  await new Promise((r) => setTimeout(r, 400));
  const jobs = JSON.parse(localStorage.getItem('gp_jobs') || '[]');
  return { before, after: storageInfo().pct, jobs: jobs.length,
           pricesKept: jobs.every((j) => j.price === 1000), namesKept: jobs.every((j) => !!j.customerName) };
});
check('freeing space actually frees space', freed.after < freed.before, freed);
check('and never deletes a job', freed.jobs === 18, freed.jobs);
check('nor a price', freed.pricesKept, freed);
check('nor a customer name', freed.namesKept, freed);

const retried = await page.evaluate(async (p) => {
  const n = document.getElementById('noticeBackdrop'); if (n) n.style.display = 'none';
  openAccountingImport();
  document.getElementById('acctJson').value = p;
  importAccounting();
  await new Promise((r) => setTimeout(r, 600));
  const cust = JSON.parse(localStorage.getItem('gp_customers') || '[]');
  const phones = cust.map((c) => c.phone).filter(Boolean);
  return { incomes: JSON.parse(localStorage.getItem('gp_incomes') || '[]').length, dupes: phones.length - new Set(phones).size };
}, PAYLOAD);
check('and then the import completes', retried.incomes === 153, retried);
check('re-running it duplicates nobody', retried.dupes === 0, retried);

// ---------------------------------------------------------------- 6. the same sale, twice
// The accountant's books are INVOICE-dated; the WhatsApp ledger already in `incomes` is
// PAYMENT-dated. Where the two periods meet they hold the same sales with dates days apart,
// so importing the books wholesale counts that money twice. Measured on the two real files:
// three sales overlap and only ONE shares a date — ₪5,250 is twelve days out, so a same-date
// check would have caught one of three and silently doubled ₪13,750.
const dedup = await page.evaluate(async () => {
  // a payment-dated ledger, then books holding the same three sales on nearby invoice dates
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
  localStorage.setItem('gp_incomes', JSON.stringify([
    { id: 'w1', amount: 5250, date: iso(2025, 2, 17), note: 'יובא מוואטסאפ' },
    { id: 'w2', amount: 8500, date: iso(2025, 2, 13), note: 'יובא מוואטסאפ' },
    { id: 'w3', amount: 850, date: iso(2025, 2, 23), note: 'יובא מוואטסאפ' },
    { id: 'w4', amount: 1200, date: iso(2025, 3, 4), note: 'יובא מוואטסאפ' },
  ]));
  const payload = JSON.stringify({
    customers: [],
    incomes: [
      { amount: 5250, date: iso(2025, 2, 5), customer: 'פנינת עוזיאל' },   // 12 days out
      { amount: 8500, date: iso(2025, 2, 12), customer: 'אליהו איבגי' },   // 1 day out
      { amount: 850, date: iso(2025, 2, 23), customer: 'רונית לזר' },      // same day
      { amount: 4000, date: iso(2023, 6, 1), customer: 'היסטוריה' },       // no counterpart
      { amount: 1200, date: iso(2021, 1, 1), customer: 'ישן' },            // same amount as w4,
    ],                                                                      // but years away
  });
  openAccountingImport();
  document.getElementById('acctJson').value = payload;
  importAccounting();
  await new Promise((r) => setTimeout(r, 500));
  const inc = JSON.parse(localStorage.getItem('gp_incomes') || '[]');
  const books = inc.filter((r) => r.src === 'books');
  return {
    total: inc.reduce((s, r) => s + (+r.amount || 0), 0),
    books: books.length,
    kept: books.map((r) => Math.round(r.amount)).sort((a, b) => a - b),
    notice: ((document.getElementById('noticeBackdrop') || {}).innerText || '').replace(/\s+/g, ' '),
  };
});
// 15,800 in the ledger + 4,000 + 1,200 of real history = 21,000. Counting the three twice
// would read 35,600.
check('a sale already in the ledger is not imported again', dedup.books === 2, dedup);
check('and the total is not doubled', Math.round(dedup.total) === 21000, dedup.total);
check('a match days apart is still caught, not only a same-day one',
  !dedup.kept.includes(5250) && !dedup.kept.includes(8500), dedup.kept);
// The window must not swallow genuine history that merely shares an amount.
check('but the same amount YEARS away is kept', dedup.kept.includes(1200), dedup.kept);
check('and history with no counterpart is kept', dedup.kept.includes(4000), dedup.kept);
check('the skipped rows are named, never silently dropped',
  /לא יובאו/.test(dedup.notice) && /פנינת עוזיאל/.test(dedup.notice), dedup.notice.slice(0, 160));

if (SELFTEST) console.log('\n[selftest] the dirty queue was made memory-only again;\n[selftest] the checks about surviving a reload must have gone red.');
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);

await browser.close(); srv.close();
process.exit(finish());
