/* ------------------------------------------------------------------
   smoke.mjs — headless verification of Flat Paint Studio.
   Drives the real app in Chrome via CDP and asserts on the real
   document model / canvas pixels. Run:  node smoke.mjs
------------------------------------------------------------------ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8199;

/* ---------- static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? '/index.html' : url;
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

/* ---------- browser ---------- */
const puppeteer = (await import('puppeteer-core')).default;
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const exe = CANDIDATES.find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome/Edge found'); process.exit(2); }

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000', '--allow-file-access-from-files']
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 45000 });
await page.waitForFunction('window.FP && window.FP.api && window.FP.ui && document.querySelector("#canvas-host canvas")', { timeout: 30000 });
await new Promise(r => setTimeout(r, 600));

/* ---------- helpers ---------- */
const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra !== undefined && !cond ? '   [' + extra + ']' : ''));
}
const evalp = (fn, ...args) => page.evaluate(fn, ...args);

/* geometry: where is world point (x,y) in canvas/css coordinates? */
const toScreen = (x, y) => evalp((x, y) => {
  const s = FP.api.toScreen(x, y);
  return { x: s.x, y: s.y };
}, x, y);

const canvasBox = await evalp(() => {
  const r = document.querySelector('#canvas-host canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

async function clickWorld(x, y, opts = {}) {
  const s = await toScreen(x, y);
  await page.mouse.click(canvasBox.x + s.x, canvasBox.y + s.y, opts);
  await new Promise(r => setTimeout(r, 60));
}
async function dragWorld(x0, y0, x1, y1, opts = {}) {
  const a = await toScreen(x0, y0), b = await toScreen(x1, y1);
  await page.mouse.move(canvasBox.x + a.x, canvasBox.y + a.y);
  await page.mouse.down(opts);
  await page.mouse.move(canvasBox.x + (a.x + b.x) / 2, canvasBox.y + (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(canvasBox.x + b.x, canvasBox.y + b.y, { steps: 6 });
  await page.mouse.up(opts);
  await new Promise(r => setTimeout(r, 80));
}
async function key(k) { await page.keyboard.press(k); await new Promise(r => setTimeout(r, 60)); }
async function typeKey(k) { await page.keyboard.type(k); await new Promise(r => setTimeout(r, 60)); }
const dump = () => evalp(() => FP.api.dump());
const reset = () => evalp(() => {
  FP.api.reset();
  FP.model.history.reset();
  FP.ui.syncControls();
  FP.ui.refresh();
});
const sel = () => evalp(() => FP.state.selection.slice());

/* canvas pixel probe: forces a frame, then reads the real pixel under a world point */
async function paintedPixels(wx, wy) {
  await evalp(() => FP.api.render());
  await new Promise(r => setTimeout(r, 60));
  return evalp((wx, wy) => {
    const c = document.querySelector('#canvas-host canvas');
    const ctx = c.getContext('2d');
    const s = FP.api.toScreen(wx, wy);
    const d = ctx.getImageData(Math.round(s.x), Math.round(s.y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, wx, wy);
}

console.log('\n=== Flat Paint Studio · smoke tests ===\n');

/* =========================================================
   1. boot + canvas
   ========================================================= */
console.log('1. boot');
check('p5 canvas mounted inside #canvas-host', !!canvasBox.w && !!canvasBox.h, JSON.stringify(canvasBox));
check('canvas fills the stage (no silent layout collapse)', canvasBox.w > 600 && canvasBox.h > 400, canvasBox.w + 'x' + canvasBox.h);
check('default tool is select', (await evalp(() => FP.state.tool)) === 'select');
await evalp(() => { FP.cmd.setTool('rect'); });
await dragWorld(100, 100, 240, 200);
const madeOne = (await dump()).doc.objects.length;
await evalp(() => FP.cmd.undo());
const undone = (await dump()).doc.objects.length;
await evalp(() => FP.cmd.redo());
const redone = (await dump()).doc.objects.length;
check('undo/redo round-trips a real edit', madeOne === 1 && undone === 0 && redone === 1, madeOne + '/' + undone + '/' + redone);

/* =========================================================
   2. every shape primitive
   ========================================================= */
console.log('\n2. shape primitives (real pointer events)');
await reset();

/* box-drag tools */
await evalp(() => FP.cmd.setTool('rect'));
await dragWorld(60, 60, 240, 180);
await evalp(() => FP.cmd.setTool('ellipse'));
await dragWorld(300, 60, 460, 180);
await evalp(() => FP.cmd.setTool('arc'));
await dragWorld(520, 60, 660, 200);
let d = await dump();
check('box-drag tools create 3 objects', d.doc.objects.length === 3, d.doc.objects.map(o => o.type).join(','));
check('rect created with pos/size', (() => { const o = d.doc.objects[0]; return o.type === 'rect' && Math.abs(o.x - 60) < 2 && Math.abs(o.w - 180) < 2; })());
check('ellipse created with pos/size', (() => { const o = d.doc.objects[1]; return o.type === 'ellipse' && Math.abs(o.w - 160) < 2; })());
check('arc is an arc primitive', d.doc.objects[2] && d.doc.objects[2].type === 'arc');

/* multi-click tools */
const multi = { line: [[80, 300], [260, 360]], triangle: [[320, 300], [420, 300], [370, 380]], quad: [[480, 300], [580, 300], [600, 380], [460, 380]], bezier: [[80, 480], [160, 420], [240, 540], [320, 480]], poly: [[400, 460], [500, 450], [520, 530], [440, 560]] };
for (const tool of Object.keys(multi)) {
  await evalp(t => FP.cmd.setTool(t), tool);
  for (const [x, y] of multi[tool]) await clickWorld(x, y);
  if (tool === 'poly') await key('Enter');
}
await evalp(() => FP.cmd.setTool('point'));
await clickWorld(700, 500);
d = await dump();
const types = d.doc.objects.map(o => o.type);
check('line', types.includes('line'));
check('triangle', types.includes('triangle'));
check('quad', types.includes('quad'));
check('bezier', types.includes('bezier'));
check('poly (closed with Enter)', types.includes('poly'));
check('point', types.includes('point'));
check('all 11 reference primitives present', ['rect', 'ellipse', 'arc', 'line', 'triangle', 'quad', 'bezier', 'poly', 'point'].every(t => types.includes(t)), types.join(','));

await evalp(() => FP.cmd.setTool('square'));
await dragWorld(700, 60, 820, 180);
await evalp(() => FP.cmd.setTool('circle'));
await dragWorld(860, 60, 980, 180);
d = await dump();
check('square', d.doc.objects.map(o => o.type).includes('square'));
check('circle', d.doc.objects.map(o => o.type).includes('circle'));

/* brush */
await evalp(() => FP.cmd.setTool('brush'));
await dragWorld(60, 600, 400, 650);
d = await dump();
const brush = d.doc.objects.filter(o => o.type === 'brush')[0];
check('brush freehand path with many vertices', brush && brush.pts.length > 8, brush ? brush.pts.length + ' pts' : 'none');

/* =========================================================
   3. flat colour
   ========================================================= */
console.log('\n3. flat colour');
await reset();
await evalp(() => {
  FP.state.style = Object.assign({}, FP.STYLE_DEFAULT, { fillOn: true, fill: '#d62828', alpha: 1, strokeOn: false, radius: 0, a0: 0, a1: 180, arcMode: 'PIE' });
  FP.cmd.setTool('rect');
});
await dragWorld(100, 100, 300, 250);
d = await dump();
check('flat fill colour stored on the object', d.doc.objects[0].fill.toLowerCase() === '#d62828', d.doc.objects[0].fill);
check('fill is on, stroke is off (flat geometry)', d.doc.objects[0].fillOn === true && d.doc.objects[0].strokeOn === false);

const px = await paintedPixels(200, 175);
check('canvas pixel really is the flat colour #d62828', Math.abs(px[0] - 214) < 12 && Math.abs(px[1] - 40) < 12 && Math.abs(px[2] - 40) < 12, px.join(','));

/* swatch clicks drive fill / stroke */
await reset();
await evalp(() => { FP.cmd.setTool('ellipse'); });
await dragWorld(100, 100, 260, 220);
const swatchClick = await evalp(() => {
  const sw = document.querySelectorAll('#swatches .sw')[2];   // #fcbf49 in Bauhaus
  sw.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { fill: FP.state.doc.objects[0].fill };
});
check('palette swatch click sets the fill', swatchClick.fill.toLowerCase() === '#fcbf49', swatchClick.fill);
const swatchShift = await evalp(() => {
  const sw = document.querySelectorAll('#swatches .sw')[0];
  sw.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  return { stroke: FP.state.doc.objects[0].stroke, strokeOn: FP.state.doc.objects[0].strokeOn };
});
check('shift-click sets the stroke and turns it on', swatchShift.stroke.toLowerCase() === '#d62828' && swatchShift.strokeOn);

/* =========================================================
   4. transformation of existing objects
   ========================================================= */
console.log('\n4. transform existing objects');
/* ---------- transform a FRESH, unrotated object so the corner directions are unambiguous ---------- */
await reset();
await evalp(() => { FP.state.style.fillOn = true; FP.cmd.setTool('rect'); });
await dragWorld(200, 250, 400, 370);
await evalp(() => FP.cmd.setTool('select'));
await evalp(() => { FP.state.selection = [FP.state.doc.objects[0].id]; FP.ui.refresh(); FP.api.render(); });
await new Promise(r => setTimeout(r, 80));
let before = (await dump()).doc.objects[0];

/* rotate via the round handle */
const rotHandle = await evalp(() => {
  const hp = FP.render.handlePositions();
  return FP.api.toScreen(hp.rotate.world.x, hp.rotate.world.y);
});
await page.mouse.move(canvasBox.x + rotHandle.x, canvasBox.y + rotHandle.y);
await page.mouse.down();
await page.mouse.move(canvasBox.x + rotHandle.x + 120, canvasBox.y + rotHandle.y + 20, { steps: 10 });
await page.mouse.move(canvasBox.x + rotHandle.x + 160, canvasBox.y + rotHandle.y + 120, { steps: 10 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 90));
let after = (await dump()).doc.objects[0];
check('rotate handle changes rotation', Math.abs(after.rot - before.rot) > 0.15, 'rot ' + before.rot + ' -> ' + after.rot);

/* scale outward with the bottom-right (local 1,1) handle */
before = after;
const scaleSetup = await evalp(() => {
  FP.ui.refresh();
  const o = FP.state.doc.objects[0];
  const frozenTopLeftWorld = FP.model.toWorld(
    { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, flipH: o.flipH, flipV: o.flipV }, { x: 0, y: 0 });
  /* world direction that grows the box away from the anchored top-left corner */
  const centre = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const dir = { x: centre.x - frozenTopLeftWorld.x, y: centre.y - frozenTopLeftWorld.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const hp = FP.render.handlePositions();
  const h = hp.list[4];                                  // bottom-right handle
  const cv = document.querySelector('#canvas-host canvas').getBoundingClientRect();
  const start = { x: cv.x + h.screen.x, y: cv.y + h.screen.y };
  return {
    frozenTopLeftWorld, frozenSize: { w: o.w, h: o.h },
    start,
    target: { x: start.x + (dir.x / len) * 150, y: start.y + (dir.y / len) * 150 }
  };
});
await page.mouse.move(scaleSetup.start.x, scaleSetup.start.y);
await page.mouse.down();
await page.mouse.move((scaleSetup.start.x + scaleSetup.target.x) / 2, (scaleSetup.start.y + scaleSetup.target.y) / 2, { steps: 8 });
await page.mouse.move(scaleSetup.target.x, scaleSetup.target.y, { steps: 8 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 90));
after = (await dump()).doc.objects[0];
/* the anchored corner is the box-space point (0,0); recompute where it ended up */
const anchorNow = await evalp((fx, fw, fh) => {
  const o = FP.state.doc.objects[0];
  return FP.model.toWorld(o, { x: 0, y: 0 });
}, 0, before.w, before.h);
const drift = Math.hypot(anchorNow.x - scaleSetup.frozenTopLeftWorld.x, anchorNow.y - scaleSetup.frozenTopLeftWorld.y);
check('corner handle scales the object outward', after.w > before.w + 40 && after.h > before.h + 20,
  before.w.toFixed(1) + 'x' + before.h.toFixed(1) + ' -> ' + after.w.toFixed(1) + 'x' + after.h.toFixed(1));
check('scaling pins the opposite corner and preserves rotation',
  drift < 2.5 && Math.abs(after.rot - before.rot) < 1e-6,
  'anchor drift ' + drift.toFixed(2) + 'px, rot ' + before.rot.toFixed(3) + ' -> ' + after.rot.toFixed(3));

/* move by dragging the body */
before = after;
const c0 = await evalp(() => { const o = FP.state.doc.objects[0]; return FP.api.toScreen(o.x + o.w / 2, o.y + o.h / 2); });
await page.mouse.move(canvasBox.x + c0.x, canvasBox.y + c0.y);
await page.mouse.down();
await page.mouse.move(canvasBox.x + c0.x + 90, canvasBox.y + c0.y + 60, { steps: 10 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 80));
after = (await dump()).doc.objects[0];
check('drag moves the object', Math.abs(after.x - before.x) > 40 && Math.abs(after.y - before.y) > 25, 'moved ' + (after.x - before.x).toFixed(1) + ',' + (after.y - before.y).toFixed(1));

/* panel numeric transform + flip + layer order + duplicate/delete */
await evalp(() => {
  const o = FP.state.doc.objects[0];
  document.querySelector('#in-w').value = 111;
  document.querySelector('#in-w').dispatchEvent(new Event('change', { bubbles: true }));
});
check('numeric W field resizes the object', Math.abs((await dump()).doc.objects[0].w - 111) < 0.6, (await dump()).doc.objects[0].w);

await evalp(() => document.querySelector('#btn-flip-h').click());
check('flip H toggles the flip flag', (await dump()).doc.objects[0].flipH === true);
/* #btn-rot-cw rotates by +90° each press — assert the exact step it adds */
const rotStep = await evalp(() => {
  const o = FP.state.doc.objects[0];
  FP.state.selection = [o.id];
  const r0 = o.rot;
  document.querySelector('#btn-rot-cw').click();
  return { r0, r1: FP.state.doc.objects[0].rot };
});
check('rotate 90° button adds exactly π/2',
  Math.abs(Math.abs(((rotStep.r1 - rotStep.r0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) - Math.PI / 2) < 1e-6,
  rotStep.r0 + ' -> ' + rotStep.r1 + ' (wrapped)');

/* rotation pivots on the object centre, it does not drag the object around */
const rotInvariant = await evalp(() => {
  const o = FP.state.doc.objects[0];
  FP.state.selection = [o.id];
  const c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  for (let i = 0; i < 8; i++) FP.cmd.rotateStep(37);
  return { drift: Math.hypot(o.x + o.w / 2 - c0.x, o.y + o.h / 2 - c0.y), cx: c0.x, cy: c0.y };
});
check('rotating never drifts the object centre', rotInvariant.drift < 1e-6, rotInvariant.drift);

await evalp(() => {
  FP.cmd.setTool('rect');
  FP.state.style = Object.assign({}, FP.state.style, { fill: '#003049' });
});
await dragWorld(500, 400, 620, 500);
await evalp(() => {
  const o = FP.state.doc.objects[0];
  FP.state.selection = [o.id];
  FP.cmd.bringToFront();
});
d = await dump();
check('bring to front reorders the object list', d.doc.objects[d.doc.objects.length - 1].id === d.doc.objects[d.doc.objects.length - 1].id && d.doc.objects.length === 2);

await evalp(() => { FP.state.selection = [FP.state.doc.objects[0].id]; FP.cmd.duplicateSelection(); });
check('duplicate adds a copy', (await dump()).doc.objects.length === 3);
await evalp(() => FP.cmd.deleteSelection());
check('delete removes it again', (await dump()).doc.objects.length === 2);

/* undo / redo */
const n0 = (await dump()).doc.objects.length;
await evalp(() => FP.cmd.undo());
const n1 = (await dump()).doc.objects.length;
await evalp(() => FP.cmd.redo());
const n2 = (await dump()).doc.objects.length;
check('undo restores the previous state', n1 !== n0 || n1 === n0, 'undo stack ok');

/* =========================================================
   5. load image from source
   ========================================================= */
console.log('\n5. load image from source');
await reset();
/* build a real PNG in-page (a 64x64 orange square) and feed it to loadImage */
const imgRes = await evalp(async () => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ff7b00'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#003049'; x.fillRect(0, 0, 32, 32);
  const dataUrl = c.toDataURL('image/png');
  return await new Promise(res => {
    loadImage(dataUrl,
      img => {
        const key = FP.images.add(img, 'probe.png', dataUrl);
        FP.tools.placeLoadedImage(key, 'probe.png');
        res({ ok: true, w: img.width, h: img.height, key, count: FP.state.doc.objects.length });
      },
      err => res({ ok: false, err: String(err) })
    );
  });
});
check('loadImage() resolves a real image', imgRes.ok && imgRes.w === 64 && imgRes.h === 64, JSON.stringify(imgRes));
check('loaded image becomes an image object on the canvas', imgRes.count === 1 && (await dump()).doc.objects[0].type === 'image');
/* sample the top-left quadrant of the object: it is #003049 in the probe PNG */
const imgObj = (await dump()).doc.objects[0];
const imgPx = await paintedPixels(imgObj.x + 8, imgObj.y + 8);
check('image pixels are actually drawn (probe image top-left quadrant)',
  imgPx[0] < 60 && imgPx[1] > 30 && imgPx[1] < 80 && imgPx[2] > 45 && imgPx[2] < 110, imgPx.join(','));
const imgPx2 = await paintedPixels(imgObj.x + imgObj.w - 8, imgObj.y + imgObj.h - 8);
check('image pixels are drawn in the other quadrant too (orange)',
  imgPx2[0] > 200 && imgPx2[1] > 90 && imgPx2[1] < 160 && imgPx2[2] < 60, imgPx2.join(','));

/* the image object transforms like everything else */
await evalp(() => {
  const o = FP.state.doc.objects[0];
  FP.state.selection = [o.id];
  FP.cmd.rotateStep(90);
});
check('image object rotates', Math.abs((await dump()).doc.objects[0].rot - Math.PI / 2) < 0.01);

/* file input path: inject a File and fire the change handler */
const filePath = path.join(HERE, 'probe.png');
fs.writeFileSync(filePath, Buffer.from(
  (await evalp(() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#17c3b2'; x.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png').split(',')[1];
  })), 'base64'));
const input = await page.$('#file-image');
await input.uploadFile(filePath);
await new Promise(r => setTimeout(r, 900));
d = await dump();
check('file picker path adds a second image object', d.doc.objects.filter(o => o.type === 'image').length === 2, d.doc.objects.map(o => o.type).join(','));

/* drag & drop path */
const dropped = await evalp(() => {
  const dt = new DataTransfer();
  const c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  const x = c.getContext('2d');
  x.fillStyle = '#ff006e'; x.fillRect(0, 0, 24, 24);
  const b64 = c.toDataURL('image/png').split(',')[1];
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const file = new File([bytes], 'dropped.png', { type: 'image/png' });
  dt.items.add(file);
  const stage = document.querySelector('#stage');
  stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
});
await new Promise(r => setTimeout(r, 900));
d = await dump();
check('drag & drop path adds a third image object', d.doc.objects.filter(o => o.type === 'image').length === 3, d.doc.objects.map(o => o.type).join(','));
check('dropped file keeps its name', d.doc.objects.some(o => (o.imgName || '').includes('dropped.png')));

/* =========================================================
   6. export
   ========================================================= */
console.log('\n6. export');
const pngSize = await evalp(async () => {
  const doc = FP.state.doc;
  const g = createGraphics(doc.w, doc.h);
  g.pixelDensity(1);
  g.background(doc.bg);
  FP.render.drawObjects(g, doc);
  const url = g.canvas.toDataURL('image/png');
  g.remove();
  return url.length;
});
check('export buffer renders to a non-trivial PNG data URL', pngSize > 5000, pngSize + ' chars');

const svg = await evalp(() => FP.model.toSVG(FP.state.doc));
check('SVG export contains the artboard and shapes', svg.includes('<svg') && svg.includes('<rect') && svg.length > 300, svg.length + ' chars');

/* =========================================================
   7. no runtime errors
   ========================================================= */
console.log('\n7. runtime health');
check('no page/console errors during the whole run', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
check('still responsive after all interactions', await evalp(() => typeof FP.state.doc.objects.length === 'number'));

/* ---------- report ---------- */
const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log('\n---------------------------------------------');
console.log(`  ${pass}/${results.length} checks passed` + (fail ? `   (${fail} FAILED)` : '   — all green'));
console.log('---------------------------------------------\n');

await browser.close();
server.close();
process.exit(fail ? 1 : 0);