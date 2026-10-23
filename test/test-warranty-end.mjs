// One warranty, one end date, wherever it is shown (2026-10-23).
//
//   node test/test-warranty-end.mjs
//   node test/test-warranty-end.mjs --selftest   (warrantyEndFrom counting a month as 30 days again,
//                                                  and an inspection sold carrying a repair's months)
//
// The battery's sticker prints the end of its warranty as the same day of the month, that many
// months on (stickers.html adds them with setMonth), and so did the customer's card and the bot.
// A repair's saved warrantyEnd, the job editor and the warranties page's sales counted a month as
// 30 days, so a 12-month warranty ended there five or six days before the date on the battery,
// and the repair's "נמסר" message carried that earlier date. The card also gave every sale at
// least 12 months, and the sale's summary message promised 12 on any sale: a lab service sold
// carries 6. What must hold, on the real page, in the lab's own time zone:
//   - a repair saved through the calculator, and one edited, end on the date its sticker prints;
//   - a repair saved before v495 (its warrantyEnd in 30-day months) shows its sticker's date on
//     the warranties page, the customer's card, the sales list, the "נמסר" message, the business
//     report and the bot's index, and the months the message names are the job's own;
//   - a battery sold ends on its sticker's date on the warranties page, the card and in the bot;
//   - a lab service sold carries 6 months on all of them and in its summary message, not 12;
//   - a quote carries none, and neither does a repair of 0 months.
// And an inspection sold (2026-10-23, Daniel: "ללא אחריות, כמו בתיקון"): the lab's diagnosis or
// capacity test, sold through the sale editor, carried a repair's 6 months, where the same
// inspection in the calculator carries none. It carries none now, on every surface, unless the
// sale has something else that does; and the rule names exactly the two catalogue rows.
// And it is paid after the check, not in advance (2026-10-23, Daniel: "האבחון ב-₪100 משולם רק אחרי
// הבדיקה, לא מראש"): its quote asked for a ₪50 deposit "לתחילת עבודה" and a build's lead time from it.
// A quote of the diagnosis alone asks for nothing up front and gives its answer time; a battery's quote
// still asks for its deposit, and so does a capacity test's, which is not set off against the repair. A
// paid diagnosis offers no deposit to the same-money check (payCandidates). --selftest also counts every
// sale as not a diagnosis.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

// --selftest serves the page with warrantyEndFrom counting a month as 30 days, the way three places did
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (SELFTEST) {
  const NOW = '  t.setMonth(t.getMonth() + months);\n';
  check('[selftest] the 30-day month could be put back', html.split(NOW).length === 2);
  html = html.replace(NOW, () => '  t.setTime(t.getTime() + months * 30 * 864e5);\n');
  // …and an inspection sold carrying a repair's 6 months again
  const INSP = "  if (isService && INSPECTION_ITEM.test(item.name || '')) return 0;\n";
  check('[selftest] the inspection rule could be taken out', html.split(INSP).length === 2);
  html = html.replace(INSP, () => '');
  // …and a diagnosis asking for a deposit again
  const ONLY = "  return items.length > 0 && items.every((it) => DIAGNOSIS_ITEM.test(String(it.name || '')));\n";
  check('[selftest] the diagnosis-only rule could be taken out', html.split(ONLY).length === 2);
  html = html.replace(ONLY, () => '  return false;\n');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === 'index.html') { r.writeHead(200, { 'content-type': MIME['.html'] }); r.end(html); return; }
  const f = path.join(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4389, r));

