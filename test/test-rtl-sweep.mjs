// Every page of the hub, on the phone and on a desk, read for the RTL defects the site's live check
// finds (2026-10-10). That check reached only the hub's login screen — one Latin token — so nothing
// had ever read the hub's own pages for a number or an English name drawn backwards ("+40" for "40+",
// "+Grade A" for "Grade A+"), a token broken across two lines, or text pushed past the screen.
//
//   node test/test-rtl-sweep.mjs
//   node test/test-rtl-sweep.mjs --selftest   (plants "Grade A+" and "40+" bare in a page: must fail)
//
// The probe is the site's (e2e-images-rtl.mjs BIDI_PROBE), copied, not imported: the hub's CI checks
// out the hub alone. Each page is opened with every folded section open, with a few records seeded so
// the list pages have rows to draw.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(path.join(HERE, '..', 'dist'));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(path.join(DIST, rel));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200); r.end(fs.readFileSync(f));
});
await new Promise((ok) => srv.listen(4193, ok));

const BIDI_PROBE = () => {
  const out = { checked: 0, tokens: 0, problems: [], overflow: [] };
  const HEB = /[֐-׿]/;
  const LAT = /[A-Za-z0-9]/;

  // Visible to a user, not merely present. checkVisibility catches the opacity-0
  // hover tooltips that a display/visibility test walks straight past.
  const visible = (el) =>
    el.checkVisibility
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : getComputedStyle(el).display !== 'none';

  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true;
    }
    return false;
  };

  const rectOf = (node, i) => {
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + 1);
    const b = r.getBoundingClientRect();
    return b.width === 0 && b.height === 0 ? null : b;
  };

  // A "text block" = an element whose descendants are all inline, i.e. one rendered
  // paragraph. Mixing must be judged HERE, not per text node: the catalog renders
  // "48V" and "סוללה" as sibling <span>s, so every individual text node looks
  // single-direction and a per-node gate sees nothing to check.
  const isInline = (el) => {
    const d = getComputedStyle(el).display;
    return d.startsWith('inline') || d === 'contents' || d === 'ruby';
  };
  const blocks = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'SVG') continue;
    if (isInline(el)) continue;
    const hasBlockChildWithText = [...el.children].some(
      (c) => !isInline(c) && c.textContent && c.textContent.trim()
    );
    if (hasBlockChildWithText) continue; // not a leaf block — its children are the paragraphs
    const t = el.textContent;
    if (!t || !t.trim()) continue;
    blocks.push(el);
  }

  for (const el of blocks) {
    const t = el.textContent;
    if (!HEB.test(t) || !LAT.test(t)) continue; // only mixed-direction text can break this way
    if (!visible(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    out.checked++;

    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const txt = n.nodeValue;
      if (!txt || !txt.trim()) continue;
      // Latin/digit runs, incl. separators that stay inside a unit (72V, 21700, 5,000mAh,
      // 1-3, Grade A+). The trailing `\+?` matters: "Grade A+" is where this went wrong on
      // the live site — a "+" at the end of an LTR run inside an RTL line is a neutral, so
      // the bidi algorithm gives it the paragraph direction and parks it on the far side,
      // rendering "+Grade A". The first version of this regex allowed only [A-Za-z0-9.,],
      // so the "+" was never part of any token and the reversal was invisible to the probe.
      // Separators are matched only BETWEEN alnums, so a sentence-ending "." — which
      // legitimately sits at the left end of an RTL line — is not mistaken for a defect.
      // The leading `\+?` closes the mirror-image gap: "+1,360" detaches its "+" exactly like
      // "Grade A+" does, and a trailing-only pattern never sees it. Found by eye in the B2B
      // picker's own price deltas after this probe had already called the page clean.
      for (const m of txt.matchAll(/\+?[A-Za-z0-9](?:[.,+\-\/][A-Za-z0-9]|[A-Za-z0-9])*\+?/g)) {
        const tok = m[0];
        if (tok.length < 2) continue;
        out.tokens++;
        const rects = [];
        for (let i = 0; i < tok.length; i++) {
          const r = rectOf(n, m.index + i);
          if (r) rects.push({ ch: tok[i], x: r.left, y: Math.round(r.top) });
        }
        if (rects.length < 2) continue;
        const info = { token: tok, text: el.textContent.trim().slice(0, 90), tag: el.tagName, cls: el.className?.toString().slice(0, 60) };
        if (new Set(rects.map((r) => r.y)).size > 1) { out.problems.push({ kind: 'token-wrapped', ...info }); continue; }
        for (let i = 1; i < rects.length; i++) {
          if (rects[i].x < rects[i - 1].x - 0.5) { out.problems.push({ kind: 'bidi-reversed', ...info }); break; }
        }
      }
    }
  }

  // Horizontal overflow: the other face of "שבירות" — English strings blowing out RTL boxes.
  const vw = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    if (st.overflowX === 'auto' || st.overflowX === 'scroll' || st.overflowX === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (!own) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      out.overflow.push({ kind: 'element-overflow', tag: el.tagName, cls: el.className?.toString().slice(0, 60), scroll: el.scrollWidth, client: el.clientWidth, text: el.textContent.trim().slice(0, 60) });
    }
    // Off-viewport is only a defect if nothing clips it. Marquees and carousels park
    // their duplicated slides outside on purpose, inside an overflow-hidden track.
    if ((r.right > vw + 2 || r.left < -2) && !clippedByAncestor(el)) {
      out.overflow.push({ kind: 'out-of-viewport', tag: el.tagName, cls: el.className?.toString().slice(0, 60), left: Math.round(r.left), right: Math.round(r.right), vw, text: el.textContent.trim().slice(0, 60) });
    }
  }
  return out;
};

