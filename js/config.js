/* ------------------------------------------------------------------
   config.js — globals, palettes, tool metadata, shared state, helpers
   Flat Paint Studio · p5.js drawing application
------------------------------------------------------------------ */
p5.disableFriendlyErrors = true;

const FP = (window.FP = window.FP || {});
FP.VERSION = '1.0.0';

/* ---------------- utilities ---------------- */
FP.util = {
  _n: 0,
  uid(prefix) {
    FP.util._n += 1;
    return (prefix || 'o') + FP.util._n.toString(36) + Math.random().toString(36).slice(2, 6);
  },
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  round(v, p) { const m = Math.pow(10, p || 0); return Math.round(v * m) / m; },
  deg(r) { return r * 180 / Math.PI; },
  rad(d) { return d * Math.PI / 180; },
  hexToRgb(hex) {
    let h = String(hex || '#000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  },
  rgba(hex, alpha) {
    const { r, g, b } = FP.util.hexToRgb(hex);
    const a = (alpha === undefined || alpha === null) ? 1 : alpha;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  },
  rgbToHex(r, g, b) {
    const f = v => FP.util.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  },
  /* perceptual-ish luminance, used for crisp handles over any flat colour */
  lum(hex) {
    const { r, g, b } = FP.util.hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  },
  isLight(hex) { return FP.util.lum(hex) > 0.6; },
  fmt(n) { return (Math.round(n * 10) / 10).toString(); },
  /* axis-aligned bounds of a possibly-rotated box */
  rotatedBounds(o) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const hw = o.w / 2, hh = o.h / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
      const x = cx + p[0] * c - p[1] * s;
      const y = cy + p[0] * s + p[1] * c;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  },
  rectIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  },
  rectContains(r, p) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  },
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
};

/* ---------------- flat colour palettes ----------------
   Every palette is a set of solid, gradient-free hues — the shapes are
   painted with one unambiguous flat colour each.
------------------------------------------------------- */
FP.PALETTES = [
  { name: 'Bauhaus', colors: ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#003049', '#2a9d8f', '#457b9d', '#ffffff'] },
  { name: 'Vaporwave', colors: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1', '#fffb96', '#8f00ff', '#2d00f7', '#1a1a2e'] },
  { name: 'Pastel', colors: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'] },
  { name: 'Terracotta', colors: ['#6d3b2c', '#a8553a', '#d98355', '#edb88b', '#f5d7b3', '#5f7161', '#8fa98c', '#2f3e46'] },
  { name: 'Neon Ink', colors: ['#00e5ff', '#ff006e', '#fb5607', '#ffbe0b', '#8ac926', '#8338ec', '#3a86ff', '#111318'] },
  { name: 'Grayscale', colors: ['#0b0d12', '#2b3245', '#4a5470', '#6f7a99', '#9aa4bd', '#c3cad9', '#e6e9f0', '#ffffff'] }
];

/* ---------------- tools ----------------
   fill/stroke flags are the style defaults applied when the tool is picked.
   strokePx is the default stroke weight when the tool needs a visible line.
------------------------------------------------------- */
FP.TOOLS = {
  select: { label: 'Select', cursor: 'default', fill: null, stroke: null, hint: 'Drag an object to move it · drag a handle to scale · drag the round handle to rotate.' },
  brush: { label: 'Brush', cursor: 'crosshair', fill: false, stroke: true, strokePx: 6, hint: 'Drag to paint a freehand stroke. [ and ] change the weight.' },
  line: { label: 'Line', cursor: 'crosshair', fill: false, stroke: true, strokePx: 3, hint: 'Click the two end points of the line.' },
  rect: { label: 'Rectangle', cursor: 'crosshair', fill: true, stroke: false, hint: 'Drag to draw a rectangle. Hold Shift for a perfect square.' },
  square: { label: 'Square', cursor: 'crosshair', fill: true, stroke: false, hint: 'Drag to draw a perfect square.' },
  ellipse: { label: 'Ellipse', cursor: 'crosshair', fill: true, stroke: false, hint: 'Drag to draw an ellipse. Hold Shift for a circle.' },
  circle: { label: 'Circle', cursor: 'crosshair', fill: true, stroke: false, hint: 'Drag to draw a perfect circle.' },
  triangle: { label: 'Triangle', cursor: 'crosshair', fill: true, stroke: false, hint: 'Click three points to build the triangle.' },
  quad: { label: 'Quad', cursor: 'crosshair', fill: true, stroke: false, hint: 'Click four points — any convex or concave quadrilateral.' },
  poly: { label: 'Polygon', cursor: 'crosshair', fill: true, stroke: false, hint: 'Click points one by one. Enter or a click on the first point closes the shape.' },
  arc: { label: 'Arc', cursor: 'crosshair', fill: true, stroke: false, hint: 'Drag a box to set the arc bounds, then tune the angles in the panel.' },
  bezier: { label: 'Bezier', cursor: 'crosshair', fill: false, stroke: true, strokePx: 3, hint: 'Click four points: anchor · control · control · anchor.' },
  point: { label: 'Point', cursor: 'crosshair', fill: true, stroke: false, strokePx: 3, hint: 'Click to place a single point.' },
  image: { label: 'Image', cursor: 'crosshair', fill: null, stroke: null, hint: 'Drag to place the loaded image, or drop a file onto the canvas.' },
  pan: { label: 'Pan', cursor: 'grab', fill: null, stroke: null, hint: 'Drag to pan the view. Wheel zooms.' }
};

FP.STYLE_DEFAULT = { fillOn: true, fill: '#4f6df5', alpha: 1, strokeOn: false, stroke: '#0b0d12', weight: 3 };

/* ---------------- shared state ---------------- */
FP.state = {
  doc: { name: 'Untitled', w: 1280, h: 720, bg: '#ffffff', objects: [] },
  tool: 'select',
  style: Object.assign({}, FP.STYLE_DEFAULT, { radius: 0, a0: 0, a1: 180, arcMode: 'PIE' }),
  view: { zoom: 1, ox: 0, oy: 0 },
  grid: true,
  shadow: true,
  snap: true,
  lockAspect: false,
  imgFit: true,
  selection: [],
  pendingImage: null,
  cursor: { x: 0, y: 0 },
  marquee: null,
  draft: null,
  pointerInside: false,
  paletteIndex: 0
};

/* p5.Image store — kept out of the document JSON so history snapshots stay small */
FP.images = {};
FP.images.add = function (p5img, name, src) {
  const key = FP.util.uid('img');
  FP.images[key] = { el: p5img, name: name || 'image', src: src || '' };
  return key;
};
FP.images.get = function (key) { return FP.images[key] || null; };

FP.SHAPE_TYPES = ['rect', 'square', 'ellipse', 'circle', 'triangle', 'quad', 'poly', 'line', 'arc', 'bezier', 'brush', 'point', 'image'];
FP.PRIMITIVES = ['point', 'line', 'triangle', 'quad', 'rect', 'square', 'ellipse', 'circle', 'arc', 'bezier', 'poly'];
FP.LABELS = {
  rect: 'Rectangle', square: 'Square', ellipse: 'Ellipse', circle: 'Circle',
  triangle: 'Triangle', quad: 'Quad', poly: 'Polygon', line: 'Line', arc: 'Arc',
  bezier: 'Bezier', brush: 'Brush', point: 'Point', image: 'Image'
};