const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
// made-up customers; the dates are relative to today, at 12:00 in the lab, so every warranty is running
const at = (daysAgo) => { const d = new Date(now - daysAgo * DAY); d.setUTCHours(9, 0, 0, 0); return d.toISOString(); };
const OLD6 = at(40), OLD12 = at(70);
const JOBS = [
  // saved before v495: warrantyEnd = date + months × 30 days
  { id: 'w-old6', date: OLD6, customerName: 'בדיקה שש', customerPhone: '050-0001001', jobs: ['bms'], vehicle: 'bike',
    voltage: '48', capacity: '20', price: 400, jobStatus: 'נמסר', warrantyMonths: 6,
    warrantyEnd: iso(new Date(OLD6).getTime() + 6 * 30 * DAY) },
  // a repair given 12 months in the job editor: its work alone carries 6
  { id: 'w-old12', date: OLD12, customerName: 'בדיקה שתים עשרה', customerPhone: '050-0001002', jobs: ['bms', 'rows'], vehicle: 'bike',
    voltage: '52', capacity: '25', price: 900, jobStatus: 'נמסר', warrantyMonths: 12,
    warrantyEnd: iso(new Date(OLD12).getTime() + 12 * 30 * DAY) },
  // an inspection: no warranty, whatever is left in warrantyEnd
  { id: 'w-zero', date: at(5), customerName: 'בדיקה אפס', customerPhone: '050-0001003', jobs: ['diag'], price: 100,
    jobStatus: 'נמסר', warrantyMonths: 0, warrantyEnd: null },
];
const ORDERS = [
  { id: 'w-bat', date: at(30), customer: 'קונה סוללה', phone: '050-0001004', status: 'נמסר', total: 2000,
    items: [{ name: 'סוללה 48V 20Ah', cat: 'סוללות אופניים - 48V CLASSIC', qty: 1, unit: 2000 }] },
  { id: 'w-svc', date: at(20), customer: 'קונה שירות', phone: '050-0001005', status: 'שולם', total: 300,
    items: [{ name: 'שעת עבודה במעבדה', cat: 'שירותי מעבדה ותיקונים', qty: 1, unit: 300 }] },
  { id: 'w-quote', date: at(3), customer: 'רק הצעה', phone: '050-0001006', status: 'הצעה', total: 2000,
    items: [{ name: 'סוללה 48V 20Ah', cat: 'סוללות אופניים - 48V CLASSIC', qty: 1, unit: 2000 }] },
];
const CUSTOMERS = [...JOBS.map((j) => ({ name: j.customerName, phone: j.customerPhone })), ...ORDERS.map((o) => ({ name: o.customer, phone: o.phone }))]
  .map((c, i) => ({ id: 'wc' + i, ...c, totalSpent: 0, visitCount: 1 }));

const browser = await chromium.launch();
// the lab's clock: the phone is in Israel, and a month added in UTC lands on another day around midnight
const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('dialog', (d) => d.dismiss());
await page.route(/energylabgreen\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.addInitScript(([j, o, c]) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('gp_jobs', j); localStorage.setItem('gp_orders', o); localStorage.setItem('gp_customers', c);
}, [JSON.stringify(JOBS), JSON.stringify(ORDERS), JSON.stringify(CUSTOMERS)]);
await page.goto('http://localhost:4389/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.warrantyEntries === 'function' && typeof window.openStickerFor === 'function'
  && typeof window.botIndex === 'function', null, { timeout: 30000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });

// The date the sticker prints for a job or a sale, read off the label the hub opens for it.
const stickerEnd = async (kind, id) => {
  await page.evaluate(([k, i]) => openStickerFor(k, i), [kind, id]);
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const d = document.getElementById('stickerFrame').contentWindow.document;
    const repair = !d.getElementById('repaired-battery-specs-on-sticker').classList.contains('hidden');
    const e = d.getElementById(repair ? 'repair-warranty-end-display' : 'warranty-end-value');
    return (e && e.innerText || '').trim();   // DD/MM/YYYY
  });
};
// the hub's own dates, in the same shape: 23.10.2027 (he-IL) or 2027-10-23 (the bot) → 23/10/2027
const dmy = (s) => {
  if (!s) return '';
  let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : String(s);
};

// ---- 1. a repair saved before v495, on every surface
const sticker = {};
for (const id of ['w-old6', 'w-old12']) sticker[id] = await stickerEnd('job', id);
for (const id of ['w-bat']) sticker[id] = await stickerEnd('order', id);
check('the sticker printed an end for each (DD/MM/YYYY)', Object.values(sticker).every((s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s)), sticker);