const browser = await chromium.launch();
const all = [];
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:4193/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof navigateTo === 'function');
  const pages = await page.evaluate(() => {
    const D = 86400000, now = Date.now(), iso = (d) => new Date(now - d * D).toISOString();
    const set = (k, v) => localStorage.setItem('gp_' + k, JSON.stringify(v));
    set('customers', [0, 1].map((i) => ({ id: 'c' + i, name: 'לקוח ' + i, phone: '05000000' + i, lastVisit: iso(i * 40) })));
    set('jobs', [0, 1].map((i) => ({ id: 'j' + i, date: iso(i * 40), customerName: 'לקוח ' + i, customerPhone: '05000000' + i, voltage: '48', capacity: '20', price: 900, jobStatus: 'נמסר' })));
    set('orders', [{ id: 'o1', date: iso(3), customer: 'לקוח 0', phone: '050000000', items: [{ name: 'סוללה 48V 20Ah', price: 1300, qty: 1 }], total: 1300, status: 'שולם' }]);
    const g = document.getElementById('loginOverlay'); if (g) g.style.display = 'none';
    return [...document.querySelectorAll('[id^="page-"]')].map((p) => p.id.slice(5));
  });
  for (const id of pages) {
    await page.evaluate((id) => {
      try { navigateTo(id); } catch {}
      document.querySelectorAll('#page-' + id + ' details').forEach((d) => { d.open = true; });
    }, id);
    if (SELFTEST && id === pages[0]) await page.evaluate((id) => {
      const p = document.createElement('p'); p.textContent = 'תאים מקוריים Grade A+';
      const q = document.createElement('p'); q.textContent = '40+ ביקורות';
      document.getElementById('page-' + id).prepend(p, q);
    }, id);
    await page.waitForTimeout(120);
    const r = await page.evaluate(BIDI_PROBE);
    for (const p of r.problems) all.push(`${w}px ${id}: ${p.kind} "${p.token}" in «${p.text.slice(0, 70)}»`);
    for (const o of r.overflow) all.push(`${w}px ${id}: ${o.kind} <${o.tag}> «${(o.text || '').slice(0, 50)}»`);
  }
  check(`${w}px: ${pages.length} pages opened without a page error`, errors.length === 0, errors.slice(0, 3));
  await page.close();
}
await browser.close(); srv.close();
check('no number or English name drawn backwards, broken mid-token, or pushed off the screen on any page', all.length === 0, all.slice(0, 15));
process.exit(finish());
