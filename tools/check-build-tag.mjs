// The version the hub SHOWS must be the version the service worker IS.
//
//   node tools/check-build-tag.mjs
//
// Two numbers for one build is the shape that drifts and then lies, and this pair lies about
// the one thing it exists to answer. The badge on the home page is there because on
// 2026-08-21 a fix was deployed, verified live, and still not running on Daniel's phone — and
// neither end of the conversation could tell. A badge showing a version the phone is not
// actually running would be worse than no badge at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
const hub = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const inSw = (sw.match(/const CACHE = 'gp-hub-(v\d+)'/) || [])[1];
const inHub = (hub.match(/const HUB_BUILD = '(v\d+)'/) || [])[1];

if (!inSw) { console.error('FAIL: no gp-hub-vNNN in sw.js'); process.exit(1); }
if (!inHub) { console.error('FAIL: no HUB_BUILD in index.html'); process.exit(1); }
if (inSw !== inHub) {
  console.error(`FAIL: sw.js is ${inSw} but the hub tells the user it is ${inHub}`);
  process.exit(1);
}
console.log(`ok — both say ${inSw}`);
