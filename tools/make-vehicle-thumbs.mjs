// Makes the vehicle thumbnails the hub shows beside each vehicle (Daniel, 2026-09-27: "שליד
// כל כלי יהיה תמונה שלו" — he chose manufacturer photos, baked in).
//
//   node tools/make-vehicle-thumbs.mjs <folder of downloaded photos>
//
// Local only (it needs sharp); the thumbnails it writes are committed, and
// tools/bake-vehicle-photos.mjs — which needs nothing but Node — puts them into the hub.
//
// LOOK AT EVERY PHOTO BEFORE RUNNING THIS. On this PC NetFree answers an image it has not
// approved with a grey mosaic reading "כעת התמונה נשלחה לנטפרי לבדיקה" — HTTP 200, valid JPEG
// magic bytes, a plausible size. Seven of the first thirteen downloads were exactly that, and no
// byte-level check told them apart. Only an entry marked "checked" in the manifest is made.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'vehicle-photos');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/make-vehicle-thumbs.mjs <folder of downloaded photos>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
for (const e of manifest) {
  if (!e.checked) { console.log('skip (not checked by eye): ' + e.model); continue; }
  const raw = path.join(SRC, e.raw);
  if (!fs.existsSync(raw)) { console.log('missing: ' + e.raw); continue; }
  // 128 x 88 is twice the 64 x 44 the card shows, on white, whole vehicle in frame.
  await sharp(raw).resize(128, 88, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' })
    .webp({ quality: 72 }).toFile(path.join(DIR, e.file));
  console.log('made ' + e.file + ' (' + fs.statSync(path.join(DIR, e.file)).size + ' bytes)');
}
