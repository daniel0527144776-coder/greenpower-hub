// The QR on every sticker opens the warranty page (2026-11-19).
//
//   node test/test-sticker-qr.mjs [--selftest]     (--selftest reads the address the sticker printed before: must go red)
//
// It printed https://energylabgreen.com/?mode=warranty, which the site ignored: a customer scanning the battery landed on
// the home page. The sticker now prints /warranty, and the site sends the old address there too (its test-warranty-qr),
// so the stickers already on batteries work. What must hold: the address the editor writes into the QR is the warranty
// page, and the address the editor falls back to is the same.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checker } from './diag.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELFTEST = process.argv.includes('--selftest');
const { check, finish } = checker();
let src = fs.readFileSync(path.join(HERE, '..', 'dist', 'stickers.html'), 'utf8');
if (SELFTEST) src = src.replace('const warrantyUrl = "https://energylabgreen.com/warranty"', 'const warrantyUrl = "https://energylabgreen.com/?mode=warranty"');
const set = (src.match(/const warrantyUrl = "([^"]+)"/) || [])[1];
const fallback = (src.match(/: '(https:\/\/energylabgreen\.com\/[^']*)';\s*\n\s*if \(window\.QRCodeLib/) || [])[1];
check('the QR printed on a sticker is the warranty page', set === 'https://energylabgreen.com/warranty', set);
check('the editor\'s fallback address is the same page', fallback === 'https://energylabgreen.com/warranty', fallback);
process.exit(finish());