const S = await page.evaluate(() => {
  const day = (ms) => Math.ceil((new Date(ms).getTime() - Date.now()) / 86400000);
  const local = (s) => (s ? new Date(s).toLocaleDateString('he-IL') : '');
  const entries = Object.fromEntries(warrantyEntries().map((e) => [e.id, e]));
  setWarrantyTab('active');
  const page = document.getElementById('warrantiesList').innerText;
  const card = {};
  (Store.get('customers') || []).forEach((c, i) => {
    customerLedger(c).rows.forEach((r) => { card[r.id] = r.warrantyEnd; });
    void i;
  });
  const idx = botIndex();
  const bot = Object.fromEntries([...idx.jobs.map((j) => [j.p, j.we]), ...idx.orders.map((o) => [o.p, o.we])]);
  const jobs = Store.get('jobs') || [];
  const msg = Object.fromEntries(jobs.map((j) => [j.id, repairMessage(j)]));
  const row = Object.fromEntries(jobs.map((j) => [j.id, repairRow(j)]));
  return { entries: Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, local(e.end)])),
    days: Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, day(e.end)])),
    page, card: Object.fromEntries(Object.entries(card).map(([k, v]) => [k, local(v)])), bot, msg, row };
});
const BOT = { 'w-old6': '050-0001001', 'w-old12': '050-0001002', 'w-zero': '050-0001003', 'w-bat': '050-0001004', 'w-svc': '050-0001005', 'w-quote': '050-0001006' };
for (const id of ['w-old6', 'w-old12', 'w-bat']) {
  const want = sticker[id];
  check(`${id}: the warranties page ends it on the sticker's date (${want})`, dmy(S.entries[id]) === want, dmy(S.entries[id]));
  check(`${id}: …and the page shows that date`, S.page.includes(`אחריות עד: ${S.entries[id]}`), want);
  check(`${id}: the customer's card, the same`, dmy(S.card[id]) === want, dmy(S.card[id]));
  check(`${id}: the bot's index, the same`, dmy(S.bot[BOT[id]]) === want, S.bot[BOT[id]]);
}
for (const id of ['w-old6', 'w-old12']) {
  const want = sticker[id];
  const end = (S.msg[id].match(/🛡️ אחריות (\d+) חודשים \(עד ([^)]+)\)/) || []);
  check(`${id}: the "נמסר" message names the sticker's date`, dmy(end[2]) === want, S.msg[id].split('\n').filter((l) => /🛡️/.test(l)));
  check(`${id}: the sales list counts its days to that date`,
    new RegExp(`אחריות: ${S.days[id]} ימים`).test(S.row[id]), [S.days[id], (S.row[id].match(/אחריות: [^<]*/) || [])[0]]);
}
const months12 = (S.msg['w-old12'].match(/🛡️ אחריות (\d+) חודשים/) || [])[1];
check('a repair given 12 months: its message says 12, beside its end — not the 6 its work carries', months12 === '12', months12);

// ---- 2. the business report's column
const report = await page.evaluate(() => {
  openBizReport('050-0001002');
  const t = document.getElementById('bizReportContent').textContent;
  closeBizReport();
  return t;
});
check('the business report ends it on the sticker\'s date too', report.includes(S.entries['w-old12']) && dmy(S.entries['w-old12']) === sticker['w-old12'],
  [S.entries['w-old12'], sticker['w-old12']]);

// ---- 3. a lab service sold: 6 months everywhere, and none for a quote or a 0-month repair
const svc = await page.evaluate(() => {
  const o = (Store.get('orders') || []).find((x) => x.id === 'w-svc');
  const local = (s) => (s ? new Date(s).toLocaleDateString('he-IL') : '');
  const start = new Date(o.date); start.setMonth(start.getMonth() + 6);
  const card = customerLedger((Store.get('customers') || []).find((c) => c.phone === o.phone)).rows.find((r) => r.id === 'w-svc');
  const entry = warrantyEntries().find((e) => e.id === 'w-svc');
  const idx = botIndex().orders.find((x) => x.p === o.phone);
  return { six: local(start.toISOString()), page: local(entry && entry.end), card: local(card && card.warrantyEnd),
    bot: idx && idx.we, quote: buildQuoteText(o) };
});
check('a lab service sold ends six months on, on the warranties page', svc.page === svc.six, [svc.page, svc.six]);
check('…on the customer\'s card, not twelve', svc.card === svc.six, [svc.card, svc.six]);
check('…and in the bot', dmy(svc.bot) === dmy(svc.six), [svc.bot, svc.six]);
check('…and its summary message promises 6 months, not 12', /✅ \*אחריות:\* 6 חודשים/.test(svc.quote) && !/12 חודש/.test(svc.quote),
  svc.quote.split('\n').filter((l) => /אחריות/.test(l)));
