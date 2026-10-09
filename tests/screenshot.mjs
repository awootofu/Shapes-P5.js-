import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8204;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR:', String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.FP && window.FP.api', { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));

/* compose a representative scene entirely through the public API + real pointer gestures */
const canvas = await page.evaluate(() => {
  const c = document.querySelector('#canvas-host canvas').getBoundingClientRect();
  return { x: c.x, y: c.y };
});
async function drag(w0, h0, w1, h1) {
  const a = await page.evaluate((x, y) => FP.api.toScreen(x, y), w0, h0);
  const b = await page.evaluate((x, y) => FP.api.toScreen(x, y), w1, h1);
  await page.mouse.move(canvas.x + a.x, canvas.y + a.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + (a.x + b.x) / 2, canvas.y + (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(canvas.x + b.x, canvas.y + b.y, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 60));
}
async function clickW(x, y) {
  const a = await page.evaluate((x, y) => FP.api.toScreen(x, y), x, y);
  await page.mouse.click(canvas.x + a.x, canvas.y + a.y);
  await new Promise(r => setTimeout(r, 60));
}

await page.evaluate(() => {
  FP.state.style.fillOn = true; FP.state.style.strokeOn = false; FP.state.style.fill = '#fcbf49';
  FP.cmd.setTool('rect');
});
await drag(90, 110, 520, 430);

await page.evaluate(() => { FP.state.style.fill = '#d62828'; FP.cmd.setTool('circle'); });
await drag(560, 130, 830, 400);

await page.evaluate(() => { FP.state.style.fill = '#2a9d8f'; FP.cmd.setTool('arc'); FP.state.style.a0 = 0; FP.state.style.a1 = 250; FP.state.style.arcMode = 'PIE'; });
await drag(880, 120, 1180, 420);

await page.evaluate(() => { FP.state.style.fill = '#003049'; FP.cmd.setTool('triangle'); });
await clickW(150, 600); await clickW(420, 600); await clickW(285, 800);

await page.evaluate(() => { FP.state.style.fill = '#f77f00'; FP.cmd.setTool('poly'); });
await clickW(500, 600); await clickW(640, 590); await clickW(700, 700); await clickW(540, 810); await clickW(470, 700);
await page.keyboard.press('Enter');

await page.evaluate(() => { FP.state.style.fill = '#457b9d'; FP.cmd.setTool('quad'); });
await clickW(760, 620); await clickW(900, 600); await clickW(930, 780); await clickW(790, 800);

await page.evaluate(() => { FP.state.strokeOn = true; FP.state.fillOn = false; FP.state.stroke = '#8f00ff'; FP.state.weight = 8; FP.cmd.setTool('brush'); });
await drag(980, 640, 1180, 780);

await page.evaluate(() => { FP.state.fillOn = true; FP.state.strokeOn = true; FP.state.fill = '#ffbe0b'; FP.state.stroke = '#111318'; FP.state.weight = 4; FP.cmd.setTool('rect'); FP.state.radius = 28; });
await drag(620, 440, 800, 560);

await page.evaluate(() => {
  FP.cmd.setTool('select');
  FP.state.selection = [FP.state.doc.objects[FP.state.doc.objects.length - 1].id];
  FP.cmd.rotateStep(-18);
});
await page.evaluate(() => { FP.cmd.setTool('select'); FP.ui.refresh(); });
await new Promise(r => setTimeout(r, 400));

await page.screenshot({ path: path.join(HERE, 'shot-app.png') });

/* also capture the exported PNG of the artboard itself */
const dataUrl = await page.evaluate(() => {
  const doc = FP.state.doc;
  const g = createGraphics(doc.w, doc.h);
  g.pixelDensity(1);
  g.background(doc.bg);
  FP.render.drawObjects(g, doc);
  const u = g.canvas.toDataURL('image/png');
  g.remove();
  return u;
});
fs.writeFileSync(path.join(HERE, 'shot-export.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('object count:', await page.evaluate(() => FP.state.doc.objects.length));
console.log('wrote shot-app.png and shot-export.png');

await browser.close();
server.close();