/* ------------------------------------------------------------------
   sketch.js — the p5.js sketch itself.
   Responsive canvas sized to the stage, world <-> screen transform,
   pointer/keyboard plumbing into FP.tools, and a DOM-independent
   __fp API used by the automated tests in tests/.
------------------------------------------------------------------ */
let FP_DIM = { w: 800, h: 600 };

function setup() {
  const host = document.getElementById('canvas-host');
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  FP_DIM = { w: Math.max(320, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) };

  const c = createCanvas(FP_DIM.w, FP_DIM.h);
  c.parent(host);
  pixelDensity(1);
  noSmooth();
  ellipseMode(CENTER);
  rectMode(CORNER);
  angleMode(RADIANS);
  frameRate(60);

  FP.api = {
    canvas: () => c.elt,
    render: () => { redraw(); },
    reset: () => {
      const st = FP.state;
      st.doc = { name: 'Untitled', w: 1280, h: 720, bg: '#ffffff', objects: [] };
      st.selection = [];
      st.pending = null;
      st.draft = null;
      st.marquee = null;
      st.drag = null;
      st.tool = 'select';
      st.style = Object.assign({}, FP.STYLE_DEFAULT, { radius: 0, a0: 0, a1: 180, arcMode: 'PIE' });
      FP.model.history.reset();
      return true;
    },
    dump: () => JSON.parse(FP.model.serialize()),
    load: json => FP.model.deserialize(json),
    toWorld: (x, y) => FP.viewOps.screenToWorld({ x: x, y: y }),
    toScreen: (x, y) => FP.viewOps.worldToScreen({ x: x, y: y })
  };

  FP.model.history.reset();          // base snapshot so undo has something to return to
  FP.ui.init();
  FP.ui.boot();

  const ro = new ResizeObserver(() => resizeHost());
  ro.observe(stage);
  window.addEventListener('resize', resizeHost);
}

function resizeHost() {
  const stage = document.getElementById('stage');
  const r = stage.getBoundingClientRect();
  const w = Math.max(320, Math.floor(r.width));
  const h = Math.max(240, Math.floor(r.height));
  if (w === FP_DIM.w && h === FP_DIM.h) return;
  const old = { w: FP_DIM.w, h: FP_DIM.h };
  FP_DIM = { w: w, h: h };
  resizeCanvas(w, h);
  // keep the artboard roughly where it was on screen
  FP.state.view.ox += (w - old.w) / 2;
  FP.state.view.oy += (h - old.h) / 2;
  redraw();
}

/* ---------------- draw ---------------- */
function draw() {
  const st = FP.state;
  const v = st.view;

  const light = FP.util.isLight(st.doc.bg);
  background(light ? '#e9ecf2' : '#13161d');
  drawStageGrid();

  push();
  translate(v.ox, v.oy);
  scale(v.zoom);

  // artboard + drop shadow
  if (st.shadow) {
    const off = 10 / v.zoom;
    noStroke();
    for (let i = 6; i >= 1; i--) {
      fill(0, 0, 0, 5 + i * 3);
      rect(-off + i * 0.6, off + i * 0.9, st.doc.w, st.doc.h);
    }
  }
  noStroke();
  fill(st.doc.bg);
  rect(0, 0, st.doc.w, st.doc.h);

  // objects are clipped to the artboard, exactly like a real page
  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, st.doc.w, st.doc.h);
  ctx.clip();
  FP.render.drawObjects(this, st.doc);
  FP.render.drawDraft(this);
  ctx.restore();

  // artboard outline on top of the clipped content
  noFill();
  stroke(light ? '#b9c0cf' : '#2b3245');
  strokeWeight(1 / v.zoom);
  rect(0, 0, st.doc.w, st.doc.h);

  FP.render.drawOverlay(this);
  pop();

  FP.ui.updateStatus();
}

function drawStageGrid() {
  if (FP.state.grid) {
    const step = 22;
    push();
    stroke(255, 255, 255, 6);
    strokeWeight(1);
    for (let x = 0; x < width; x += step) line(x, 0, x, height);
    for (let y = 0; y < height; y += step) line(0, y, width, y);
    pop();
  }
}

/* ---------------- pointer plumbing ---------------- */
function toWorldPt() {
  return FP.viewOps.screenToWorld({ x: mouseX, y: mouseY });
}

function mousePressed(e) {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  FP.state.pointerInside = true;
  const world = toWorldPt();
  FP.tools.begin(world, { x: mouseX, y: mouseY }, {
    button: (e && typeof e.button === 'number') ? e.button : (mouseButton === CENTER ? 1 : (mouseButton === RIGHT ? 2 : 0)),
    shift: !!(e && e.shiftKey), alt: !!(e && e.altKey), ctrl: !!(e && e.ctrlKey || e && e.metaKey)
  });
  FP.ui.syncControls();
  redraw();
  return false;
}

function mouseDragged(e) {
  const world = toWorldPt();
  FP.tools.move(world, { x: mouseX, y: mouseY }, {
    shift: !!(e && e.shiftKey), alt: !!(e && e.altKey), ctrl: !!(e && e.ctrlKey || e && e.metaKey)
  });
  FP.ui.setCursorInfo(world);
  redraw();
  return false;
}

function mouseReleased(e) {
  const world = toWorldPt();
  FP.tools.end(world, { x: mouseX, y: mouseY }, {
    shift: !!(e && e.shiftKey), alt: !!(e && e.altKey), ctrl: !!(e && e.ctrlKey || e && e.metaKey)
  });
  FP.ui.syncControls();
  redraw();
  return false;
}

function mouseMoved() {
  FP.state.pointerInside = true;
  const world = toWorldPt();
  FP.ui.updateCursor(world, { x: mouseX, y: mouseY });
  FP.ui.setCursorInfo(world);
}

function mouseWheel(e) {
  const overCanvas = mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height;
  if (!overCanvas) return;
  const factor = Math.exp(-e.delta * 0.0016);
  FP.viewOps.setZoom(FP.state.view.zoom * factor, { x: mouseX, y: mouseY });
  redraw();
  return false;
}

function mouseOut() {
  FP.state.pointerInside = false;
}

function windowResized() { resizeHost(); }

/* keep p5's touch events from scrolling the page on the canvas */
document.addEventListener('touchstart', e => {
  if (e.target && e.target.tagName === 'CANVAS') e.preventDefault();
}, { passive: false });