check('no warranty for a quote, nor for a repair of 0 months', !S.entries['w-quote'] && !S.entries['w-zero'] && !S.bot[BOT['w-quote']] && !S.bot[BOT['w-zero']],
  [S.entries['w-quote'], S.entries['w-zero'], S.bot[BOT['w-quote']], S.bot[BOT['w-zero']]]);

// ---- 4. a repair saved now, through the calculator, and one edited: the sticker's date in the record itself
const saved = await page.evaluate(() => {
  navigateTo('calc');
  document.getElementById('custName').value = 'בדיקה חדשה';
  document.getElementById('custPhone').value = '050-0001007';
  document.getElementById('voltage').value = '48';
  document.getElementById('capacity').value = '20';
  for (const k of [...state.jobs]) if (k !== 'full') toggleJob(k);
  if (!state.jobs.has('full')) toggleJob('full');
  recalc();
  saveJob();
  const j = (Store.get('jobs') || []).find((x) => x.customerPhone === '050-0001007');
  return j ? { id: j.id, months: j.warrantyMonths, end: new Date(j.warrantyEnd).toLocaleDateString('he-IL') } : null;
});
check('a repair saved through the calculator was saved, with 12 months', !!saved && saved.months === 12, saved);
if (saved) {
  const want = await stickerEnd('job', saved.id);
  check(`…and the warrantyEnd it saved is the sticker's date (${want})`, dmy(saved.end) === want, [saved.end, want]);
}
const edited = await page.evaluate(() => {
  openJobEditor('w-old6', 'orders');
  document.getElementById('jeWarranty').value = '12';
  saveJobEdit('w-old6');
  const j = (Store.get('jobs') || []).find((x) => x.id === 'w-old6');
  return { months: j.warrantyMonths, end: new Date(j.warrantyEnd).toLocaleDateString('he-IL') };
});
const wantEdited = await stickerEnd('job', 'w-old6');
check('a repair edited to 12 months saves the sticker\'s date for them', edited.months === 12 && dmy(edited.end) === wantEdited, [edited, wantEdited]);

// ---- 5. an inspection sold through the sale editor carries no warranty, like the same inspection as a repair
const I = await page.evaluate(() => {
  const sellable = PRICING.map((r, ci) => ({ r, ci })).filter(({ r }) => typeof r.retail === 'number');
  const none = sellable.filter(({ r }) => warrantyForItem(r) === 0).map(({ r }) => r.name);
  const lab = (re) => sellable.find(({ r }) => /^שירותי מעבדה/.test(r.cat) && re.test(r.name));
  const diag = lab(/^אבחון/), cap = lab(/^בדיקת קיבולת/);
  const battery = sellable.find(({ r }) => r.cat === 'סוללות אופניים - 48V CLASSIC');
  // a sale the way he makes one: the editor, the catalogue lines, the save; then paid or delivered
  const sell = (phone, rows, status) => {
    openOrderEditor();
    document.getElementById('ordName').value = 'קונה ' + phone.slice(-2);
    document.getElementById('ordPhone').value = phone;
    rows.forEach((x) => orderDraft.items.push({ ci: x.ci, qty: 1 }));
    saveOrder();
    const orders = Store.get('orders') || [];
    const o = orders.find((x) => x.phone === phone);
    if (o) { o.status = status; Store.set('orders', orders); }
    return o || null;
  };
  if (!diag || !cap || !battery) return { none, missing: [!!diag, !!cap, !!battery] };
  const alone = sell('050-0001008', [diag], 'נמסר');
  const mixed = sell('050-0001009', [cap, battery], 'שולם');
  const quoted = sell('050-0001010', [diag], 'הצעה');
  const quotedBat = sell('050-0001011', [battery], 'הצעה');
  const paidDiag = sell('050-0001012', [diag], 'שולם');
  const quotedCap = sell('050-0001013', [cap], 'הצעה');
  const card = (o) => customerLedger({ name: o.customer, phone: o.phone }).rows.find((r) => r.id === o.id);
  const entry = (o) => warrantyEntries().find((e) => e.id === o.id);
  const bot = (o) => (botIndex().orders.find((x) => x.p === o.phone) || {}).we;
  const twelve = new Date(mixed.date); twelve.setMonth(twelve.getMonth() + 12);
  return { none, saved: [Object.keys(alone.items[0] || {}).sort().join(), mixed.items.length],
    alone: { entry: !!entry(alone), card: card(alone) && card(alone).warrantyEnd, bot: bot(alone), quote: buildQuoteText(alone) },
    mixed: { entry: entry(mixed) && new Date(entry(mixed).end).toLocaleDateString('he-IL'), twelve: twelve.toLocaleDateString('he-IL'),
      quote: buildQuoteText(mixed) },
    quoted: buildQuoteText(quoted), quotedBat: buildQuoteText(quotedBat), quotedCap: buildQuoteText(quotedCap),
    paidParts: payCandidates().filter((c) => c.date === paidDiag.date && c.total === Math.round(paidDiag.total)).map((c) => c.what) };
});
check('the catalogue has the two inspections, and the rule names exactly them',
  !I.missing && I.none.length === 2 && I.none.some((n) => /^אבחון/.test(n)) && I.none.some((n) => /^בדיקת קיבולת/.test(n)), [I.none, I.missing]);
