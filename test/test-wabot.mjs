// The hub's "בוט וואטסאפ" page: Daniel's control of the WhatsApp bot (2026-10-04, "טאב בלוח בקרה
// שאני שולט בכל ההגדרות של הבוט וכל מה שאפשר להפיק ממנו").
//
//   node test/test-wabot.mjs
//   node test/test-wabot.mjs --selftest     (the escaping undone; the numbers left raw)
//
// The bot is stood in for (energylabgreen.com/api/wa/admin): nothing here reaches it. What the page
// must get right: it asks only with his login; everything a customer wrote — a name, a message, the
// bot's reply quoting them — is shown as text, never markup (the page is public, the log is not);
// and each control sends the bot exactly the change he made.
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
await new Promise((r) => srv.listen(4362, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));

const EVIL = '<img src=x onerror="window.__xss=1">';
const NOW = Date.now();
const DATA = {
  settings: { enabled: true, pauseHours: 6, maxPerHour: 12, hours: 'always', custom: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' },
    shabbat: true, israelOnly: true, blocked: [{ p: '972501112222', n: 'אשתי' }], voice: true, media: true, askDaniel: true, hubFacts: true, learn: true,
    introduce: true, model: 'quality', instructions: 'מבצע החודש', length: 'normal', tone: 'friendly', emoji: 'some', holdLine: true },
  now: NOW, holy: '', offHours: '', stats: { sent: 5, asked: 1, quiet: 2 },
  log: [{ at: NOW - 60000, c: '972501234567@c.us', n: EVIL, in: 'כמה עולה ' + EVIL, out: 'תשובה ' + EVIL, r: 'sent' },
        { at: NOW - 120000, c: '972504444444@c.us', n: 'משה', in: 'שלום', r: 'paused' },
        { at: NOW - 180000, c: '972505555555@c.us', n: 'דוד', r: 'stale', late: 1500 },
        { at: NOW - 240000, c: '123456789012345@lid', n: 'לקוח', r: 'unknown' },
        { at: NOW - 300000, c: '972506060606@c.us', n: 'משה השכן', r: 'saved' }],
  paused: [{ c: '972504444444@c.us', n: 'משה', until: NOW + 3600000, manual: false }],
  questions: [{ id: 'q1', at: NOW - 30000, c: '972501234567@c.us', n: 'יוסי', q: 'יש מטען 84V? ' + EVIL, msg: 'יש לכם מטען?', draft: 'כן, יש מטען 84V. ' + EVIL, done: false },
              { id: 'q0', at: NOW - 900000, c: '972501234567@c.us', n: 'יוסי', q: 'ישנה', done: true }],
  teach: [{ id: 't1', q: 'עובדים בשישי?', a: 'לא' }],
  knowledge: { text: 'ידע ' + EVIL, at: new Date(NOW).toISOString(), edited: false },
  learning: { on: true, chatsLearned: 12, queued: 30, hubJobs: 13 }, wa: 'authorized', configured: true,
  photos: { waiting: 7, bytes: 2097152, last: NOW },
};
const gets = [], posts = [];
let EMPTY = false;   // the bot answering 200 with no state at all
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
const CONTACTS = [{ p: '972501112222', n: 'אישתי המתוקה' }, { p: '972531112233', n: 'יוניפרטס חלקים' }, { p: '972541112233', n: 'אורן אספקה' }, { p: '972551112233', n: EVIL }];
await page.route(/energylabgreen\.com\/api\/wa\/admin/, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.method() === 'GET' && /contacts=1/.test(req.url())) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: CONTACTS }), headers: CORS });
  if (req.method() === 'GET') { gets.push(req.headers()['authorization'] || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY ? '{}' : JSON.stringify(DATA), headers: CORS }); }
  const sent = JSON.parse(req.postData() || '{}');
  posts.push(sent);
  // the polish answers with the message it wrote (and what it heard, for a recording); everything else just ok
  if (sent.op === 'polish') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS,
    body: JSON.stringify({ ok: true, text: 'שלום! המטען במלאי, אפשר לאסוף מחר. ' + EVIL, ...(sent.audio ? { heard: 'מוכן מחר' } : {}) }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: CORS });
});
await page.route('https://energylabgreen.com/api/wa/index', (route) => route.fulfill({ status: 200, body: '{}', headers: CORS }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4362/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.renderWaBot === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.escPunch = (s) => String(s == null ? '' : s); window.waNum = (c) => String(c); });
if (SELFTEST) delete DATA.photos;   // the bot's count of photos waiting, gone

