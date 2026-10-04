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
    shabbat: true, blocked: [{ p: '972501112222', n: 'אשתי' }], voice: true, media: true, askDaniel: true, hubFacts: true, learn: true,
    introduce: true, model: 'quality', instructions: 'מבצע החודש' },
  now: NOW, holy: '', offHours: '', stats: { sent: 5, asked: 1, quiet: 2 },
  log: [{ at: NOW - 60000, c: '972501234567@c.us', n: EVIL, in: 'כמה עולה ' + EVIL, out: 'תשובה ' + EVIL, r: 'sent' },
        { at: NOW - 120000, c: '972504444444@c.us', n: 'משה', in: 'שלום', r: 'paused' }],
  paused: [{ c: '972504444444@c.us', n: 'משה', until: NOW + 3600000, manual: false }],
  questions: [{ id: 'q1', at: NOW - 30000, c: '972501234567@c.us', n: 'יוסי', q: 'יש מטען 84V? ' + EVIL, msg: 'יש לכם מטען?', done: false },
              { id: 'q0', at: NOW - 900000, c: '972501234567@c.us', n: 'יוסי', q: 'ישנה', done: true }],
  teach: [{ id: 't1', q: 'עובדים בשישי?', a: 'לא' }],
  knowledge: { text: 'ידע ' + EVIL, at: new Date(NOW).toISOString(), edited: false },
  learning: { on: true, chatsLearned: 12, queued: 30, hubJobs: 13 }, wa: 'authorized', configured: true,
};
const gets = [], posts = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' };
await page.route('https://energylabgreen.com/api/wa/admin', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (req.method() === 'GET') { gets.push(req.headers()['authorization'] || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DATA), headers: CORS }); }
  posts.push(JSON.parse(req.postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: CORS });
});
await page.route('https://energylabgreen.com/api/wa/index', (route) => route.fulfill({ status: 200, body: '{}', headers: CORS }));
await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
await page.goto('http://localhost:4362/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.renderWaBot === 'function', null, { timeout: 30000 });
if (SELFTEST) await page.evaluate(() => { window.escPunch = (s) => String(s == null ? '' : s); window.waNum = (c) => String(c); });

const text = () => page.evaluate(() => document.getElementById('wabotBody').innerText);
const lastPost = async (n) => { for (let i = 0; i < 50 && posts.length < n; i++) await page.waitForTimeout(100); await page.evaluate(() => closeNotice()); return posts[n - 1]; };

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
const t1 = await text();
check('it asks the bot with his login', gets.length === 1 && /^Bearer tok\./.test(gets[0]), gets);
check('the state, the week\'s counts and the connection', /הבוט עונה עכשיו ללקוחות/.test(t1) && /מחובר לוואטסאפ/.test(t1) && /ענה השבוע\s*5/.test(t1) && /12 שיחות נקראו/.test(t1), t1.slice(0, 300));
check('nothing a customer wrote runs as markup', await page.evaluate(() => window.__xss === undefined && !document.querySelector('#wabotBody img')), '');
check('it is shown as text instead', t1.includes('כמה עולה <img src=x') && t1.includes('יש מטען 84V? <img'), '');
check('numbers in the local form', t1.includes('050-123-4567') && t1.includes('050-444-4444'), '');
check('only the open question waits for him', (t1.match(/הבוט שאל אותך/g) || []).length === 1 && /מחכות לך \(1\)/.test(t1), '');
check('the log, with why it did or did not answer', /✅ ענה/.test(t1) && /שתק — ענית בעצמך/.test(t1), '');

// the settings
await page.evaluate(() => { document.getElementById('wbPause').value = '3'; document.getElementById('wbModel').value = 'saving'; document.getElementById('wbVoice').checked = false; waSaveSettings(); });
let p = await lastPost(1);
check('saving the settings sends what he set', p && p.op === 'settings' && p.settings.pauseHours === 3 && p.settings.model === 'saving' && p.settings.voice === false
  && p.settings.shabbat === true && p.settings.hours === 'always' && p.settings.custom.days.length === 7, p);
await page.evaluate(() => { document.getElementById('wbHours').value = 'custom'; for (let i = 0; i < 7; i++) document.getElementById('wbDay' + i).checked = false; waSaveSettings(); });
await page.waitForTimeout(300);
check('his own hours with no day at all are not saved — the bot would never answer', posts.length === 1
  && await page.evaluate(() => /בלי אף יום/.test(document.getElementById('noticeBody').textContent)), posts.length);
await page.evaluate(() => closeNotice());

// a number to leave alone
await page.evaluate(() => { document.getElementById('wbBlockNum').value = '052-333-4444'; document.getElementById('wbBlockName').value = 'ספק'; waBlock(); });
p = await lastPost(2);
check('a blocked number is added to the ones there', p && p.op === 'settings' && p.settings.blocked.length === 2 && p.settings.blocked[1].p === '052-333-4444' && p.settings.blocked[1].n === 'ספק', p);

// answering what it did not know
await page.evaluate(() => { document.getElementById('wbAns0').value = 'כן, יש במלאי'; waAnswer(0); });
p = await lastPost(3);
check('answering a question sends it to the customer and teaches the bot', p && p.op === 'answer' && p.id === 'q1' && p.a === 'כן, יש במלאי' && p.send === true && p.keep === true, p);

// letting it back into a chat, and keeping it out of one
await page.evaluate(() => waRelease(0));
p = await lastPost(4);
check('releasing a quiet chat names that chat', p && p.op === 'release' && p.chat === '972504444444@c.us', p);
await page.evaluate(() => { document.getElementById('wbMuteNum').value = '050-777-8888'; waMute(); });
p = await lastPost(5);
check('muting a number for a day', p && p.op === 'mute' && p.chat === '050-777-8888' && p.hours === 24, p);

// what he tells it and teaches it
await page.evaluate(() => { document.getElementById('wbInstr').value = 'השבוע סגור ביום שלישי'; waSaveInstructions(); });
p = await lastPost(6);
check('his instructions are saved as written', p && p.op === 'settings' && p.settings.instructions === 'השבוע סגור ביום שלישי', p);
await page.evaluate(() => { document.getElementById('wbTeachQ').value = 'יש חניה?'; document.getElementById('wbTeachA').value = 'כן, בחנייה של הבניין'; waTeach(); });
p = await lastPost(7);
check('a question and answer he teaches', p && p.op === 'teach' && p.q === 'יש חניה?' && p.a === 'כן, בחנייה של הבניין', p);
await page.evaluate(() => { document.getElementById('wbKnow').value = 'ידע מתוקן'; waSaveKnowledge(); });
p = await lastPost(8);
check('his corrections to what it learned', p && p.op === 'knowledge' && p.text === 'ידע מתוקן', p);

// the log's filter, and the way in from the home page
await page.evaluate(() => waLogFilter('quiet'));
const logText = await page.evaluate(() => document.getElementById('wbLog').innerText);
check('"לא ענה" shows only what it did not answer', /שתק — ענית בעצמך/.test(logText) && !/כמה עולה/.test(logText), logText.slice(0, 200));
await page.evaluate(() => navigateTo('home'));
// clicked from inside: the hub's own login overlay covers the page in this test
await page.evaluate(() => [...document.querySelectorAll('.quick-card')].find((c) => /בוט וואטסאפ/.test(c.textContent)).click());
check('the home page has a card for it', await page.evaluate(() => document.getElementById('page-wabot').classList.contains('active')), '');
check('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
srv.close();
process.exit(finish());