if (!I.missing) {
  check('a sold line keeps name, category, quantity and price, so the rule reads the name',
    I.saved[0] === 'cat,name,qty,unit' && I.saved[1] === 2, I.saved);
  check('a diagnosis sold alone is not on the warranties page', !I.alone.entry, I.alone.entry);
  check('…nor under warranty on the customer\'s card, nor in the bot', !I.alone.card && !I.alone.bot, [I.alone.card, I.alone.bot]);
  const lines = I.alone.quote.split('\n').filter((l) => /אחריות/.test(l));
  check('…and its message promises no warranty, nor calls itself one', lines.length === 0, lines);
  check('a diagnosis quoted alone asks for nothing up front: no deposit, paid after the check',
    !/מקדמה/.test(I.quoted) && /\*התשלום:\* אחרי הבדיקה/.test(I.quoted) && /התשלום אחרי הבדיקה\./.test(I.quoted), I.quoted.split('\n').filter((l) => /תשלום|מקדמה|יתרה/.test(l)));
  check('…and gives the diagnosis\'s answer time, not a build\'s lead time from a deposit',
    /עד 2 ימי עסקים מרגע שהסוללה אצלנו/.test(I.quoted) && !/מרגע קבלת המקדמה/.test(I.quoted), I.quoted.split('\n').filter((l) => /ימי עסקים/.test(l)));
  check('a battery quoted still asks for its deposit', /מקדמה לתחילת עבודה/.test(I.quotedBat) && /מרגע קבלת המקדמה/.test(I.quotedBat),
    I.quotedBat.split('\n').filter((l) => /מקדמה/.test(l)));
  check('a capacity test quoted alone is as before: its deposit, and no promise that it is set off',
    /מקדמה לתחילת עבודה/.test(I.quotedCap) && !/מתקזז/.test(I.quotedCap) && !/התשלום:\* אחרי הבדיקה/.test(I.quotedCap),
    I.quotedCap.split('\n').filter((l) => /תשלום|מקדמה|מתקזז/.test(l)));
  check('a paid diagnosis offers the same-money check its price only, no deposit',
    I.paidParts.length >= 1 && I.paidParts.every((w) => w === 'מכירה'), I.paidParts);
  check('a capacity test sold with a battery: the battery\'s 12 months', I.mixed.entry === I.mixed.twelve
    && /✅ \*אחריות:\* 12 חודשים/.test(I.mixed.quote), [I.mixed.entry, I.mixed.twelve, I.mixed.quote.split('\n').filter((l) => /אחריות/.test(l))]);
}
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
if (SELFTEST) console.log('\n[selftest] a month counted as 30 days again, an inspection sold with 6 months, and a diagnosis asking\n[selftest] for a deposit; the checks above must be red.');
process.exit(finish());