const text = () => page.evaluate(() => document.getElementById('wabotBody').innerText);
// Everything below the state is folded (2026-10-05, "שכל הקטגוריות יהיו מקופלות"): the content checks
// open every section first, and the folding is checked on its own.
const openAll = () => page.evaluate(() => document.querySelectorAll('#wabotBody details.fold').forEach((d) => { d.open = true; }));
// Wait for the WHOLE save, not just its POST: waDo then re-reads the page (a GET) and only then
// shows its notice. Closing the notice on the POST alone let that late '✅ נשמרו' land on top of the
// next check's warning — 1 run in 6 failed 'no day at all' that way (2026-10-05).
const lastPost = async (n) => {
  for (let i = 0; i < 50 && posts.length < n; i++) await page.waitForTimeout(100);
  const g = gets.length;
  for (let i = 0; i < 50 && gets.length <= g; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(50);
  await page.evaluate(() => closeNotice());
  return posts[n - 1];
};

// logged out: nothing is asked
await page.evaluate(() => { Sync.session = null; Sync.userId = null; navigateTo('wabot'); });
await page.waitForTimeout(300);
check('logged out, the page says to log in and asks the bot nothing', /התחבר/.test(await text()) && gets.length === 0, gets.length);

// logged in
await page.evaluate(async () => {
  Sync.session = { access_token: 'tok.' + btoa('{"sub":"u1"}') + '.sig', expires_at: Date.now() + 3600000, email: 't@t' };
  Sync.userId = 'u1';
  await renderWaBot();
});
const folds = await page.evaluate(() => [...document.querySelectorAll('#wabotBody details.fold')].map((d) => [d.dataset.fold, d.open]));
const shut = await text();
check('every section starts folded except the questions that wait for him', folds.length >= 7 && folds.every(([id, open]) => open === (id === 'q'))
  && !/שקט אחרי שאתה עונה/.test(shut) && /הבוט שאל אותך/.test(shut), folds);
check('a folded section shows its count beside its title', /🚫 חסומים\s*1/.test(shut) && /🔇 שותק עכשיו\s*1/.test(shut), shut.slice(0, 400));
await openAll();
const t1 = await text();
check('it asks the bot with his login', gets.length === 1 && /^Bearer tok\./.test(gets[0]), gets);
check('the photos waiting for the library are counted, not shown', /📷 7 תמונות מהוואטסאפ ממתינות למאגר \(2\.0MB\)/.test(t1) && !(await page.evaluate(() => !!document.querySelector('#wabotBody img'))), t1.slice(0, 400));
check('the state, the week\'s counts and the connection', /הבוט עונה עכשיו ללקוחות/.test(t1) && /מחובר לוואטסאפ/.test(t1) && /ענה השבוע\s*5/.test(t1) && /12 שיחות נקראו/.test(t1), t1.slice(0, 300));
check('nothing a customer wrote runs as markup', await page.evaluate(() => window.__xss === undefined && !document.querySelector('#wabotBody img')), '');
check('it is shown as text instead', t1.includes('כמה עולה <img src=x') && t1.includes('יש מטען 84V? <img'), '');
check('numbers in the local form', t1.includes('050-123-4567') && t1.includes('050-444-4444'), '');
check('only the open question waits for him', (t1.match(/הבוט שאל אותך/g) || []).length === 1 && /שאלות שמחכות לך\s*1/.test(t1), '');
check('the log, with why it did or did not answer', /✅ ענה/.test(t1) && /שתק — ענית בעצמך/.test(t1), '');
check('including a message too late to answer, and a chat it could not place', /הגיעה באיחור — לא נענתה/.test(t1) && /שיחה שהבוט לא זיהה/.test(t1), '');
check('and a saved contact left to him, with the setting to choose it', /איש קשר שמור — עליך/.test(t1) && /לא עונה לאנשי קשר שמורים/.test(t1)
  && await page.evaluate(() => document.getElementById('wbSaved').checked === false), '');

// the settings — worked in with only that section open
await page.evaluate(() => document.querySelectorAll('#wabotBody details.fold').forEach((d) => { d.open = d.dataset.fold === 'settings'; }));
await page.waitForTimeout(50);
await page.evaluate(() => { document.getElementById('wbPause').value = '3'; document.getElementById('wbModel').value = 'saving'; document.getElementById('wbVoice').checked = false; document.getElementById('wbSaved').checked = true;
  document.getElementById('wbLength').value = 'short'; document.getElementById('wbTone').value = 'formal'; document.getElementById('wbEmoji').value = 'none'; document.getElementById('wbHold').checked = false; waSaveSettings(); });
let p = await lastPost(1);
check('the section he saved in is still open after the page re-draws, the others folded again',
  await page.evaluate(() => { const o = Object.fromEntries([...document.querySelectorAll('#wabotBody details.fold')].map((d) => [d.dataset.fold, d.open])); return o.settings === true && o.log === false && o.know === false && o.blocked === false; }), '');
check('saving the settings sends what he set', p && p.op === 'settings' && p.settings.pauseHours === 3 && p.settings.model === 'saving' && p.settings.voice === false && p.settings.skipSaved === true
  && p.settings.shabbat === true && p.settings.israelOnly === true && p.settings.hours === 'always' && p.settings.custom.days.length === 7
  && p.settings.length === 'short' && p.settings.tone === 'formal' && p.settings.emoji === 'none' && p.settings.holdLine === false, p);
await page.evaluate(() => { document.getElementById('wbHours').value = 'custom'; for (let i = 0; i < 7; i++) document.getElementById('wbDay' + i).checked = false; waSaveSettings(); });
await page.waitForTimeout(300);
check('his own hours with no day at all are not saved — the bot would never answer', posts.length === 1
  && await page.evaluate(() => /בלי אף יום/.test(document.getElementById('noticeBody').textContent)), posts.length);
await page.evaluate(() => closeNotice());

// a number to leave alone
await page.evaluate(() => { document.getElementById('wbBlockNum').value = '052-333-4444'; document.getElementById('wbBlockName').value = 'ספק'; waBlock(); });
p = await lastPost(2);
check('a blocked number is added to the ones there', p && p.op === 'settings' && p.settings.blocked.length === 2 && p.settings.blocked[1].p === '052-333-4444' && p.settings.blocked[1].n === 'ספק', p);

// answering what it did not know: the bot's draft is in the box, as text, ready to send, polish or drop
const draft = await page.evaluate(() => document.getElementById('wbAns0').value);
check('the bot\'s draft waits in the box, as text', draft === 'כן, יש מטען 84V. <img src=x onerror="window.__xss=1">' && await page.evaluate(() => window.__xss === undefined), draft);
await page.evaluate(() => { document.getElementById('wbAns0').value = 'כן, יש במלאי'; waAnswer(0); });
p = await lastPost(3);
check('answering a question sends it to the customer and teaches the bot', p && p.op === 'answer' && p.id === 'q1' && p.a === 'כן, יש במלאי' && p.send === true && p.keep === true, p);

// "נסח": his few words go to the bot with the customer's chat, and what it wrote comes back into the box — nothing sent
await page.evaluate(() => { document.querySelector('details[data-fold="q"]').open = true; document.getElementById('wbAns0').value = 'יש, מחר'; });
await page.evaluate(() => waPolishQ(0));
const polishPost = posts[posts.length - 1];
const polished = await page.evaluate(() => document.getElementById('wbAns0').value);
check('"נסח" sends his words and the customer\'s chat, and puts the message in the box', polishPost.op === 'polish' && polishPost.chat === '972501234567@c.us' && polishPost.text === 'יש, מחר'
  && polished.startsWith('שלום! המטען במלאי') && await page.evaluate(() => window.__xss === undefined), [polishPost, polished]);
const sentBefore = posts.filter((x) => x.op === 'send' || x.op === 'answer').length;

// "כתוב ללקוח": pick a recent chat, a few words, polish, then send only after he confirms
await page.evaluate(() => { document.querySelectorAll('#wabotBody details.fold').forEach((d) => { d.open = d.dataset.fold === 'compose'; }); });
const opts = await page.evaluate(() => [...document.querySelectorAll('#wbCmpChat option')].map((o) => o.textContent));
check('the recent chats are offered by name and number, a strange name as text', opts.length >= 3 && opts.some((o) => o.includes('050-123-4567')) && opts.some((o) => o.includes('<img src=x')), opts);
await page.evaluate(() => { document.getElementById('wbCmpChat').value = '0'; document.getElementById('wbCmpText').value = 'מוכן, תבוא מחר'; });
await page.evaluate(() => waCompose());
const cmp = posts[posts.length - 1];
const final = await page.evaluate(() => ({ shown: !document.getElementById('wbCmpOut').hidden, text: document.getElementById('wbCmpFinal').value }));
check('his words are polished for that chat, and shown to him before anything is sent', cmp.op === 'polish' && cmp.chat === '972501234567@c.us' && cmp.text === 'מוכן, תבוא מחר'
  && final.shown && final.text.startsWith('שלום!') && posts.filter((x) => x.op === 'send' || x.op === 'answer').length === sentBefore, [cmp, final]);
await page.evaluate(() => waComposeSend());
await page.waitForTimeout(150);
check('sending asks him first', posts.filter((x) => x.op === 'send').length === 0 && await page.evaluate(() => /לשלוח ללקוח/.test(document.getElementById('noticeBody').textContent)), '');
await page.evaluate(() => noticeConfirm());
p = await lastPost(posts.length + 1);
check('and on his yes, the message goes to that customer', p && p.op === 'send' && p.chat === '972501234567@c.us' && p.text.startsWith('שלום! המטען במלאי'), p);
await page.evaluate(() => { document.querySelectorAll('#wabotBody details.fold').forEach((d) => { d.open = d.dataset.fold === 'compose'; }); document.getElementById('wbCmpNum').value = '052-123-4567'; });
await page.evaluate(() => waCompose(btoa('fake-audio')));
const rec = posts[posts.length - 1];
const heard = await page.evaluate(() => document.getElementById('wbCmpText').value);
check('a recording goes as audio to the number he typed, and he sees what was heard', rec.op === 'polish' && rec.chat === '052-123-4567' && rec.audio === btoa('fake-audio') && !rec.text && heard === 'מוכן מחר', [rec.chat, heard]);

// the posts below count on from the three before the draft, the polish and the compose
const X = posts.length - 3;
// letting it back into a chat, and keeping it out of one
await page.evaluate(() => waRelease(0));
p = await lastPost(X + 4);
check('releasing a quiet chat names that chat', p && p.op === 'release' && p.chat === '972504444444@c.us', p);
await page.evaluate(() => { document.getElementById('wbMuteNum').value = '050-777-8888'; waMute(); });
p = await lastPost(X + 5);
check('muting a number for a day', p && p.op === 'mute' && p.chat === '050-777-8888' && p.hours === 24, p);

// what he tells it and teaches it
await page.evaluate(() => { document.getElementById('wbInstr').value = 'השבוע סגור ביום שלישי'; waSaveInstructions(); });
p = await lastPost(X + 6);
check('his instructions are saved as written', p && p.op === 'settings' && p.settings.instructions === 'השבוע סגור ביום שלישי', p);
await page.evaluate(() => { document.getElementById('wbTeachQ').value = 'יש חניה?'; document.getElementById('wbTeachA').value = 'כן, בחנייה של הבניין'; waTeach(); });
p = await lastPost(X + 7);
check('a question and answer he teaches', p && p.op === 'teach' && p.q === 'יש חניה?' && p.a === 'כן, בחנייה של הבניין', p);
await page.evaluate(() => { document.getElementById('wbKnow').value = 'ידע מתוקן'; waSaveKnowledge(); });
p = await lastPost(X + 8);
check('his corrections to what it learned', p && p.op === 'knowledge' && p.text === 'ידע מתוקן', p);

// picking suppliers from his WhatsApp contacts (their WhatsApp Business label is out of Green API's reach)
await page.evaluate(() => waPickContacts());
await page.waitForFunction(() => document.getElementById('wbPickList'), null, { timeout: 5000 });
let pick = await page.evaluate(() => document.getElementById('wbPickList').innerText);
check('his contacts are listed to pick from, the blocked ones marked, a strange name as text', /יוניפרטס חלקים/.test(pick) && /כבר חסום/.test(pick)
  && pick.includes('<img src=x') && await page.evaluate(() => window.__xss === undefined), pick.slice(0, 200));
await page.evaluate(() => { document.getElementById('wbPickQ').value = 'יוני'; waPickList(); });
pick = await page.evaluate(() => document.getElementById('wbPickList').innerText);
check('the search narrows the list', /יוניפרטס/.test(pick) && !/אורן אספקה/.test(pick), pick);
await page.evaluate(() => { waPickToggle(0); waPickToggle(1); waPickToggle(2); document.getElementById('wbPickQ').value = ''; waPickList(); waBlockPicked(); });
p = await lastPost(X + 9);
check('the picked ones are added to the blocked, an already-blocked one is not picked twice', p && p.op === 'settings' && p.settings.blocked.length === 3
  && p.settings.blocked.some((b) => b.p === '972531112233' && b.n === 'יוניפרטס חלקים') && p.settings.blocked.some((b) => b.p === '972541112233'), p && p.settings.blocked);

// an answer that is not the bot's state (200, '{}'): an error card, not a TypeError on settings.enabled
EMPTY = true;
const errsBefore = errs.length;
await page.evaluate(async () => { waBot = null; await renderWaBot(); });
const emptyText = await text();
check('a 200 with no state shows "could not reach the bot", and throws nothing', /לא הצלחתי להגיע לבוט/.test(emptyText) && errs.length === errsBefore, [emptyText.slice(0, 120), errs.slice(errsBefore)]);
EMPTY = false;
await page.evaluate(async () => { await renderWaBot(); });

// the log's filter, and the way in from the home page
await page.evaluate(() => waLogFilter('quiet'));
const logText = await page.evaluate(() => document.getElementById('wbLog').innerText);
check('"לא ענה" shows only what it did not answer', /שתק — ענית בעצמך/.test(logText) && !/כמה עולה/.test(logText), logText.slice(0, 200));
await page.evaluate(() => navigateTo('home'));
// clicked from inside: the hub's own login overlay covers the page in this test
// one "בוטים" card since 2026-10-05; it opens on this page, the first of its two tabs
await page.evaluate(() => [...document.querySelectorAll('.quick-card')].find((c) => /בוטים/.test(c.textContent)).click());
check('the home page has a card for it', await page.evaluate(() => document.getElementById('page-wabot').classList.contains('active')), '');
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
