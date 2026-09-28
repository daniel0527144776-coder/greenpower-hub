// Prints the Bomber rows and their build drawings AS THE HUB HAS THEM, for documents built
// outside it — so a drawing in a document is the hub's drawing, not a second copy of the rows.
//   node test/dump-bomber-builds.mjs > builds.json
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const srv = http.createServer((q, r) => {
  const f = path.join(DIST, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(4299, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', (rt) => (rt.request().url().startsWith('http://127.0.0.1:4299/') ? rt.continue() : rt.abort()));
await page.goto('http://127.0.0.1:4299/index.html', { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(() => VEHICLE_PACKS.filter((v) => /Bomber/.test(v.m)).map((v) => ({
  m: v.m, model: v.model, tub: v.tub || '', frame: v.frame || '', side: v.side || null,
  builds: (v.builds || []).map((b) => ({ ...b,
    svgs: b.stacks.map((st) => (st.rows ? buildSideSvg(st.rows, b.cell, b.holder, st.unsure) : null)) })),
})));
process.stdout.write(JSON.stringify(out, null, 1));
await browser.close();
srv.close();
