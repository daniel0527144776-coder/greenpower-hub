// The hub must not load code or styling from anywhere but its own origin.
//
//   node test/test-self-contained.mjs [--selftest]
//
// This is here because of what it caught. The sticker editor shipped with two <script> tags
// appended after </html>, under the comment "Injection By NetFree" — the content filter on
// the network here rewrites pages as they are served, one of those rewritten pages was saved
// to disk, and the injection was committed and deployed with it. It sat in production
// undetected because it is invisible on the very network that put it there: the filter
// answers its own scripts. It only surfaced on a CI runner, as a CORS error from
// api.internal.netfree.link, and even then only as "1 error" with no readable log.
//
// Two separate problems, one check. A page that loads nothing external cannot be silently
// added to by whatever sits between this machine and the internet, and it also cannot break
// at the bench when the signal is bad.
//
// --selftest re-runs the scan over a copy carrying the original injected lines, so the check
// can be watched failing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();

// What the filter appended, verbatim, as it was found in dist/stickers.html.
const INJECTED = `<!-- Injection By NetFree -->
<script src="//netfree.link/injection-script/go-payment.js" type="text/javascript" async ></script>`;

// Only things the browser EXECUTES or RENDERS WITH. An <a href> to Google Maps is the
// point of that link; a <script src> to anywhere is a supply chain.
const RISKY = /<(script|link|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
const external = (url) => /^(https?:)?\/\//i.test(url.trim());

function scan(name, html) {
  const found = [];
  for (const [, tag, url] of html.matchAll(RISKY)) if (external(url)) found.push(`${tag}: ${url}`);
  return found;
}

const files = fs.readdirSync(DIST).filter((f) => f.endsWith('.html'));
console.log(`scanning ${files.length} page(s) in dist/\n`);

for (const f of files) {
  const html = fs.readFileSync(path.join(DIST, f), 'utf8');
  const found = scan(f, SELFTEST ? html.replace('</html>', '</html>\n' + INJECTED) : html);
  check(`${f} loads nothing from outside its origin`, found.length === 0, found);
}

// The filter announces itself. Cheap, exact, and independent of the tag scan above — the
// comment alone is proof a rewritten page was saved, even if the scripts changed shape.
for (const f of files) {
  const html = fs.readFileSync(path.join(DIST, f), 'utf8');
  check(`${f} carries no filter-injected block`, !/Injection By NetFree|netfree\.link/i.test(html));
}

process.exit(finish());
