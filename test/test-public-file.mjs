// What a served file may not say (2026-10-22).
//
//   node test/test-public-file.mjs
//   node test/test-public-file.mjs --selftest     (plants a made-up dollar quote and proforma number)
//
// Everything under dist/ is served to anyone with the URL: the hub's login is client-side. Its
// comments had come to carry the suppliers' own quotes in dollars, five freight invoices with their
// dates and amounts, a proforma number, and the price of a part on it. The reasoning stays in the
// comments; the evidence went to the private tools repo (docs/hub-cost-evidence.md). This holds the
// two shapes that need no private list:
//   - no dollar amount in a served file ("$12.34", "$5-9/kg", "quoted $: 10A→3", "7$ each"). The one
//     `$` and digit the code needs is the regex replacement '$1–$2' in the opening-hours text;
//   - no proforma or invoice number ("PI1234").
// The examples here are made up: this file is in the repo, and the repo was public.
// The names (of suppliers, customers and workers) need a list that cannot be public, so they are
// checked in the tools repo, by audit/audit-public-hub.mjs inside sync-prices.
//
// Third-party code under vendor/ and the *.min.js libraries is not ours and carries none of this;
// a minifier's '$1' is not a price. Baked pictures and the sticker editor's base64 are not text.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

const TEXT = /\.(html|js|css|json|webmanifest|txt)$|(^|\/)_headers$/;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(DIST, p).split(path.sep).join('/');
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); continue; }
    if (TEXT.test(rel) && !/\.min\.js$/.test(rel)) files.push(rel);
  }
})(DIST);

const ALLOWED = ['$1–$2'];
const MONEY = [/\$\s*:?\s*\d/g, /\d\s?\$(?=[\s,.;)]|$)/gm];
const INVOICE = /\bPI[- ]?\d{3,}\b/g;
const textOf = (rel) => {
  let t = fs.readFileSync(path.join(DIST, rel), 'utf8');
  if (SELFTEST && rel === 'index.html') t += '\n// the part was $99 on PI1234, the strip 7$ a piece\n';
  return t.replace(/<!-- sticker-doc: generated[\s\S]*?<!-- \/sticker-doc -->/, '')
    .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g, '');
};
const hits = { money: [], invoice: [] };
for (const rel of files) {
  const lines = textOf(rel).split('\n');
  lines.forEach((raw, i) => {
    const line = ALLOWED.reduce((s, a) => s.split(a).join(''), raw);
    const at = `${rel}:${i + 1}: ${raw.trim().slice(0, 90)}`;
    if (MONEY.some((re) => (re.lastIndex = 0, re.test(line)))) hits.money.push(at);
    INVOICE.lastIndex = 0;
    if (INVOICE.test(line)) hits.invoice.push(at);
  });
}

check('the served files were read', files.includes('index.html') && files.includes('stickers.html') && files.length >= 8, files);
check('no dollar amount in a served file', hits.money.length === 0, hits.money.slice(0, 5));
check('no proforma or invoice number in a served file', hits.invoice.length === 0, hits.invoice.slice(0, 5));
// The allowance is exact: the replacement the hours text needs, and nothing that merely starts like it.
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
check('the one allowed `$` and digit is still the code that needs it', /\.replace\([^\n]*'<bdi dir="ltr">\$1–\$2<\/bdi>'\)/.test(html));
if (SELFTEST) console.log('\n[selftest] a dollar quote, a per-unit price and a proforma number planted in index.html; the two checks above must be red.');
process.exit(finish());
