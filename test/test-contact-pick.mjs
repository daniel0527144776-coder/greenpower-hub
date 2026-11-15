// Every contact of his is in "לקוח קיים" (2026-11-15).
//
//   node test/test-contact-pick.mjs
//   node test/test-contact-pick.mjs --selftest     (the picker as it was: customers only; must go red)
//
// The owner: "צריך שבהלקוח הקיים יהיה את כל אנשי הקשר". The picker of a repair and of a sale listed only who
// already had a job or a sale, so someone he has in his phone and serves for the first time was typed in by hand.
// What must hold:
//   - a search finds a contact by name, and by number as he types it (050…, the contact is kept as 97250…);
//   - a contact a customer already has the number of is that customer, not a second row;
//   - with nothing typed the list is the recent customers only (thousands of contacts are not a list to scroll);
//   - picking one fills the name and the phone, in the repair's form and in the sale's;
//   - a contact's name is text, never markup (the name is written by the contact);
//   - the contacts come through his login, are kept on the device and in no synced key, backup or export, and
//     logging out removes them.
// Every name and number here is made up; this repo is public.
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
await new Promise((r) => srv.listen(4439, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [], dialogs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await page.goto('http://localhost:4439/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof customerPickHtml === 'function' && typeof openOrderEditor === 'function', null, { timeout: 30000 });

const r = await page.evaluate(async (SELF) => {
  const g = document.getElementById('loginOverlay'); if (g) g.remove();
  const out = {};
  out.has = typeof pullPickContacts === 'function' && typeof contactMatches === 'function';
  if (!out.has) return out;
  Store.set('customers', [
    { name: 'לקוח ותיק דוגמה', phone: '050-1110001', firstVisit: '2026-01-05T10:00:00.000Z', lastVisit: '2026-10-01T10:00:00.000Z' },
    { name: 'משה דוגמה', phone: '052-2220002', firstVisit: '2026-02-05T10:00:00.000Z', lastVisit: '2026-09-01T10:00:00.000Z' },
  ]);
  const CONTACTS = [
    { p: '972501110001', n: 'ותיק בטלפון דוגמה' },          // a customer already has this number
    { p: '972533330003', n: 'יוסי חדש דוגמה' },
    { p: '972544440004', n: 'משה איש קשר דוגמה' },
    { p: '447700900123', n: 'חבר מחו״ל דוגמה' },
    { p: '972555550005', n: '<img src=x onerror=window.__pwned=1> דוגמה' },
  ];
  // the list comes through his login: the call the bot page makes, answered here
  let asked = 0;
  window.waAdmin = async (body, query) => { asked++; if (query !== 'contacts=1') throw new Error('unexpected call'); return { contacts: CONTACTS }; };
  localStorage.removeItem(PICK_CONTACTS_KEY);
  const dirtyBefore = localStorage.getItem('gpsync_dirty') || '';
  out.pulled = await pullPickContacts(true);
  out.asked = asked;
  out.kept = (JSON.parse(localStorage.getItem(PICK_CONTACTS_KEY) || '{}').list || []).length;
  // not through the store: its keys are what is synced, backed up and exported
  out.synced = (localStorage.getItem('gpsync_dirty') || '') !== dirtyBefore || Object.keys(Store.all()).some((k) => /contact/i.test(k)) || SYNC_KEYS.some((k) => /contact/i.test(k));
  await pullPickContacts();                      // a fresh copy is not asked for again
  out.askedAgain = asked;
  if (SELF) { window.contactMatches = () => ({ rows: [], hits: 0 }); }

  navigateTo('calc');
  const box = document.getElementById('custPickList'), q = document.getElementById('custSearch');
  const search = (text) => { q.value = text; refreshCustomerSelect(); return { text: box.innerText, contacts: [...box.querySelectorAll('[data-pick-contact]')].map((e) => e.querySelector('.cust-pick-name').textContent), customers: [...box.querySelectorAll('.cust-pick-row:not([data-pick-contact])')].length }; };
  document.getElementById('custName').value = '';
  out.idle = search('');
  out.byName = search('יוסי');
  out.both = search('משה');
  out.byLocal = search('053-3330003');
  out.byPart = search('0544');
  out.dup = search('ותיק');
  out.abroad = search('חבר');
  out.evil = search('onerror');
  out.pwned = !!window.__pwned;
  out.evilHtml = /<img/i.test(box.innerHTML);
  // picking, in a repair
  search('יוסי');
  const row = box.querySelector('[data-pick-contact]');
  if (row) row.click();
  out.calc = { name: document.getElementById('custName').value, phone: document.getElementById('custPhone').value, search: q.value };
  search('חבר'); const ab = box.querySelector('[data-pick-contact]'); if (ab) ab.click();
  out.abroadPhone = document.getElementById('custPhone').value;

  // …and in a sale
  openOrderEditor();
  const os = document.getElementById('ordCustSearch');
  os.value = 'איש קשר'; onOrderCustSearch();
  const ol = document.getElementById('ordCustList');
  out.saleList = [...ol.querySelectorAll('[data-pick-contact]')].map((e) => e.querySelector('.cust-pick-name').textContent);
  const or = ol.querySelector('[data-pick-contact]');
  if (or) or.click();
  out.sale = { name: (document.getElementById('ordName') || {}).value, phone: (document.getElementById('ordPhone') || {}).value, draft: orderDraft.customer + '|' + orderDraft.phone };
  try { closeModal(); } catch (e) { /* none */ }
  out.logoutClears = /removeItem\('gppick_contacts'\)/.test(String(Sync.logout)) && PICK_CONTACTS_KEY === 'gppick_contacts';
  Store.set('customers', []); localStorage.removeItem(PICK_CONTACTS_KEY);
  return out;
}, SELFTEST);

check('the picker can take his contacts', r.has === true, r.has);
if (r.has) {
  check('they come through his login, once', r.pulled === true && r.asked === 1 && r.askedAgain === 1, [r.pulled, r.asked, r.askedAgain]);
  check('…are kept on the device, and in no synced key, backup or export', r.kept === 5 && r.synced === false, [r.kept, r.synced]);
  check('with nothing typed: the recent customers only', r.idle.customers === 2 && r.idle.contacts.length === 0, r.idle);
  check('…and the list says the contacts are searched too', /ובאנשי הקשר/.test(r.idle.text), r.idle.text.slice(0, 80));
  check('a search finds a contact by name', r.byName.contacts.join('|') === 'יוסי חדש דוגמה', r.byName);
  check('…under the customers of that name, each once', r.both.customers === 1 && r.both.contacts.join('|') === 'משה איש קשר דוגמה', r.both);
  check('…by the number as he types it (053-…)', r.byLocal.contacts.join('|') === 'יוסי חדש דוגמה', r.byLocal);
  check('…and by part of a number', r.byPart.contacts.join('|') === 'משה איש קשר דוגמה', r.byPart);
  check('a contact whose number a customer has is that customer, not a second row', r.dup.customers === 1 && r.dup.contacts.length === 0, r.dup);
  check('a contact\'s name is text, never markup', r.evil.contacts.length === 1 && !r.pwned && !r.evilHtml, [r.evil.contacts, r.pwned, r.evilHtml]);
  check('picking one in a repair fills the name and the phone', r.calc.name === 'יוסי חדש דוגמה' && r.calc.phone === '053-3330003' && r.calc.search === '', r.calc);
  check('…a number from abroad keeps its country code', r.abroad.contacts.length === 1 && r.abroadPhone === '+447700900123', [r.abroad.contacts, r.abroadPhone]);
  check('the sale\'s picker finds a contact too', r.saleList.join('|') === 'משה איש קשר דוגמה', r.saleList);
  check('…and picking one fills the sale', r.sale.name === 'משה איש קשר דוגמה' && r.sale.phone === '054-4440004' && r.sale.draft === 'משה איש קשר דוגמה|054-4440004', r.sale);
  check('logging out removes the device\'s copy', r.logoutClears === true, r.logoutClears);
}
check('no page errors', errs.length === 0, errs);
check('no native dialogs (invisible in the WebView)', dialogs.length === 0, dialogs);
await browser.close();
srv.close();
process.exit(finish());
