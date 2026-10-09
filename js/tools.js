/* ------------------------------------------------------------------
   tools.js — the interaction state machine (pointer events) and the
   document commands the UI and keyboard both call.
------------------------------------------------------------------ */
(function (FP) {
  const M = FP.model;
  const U = FP.util;
  const R = FP.render;

  FP.state.drag = null;
  FP.state.pending = null;      // multi-click construction in progress
  FP.state.spaceDown = false;

  /* ---------------- helpers ---------------- */
  function snapAngle(from, to, stepDeg) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const step = U.rad(stepDeg || 15);
    let a = Math.atan2(dy, dx);
    a = Math.round(a / step) * step;
    return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
  }

  function boxFromDrag(p0, p1, opts) {
    opts = opts || {};
    let x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y;
    if (opts.square) {
      const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * s;
      y1 = y0 + Math.sign(y1 - y0 || 1) * s;
    }
    if (opts.fromCenter) {
      const hw = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
      return { x: x0 - hw, y: y0 - hh, w: hw * 2, h: hh * 2, cx: x0, cy: y0 };
    }
    return {
      x: Math.min(x0, x1), y: Math.min(y0, y1),
      w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2
    };
  }

  const BOX_TOOLS = { rect: 1, square: 1, ellipse: 1, circle: 1, arc: 1, image: 1 };
  const MULTI_TOOLS = { line: 2, triangle: 3, quad: 4, poly: Infinity, bezier: 4 };

  /* ---------- create a finished object from the current style ---------- */
  function makePoint(p) {
    const size = Math.max(6, (FP.state.style.weight || 3) * 2);
    const o = M.baseObject('point');
    o.fillOn = true; o.strokeOn = false;
    o.fill = FP.state.style.fill; o.alpha = FP.state.style.alpha;
    o.weight = Math.max(3, FP.state.style.weight);
    o.w = size; o.h = size;
    o.x = p.x - size / 2; o.y = p.y - size / 2;
    return o;
  }

  /* ================= pointer down ================= */
  function begin(world, screen, ev) {
    const st = FP.state;
    ev = ev || {};

    if (st.spaceDown || ev.button === 1 || st.tool === 'pan') {
      st.drag = { mode: 'pan', startScreen: { x: screen.x, y: screen.y }, startView: { ox: st.view.ox, oy: st.view.oy } };
      return;
    }

    const tool = st.tool;

    /* ---------- select / transform ---------- */
    if (tool === 'select') {
      const handle = R.handleAt(screen);
      if (handle && handle.kind === 'scale') return startScale(handle, world);
      if (handle && handle.kind === 'rotate') return startRotate(world);

      const tol = FP.viewOps.tol(6);
      const hit = M.pick(st.doc, world, tol);
      if (hit) {
        if (ev.shift) {
          M.toggleSelect(st.doc, hit.id);
          if (st.selection.indexOf(hit.id) < 0) return;      // shift-clicked it off
        } else if (st.selection.indexOf(hit.id) < 0) {
          M.selectOnly(st.doc, hit.id);
        }
        if (ev.alt) M.duplicate(st.doc, st.selection.slice());
        return startMove(world);
      }
      if (!ev.shift) M.deselect();
      st.marquee = { x: world.x, y: world.y, w: 0, h: 0 };
      st.drag = { mode: 'marquee', start: world, base: st.selection.slice() };
      return;
    }

    /* ---------- pan shortcut ---------- */
    if (tool === 'pan') return;

    /* ---------- box-drag tools ---------- */
    if (BOX_TOOLS[tool]) {
      st.drag = {
        mode: 'create', tool: tool, start: world,
        shift: !!ev.shift, alt: !!ev.alt
      };
      st.draft = null;
      return;
    }

    /* ---------- freehand brush ---------- */
    if (tool === 'brush') {
      st.drag = { mode: 'brush', pts: [world] };
      st.draft = null;
      return;
    }

    /* ---------- single click point ---------- */
    if (tool === 'point') {
      const o = makePoint(world);
      M.add(st.doc, o);
      M.history.push();
      FP.ui.refresh();
      return;
    }

    /* ---------- multi-click construction ---------- */
    if (MULTI_TOOLS[tool] !== undefined) {
      if (!st.pending || st.pending.tool !== tool) st.pending = { tool: tool, pts: [], hover: null };
      let p = world;
      if (ev.shift && st.pending.pts.length) p = snapAngle(st.pending.pts[st.pending.pts.length - 1], world, 15);
      // clicking the first point closes a polygon
      if (tool === 'poly' && st.pending.pts.length > 2) {
        const f = st.pending.pts[0];
        if (Math.hypot(f.x - world.x, f.y - world.y) < FP.viewOps.tol(10)) return finishPending();
      }
      st.pending.pts.push(p);
      const need = MULTI_TOOLS[tool];
      if (st.pending.pts.length >= need) finishPending();
      FP.ui.refresh();
      return;
    }
  }

  /* ================= drag starts ================= */
  function startMove(world) {
    const st = FP.state;
    const objs = M.selected(st.doc);
    st.drag = {
      mode: 'move', start: world, shift: false,
      orig: objs.map(o => ({ id: o.id, x: o.x, y: o.y })),
      startSelection: st.selection.slice()
    };
  }

  /* freeze the selection transform, then scale in local space */
  function startScale(handle, world) {
    const st = FP.state;
    const sel = M.selected(st.doc);
    if (!sel.length) return;
    const frozen = sel.map(o => ({
      o: o, id: o.id,
      x0: o.x, y0: o.y, w0: o.w, h0: o.h, rot: o.rot, fh: o.flipH, fv: o.flipV
    }));
    st.drag = {
      mode: 'scale', handle: handle, frozen: frozen,
      multi: sel.length > 1,
      bounds0: sel.length > 1 ? M.selectionBounds(st.doc) : null
    };
  }

  function startRotate(world) {
    const st = FP.state;
    const sel = M.selected(st.doc);
    if (!sel.length) return;
    const frozen = sel.map(o => ({ o: o, id: o.id, rot0: o.rot, x0: o.x, y0: o.y, cx: o.x + o.w / 2, cy: o.y + o.h / 2, cx0: o.x + o.w / 2, cy0: o.y + o.h / 2 }));
    let pivot;
    if (sel.length === 1) pivot = { x: sel[0].x + sel[0].w / 2, y: sel[0].y + sel[0].h / 2 };
    else {
      const b = M.selectionBounds(st.doc);
      pivot = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
    st.drag = {
      mode: 'rotate', frozen: frozen, pivot: pivot,
      pinCenters: sel.length === 1,
      startAngle: Math.atan2(world.y - pivot.y, world.x - pivot.x), moved: false
    };
  }

  /* ================= pointer move ================= */
  function move(world, screen, ev) {
    const st = FP.state;
    ev = ev || {};
    st.cursor = world;
    const d = st.drag;
    if (!d) {
      if (st.pending) st.pending.hover = world;
      return;
    }

    switch (d.mode) {
      case 'pan': {
        st.view.ox = d.startView.ox + (screen.x - d.startScreen.x);
        st.view.oy = d.startView.oy + (screen.y - d.startScreen.y);
        break;
      }

      case 'move': {
        let dx = world.x - d.start.x, dy = world.y - d.start.y;
        if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        d.orig.forEach(rec => {
          const o = M.findById(st.doc, rec.id);
          if (o) { o.x = rec.x + dx; o.y = rec.y + dy; }
        });
        d.moved = true;
        break;
      }

      case 'marquee': {
        st.marquee = {
          x: Math.min(d.start.x, world.x), y: Math.min(d.start.y, world.y),
          w: Math.abs(world.x - d.start.x), h: Math.abs(world.y - d.start.y)
        };
        break;
      }

      case 'scale': {
        applyScale(d, world, st.snap && ev.shift, !!ev.shift);
        break;
      }

      case 'rotate': {
        const a = Math.atan2(world.y - d.pivot.y, world.x - d.pivot.x);
        let delta = a - d.startAngle;
        if (ev.shift || st.snap) {
          const step = U.rad(15);
          const anyRot = d.frozen[0].rot0 + delta;
          delta = Math.round(anyRot / step) * step - d.frozen[0].rot0;
        }
        applyRotation(d, delta);
        d.moved = true;
        break;
      }

      case 'create': {
        const tool = d.tool;
        const opts = { square: (tool === 'square' || tool === 'circle') || !!ev.shift, fromCenter: !!ev.alt };
        const b = boxFromDrag(d.start, world, opts);
        if (!st.draft) st.draft = M.makeBox(tool, tool, { x: 0, y: 0, w: 1, h: 1 });
        st.draft.x = b.x; st.draft.y = b.y; st.draft.w = Math.max(1, b.w); st.draft.h = Math.max(1, b.h);
        if (tool === 'image') st.draft.fill = '#4f6df5';
        break;
      }

      case 'brush': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(world.x - last.x, world.y - last.y) >= 1.2) {
          d.pts.push({ x: world.x, y: world.y });
          st.draft = M.makePath('brush', 'brush', d.pts);
        }
        break;
      }
    }
  }

  /* scale maths: work in the frozen local frame so rotation & flips are exact */
  function applyScale(d, world, lockAspect, shiftOnly) {
    const st = FP.state;

    if (d.multi) {
      const b0 = d.bounds0;
      const h = d.handle;
      const ax = h.fx === 0 ? b0.x + b0.w : (h.fx === 1 ? b0.x : null);   // fixed edge in x
      const ay = h.fy === 0 ? b0.y + b0.h : (h.fy === 1 ? b0.y : null);
      let sx = 1, sy = 1;
      if (ax !== null) sx = Math.abs(world.x - ax) / Math.max(1, Math.abs(b0.x + h.fx * b0.w - ax));
      if (ay !== null) sy = Math.abs(world.y - ay) / Math.max(1, Math.abs(b0.y + h.fy * b0.h - ay));
      if (lockAspect || st.lockAspect) { const s = Math.max(sx, sy); sx = sy = s; }
      sx = Math.max(sx, 1 / Math.max(b0.w, b0.h));
      sy = Math.max(sy, 1 / Math.max(b0.w, b0.h));
      const px = ax === null ? b0.x + b0.w / 2 : ax;
      const py = ay === null ? b0.y + b0.h / 2 : ay;
      d.frozen.forEach(rec => {
        const o = rec.o;
        const cx = rec.x0 + rec.w0 / 2, cy = rec.y0 + rec.h0 / 2;
        const nx = px + (cx - px) * sx, ny = py + (cy - py) * sy;
        o.w = Math.max(1, rec.w0 * sx);
        o.h = Math.max(1, rec.h0 * sy);
        o.x = nx - o.w / 2; o.y = ny - o.h / 2;
      });
      return;
    }

    const rec = d.frozen[0];
    const o = rec.o;
    const frozen = { x: rec.x0, y: rec.y0, w: rec.w0, h: rec.h0, rot: rec.rot, flipH: rec.fh, flipV: rec.fv };
    const L = M.toLocal(frozen, world);                       // pointer in frozen local space

    const h = d.handle;
    const ax = h.fx === 0 ? rec.w0 : (h.fx === 1 ? 0 : null);
    const ay = h.fy === 0 ? rec.h0 : (h.fy === 1 ? 0 : null);

    let sx = 1, sy = 1;
    if (ax !== null) {
      const p0 = h.fx * rec.w0;
      sx = (L.x - ax) / ((p0 - ax) || 1e-6);
    }
    if (ay !== null) {
      const p0 = h.fy * rec.h0;
      sy = (L.y - ay) / ((p0 - ay) || 1e-6);
    }
    if (lockAspect || st.lockAspect) {
      const s = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
      if (ax !== null || ay !== null) { sx = s; sy = s; }
    }
    const MIN = 1;
    if (sx < MIN / rec.w0) sx = MIN / rec.w0;
    if (sy < MIN / rec.h0) sy = MIN / rec.h0;

    // anchor in frozen local space stays put; the centre moves by the same map
    const AX = ax === null ? rec.w0 / 2 : ax;
    const AY = ay === null ? rec.h0 / 2 : ay;
    const newCx = AX + (rec.w0 / 2 - AX) * sx;
    const newCy = AY + (rec.h0 / 2 - AY) * sy;
    const worldCenter = M.toWorld(frozen, { x: newCx, y: newCy });

    o.w = Math.max(MIN, rec.w0 * sx);
    o.h = Math.max(MIN, rec.h0 * sy);
    o.x = worldCenter.x - o.w / 2;
    o.y = worldCenter.y - o.h / 2;
  }

  function applyRotation(d, delta) {
    const st = FP.state;
    d.frozen.forEach(rec => {
      const o = rec.o;
      o.rot = rec.rot0 + delta;
      if (!d.pinCenters) {
        /* multi-selection: every member orbits the shared pivot */
        const cos = Math.cos(delta), sin = Math.sin(delta);
        const rx = rec.cx0 - d.pivot.x, ry = rec.cy0 - d.pivot.y;
        const nx = d.pivot.x + rx * cos - ry * sin;
        const ny = d.pivot.y + rx * sin + ry * cos;
        o.x = nx - o.w / 2; o.y = ny - o.h / 2;
      }
      M.wrapAngle(o);
    });
  }

  /* ================= pointer up ================= */
  function end(world, screen, ev) {
    const st = FP.state;
    const d = st.drag;
    if (!d) return;

    switch (d.mode) {
      case 'pan': break;

      case 'move':
        M.history.push();
        break;

      case 'scale':
      case 'rotate':
        M.history.push();
        break;

      case 'marquee': {
        const rect = st.marquee;
        st.marquee = null;
        if (rect && rect.w > 2 && rect.h > 2) {
          const hits = M.pickRect(st.doc, rect).map(o => o.id);
          st.selection = ev && ev.shift ? Array.from(new Set(d.base.concat(hits))) : hits;
        }
        break;
      }

      case 'create': {
        const tool = d.tool;
        let draft = st.draft;
        if (!draft) {
          // a plain click: give the tool a sensible default
          const size = (tool === 'arc') ? { w: 160, h: 160 } : { w: 140, h: 140 };
          if (tool === 'image') placeImageAt(world, null);
          else {
            const o = M.makeBox(tool, tool, { x: world.x - size.w / 2, y: world.y - size.h / 2, w: size.w, h: size.h });
            M.add(st.doc, o); M.history.push();
          }
          st.draft = null;
          FP.ui.refresh();
          return;
        }
        if (tool === 'image') {
          placeImageAt({ x: draft.x + draft.w / 2, y: draft.y + draft.h / 2 }, { w: draft.w, h: draft.h });
        } else {
          draft.w = Math.max(2, draft.w); draft.h = Math.max(2, draft.h);
          if ((draft.w < 4 || draft.h < 4) && tool !== 'arc') { draft.w = 140; draft.h = 140; }
          Object.assign(draft, M.styleFromState(draft, tool));
          M.add(st.doc, draft);
          M.history.push();
        }
        st.draft = null;
        FP.ui.refresh();
        return;
      }

      case 'brush': {
        if (d.pts.length > 1) {
          // drop the duplicate back-to-back samples
          const o = M.makePath('brush', 'brush', d.pts);
          o.name = 'Brush stroke';
          M.add(st.doc, o);
          M.history.push();
        }
        st.draft = null;
        FP.ui.refresh();
        return;
      }
    }
    st.drag = null;
  }

  /* ================= multi-click finalise ================= */
  function finishPending() {
    const st = FP.state;
    const pd = st.pending;
    st.pending = null;
    if (!pd || pd.pts.length < 2) { FP.ui.refresh(); return; }
    const tool = pd.tool;
    let pts = pd.pts;
    if (tool === 'line' && pts.length >= 2) pts = [pts[0], pts[1]];
    if (tool === 'triangle' && pts.length > 3) pts = pts.slice(0, 3);
    if (tool === 'quad' && pts.length > 4) pts = pts.slice(0, 4);
    if (tool === 'bezier' && pts.length > 4) pts = pts.slice(0, 4);

    const o = M.makePath(tool, tool, pts);
    if (tool === 'line' || tool === 'bezier') { /* paths already have stroke defaults */ }
    M.add(st.doc, o);
    M.history.push();
    FP.ui.refresh();
  }

  function cancelPending() {
    FP.state.pending = null;
    FP.ui.refresh();
  }

  /* ================= image placement ================= */
  function placeImageAt(center, box) {
    const st = FP.state;
    const rec = st.pendingImage ? FP.images.get(st.pendingImage.key) : null;
    if (!rec || !rec.el) {
      FP.ui.toast('Load an image first (Image source panel, drag & drop, or the Load image… button).');
      return null;
    }
    const nat = { w: rec.el.width, h: rec.el.height };
    let w, h;
    if (box && box.w > 4 && box.h > 4) { w = box.w; h = box.h; }
    else {
      const fit = Math.min((st.doc.w * 0.8) / nat.w, (st.doc.h * 0.8) / nat.h, 1);
      w = nat.w * fit; h = nat.h * fit;
    }
    const o = M.baseObject('image');
    o.imgKey = st.pendingImage.key;
    o.imgName = st.pendingImage.name;
    o.name = 'Image · ' + (st.pendingImage.name || '');
    o.fillOn = false; o.strokeOn = false;
    o.w = Math.max(4, w); o.h = Math.max(4, h);
    o.x = (center ? center.x : st.doc.w / 2) - o.w / 2;
    o.y = (center ? center.y : st.doc.h / 2) - o.h / 2;
    M.add(st.doc, o);
    M.history.push();
    FP.ui.refresh();
    return o;
  }

  /* called after a successful load: drop it onto the artboard, centred */
  function placeLoadedImage(key, name) {
    const st = FP.state;
    const rec = FP.images.get(key);
    if (!rec) return null;
    st.pendingImage = { key: key, name: name || rec.name };
    const nat = { w: rec.el.width, h: rec.el.height };
    const fit = Math.min((st.doc.w * 0.8) / nat.w, (st.doc.h * 0.8) / nat.h, 1);
    const o = M.baseObject('image');
    o.imgKey = key;
    o.imgName = name || rec.name;
    o.name = 'Image · ' + o.imgName;
    o.fillOn = false; o.strokeOn = false;
    o.w = nat.w * fit; o.h = nat.h * fit;
    o.x = (st.doc.w - o.w) / 2; o.y = (st.doc.h - o.h) / 2;
    M.add(st.doc, o);
    M.history.push();
    return o;
  }

  /* ================= document commands ================= */
  const cmd = {
    undo() { if (M.history.undo()) { FP.ui.refresh(); FP.ui.syncControls(); } },
    redo() { if (M.history.redo()) { FP.ui.refresh(); FP.ui.syncControls(); } },

    setTool(name) {
      const st = FP.state;
      if (!FP.TOOLS[name]) return;
      st.tool = name;
      st.pending = null;
      st.draft = null;
      st.marquee = null;
      applyToolDefaults(name);
      FP.ui.refresh();
      FP.ui.syncControls();
    },

    deleteSelection() {
      const st = FP.state;
      if (!st.selection.length) return;
      M.remove(st.doc, st.selection.slice());
      M.history.push();
      FP.ui.refresh();
    },

    duplicateSelection() {
      const st = FP.state;
      if (!st.selection.length) return;
      M.duplicate(st.doc, st.selection.slice());
      M.history.push();
      FP.ui.refresh();
    },

    selectAll() {
      M.selectAll(FP.state.doc);
      FP.ui.refresh();
    },

    bringToFront() { M.bringToFront(FP.state.doc, FP.state.selection.slice()); M.history.push(); FP.ui.refresh(); },
    sendToBack() { M.sendToBack(FP.state.doc, FP.state.selection.slice()); M.history.push(); FP.ui.refresh(); },

    nudge(dx, dy) {
      const sel = M.selected(FP.state.doc);
      if (!sel.length) return;
      M.moveBy(sel, dx, dy);
      M.history.push();
      FP.ui.refresh();
    },

    rotateStep(deg) {
      const sel = M.selected(FP.state.doc);
      if (!sel.length) return;
      const delta = U.rad(deg);
      if (sel.length === 1) {
        sel[0].rot += delta;
        M.wrapAngle(sel[0]);
      } else {
        const b = M.selectionBounds(FP.state.doc);
        const pivot = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const cos = Math.cos(delta), sin = Math.sin(delta);
        sel.forEach(o => {
          o.rot += delta;
          const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
          const rx = cx - pivot.x, ry = cy - pivot.y;
          o.x = pivot.x + rx * cos - ry * sin - o.w / 2;
          o.y = pivot.y + rx * sin + ry * cos - o.h / 2;
        });
      }
      M.history.push();
      FP.ui.refresh();
    },

    flip(axis) {
      const sel = M.selected(FP.state.doc);
      if (!sel.length) return;
      sel.forEach(o => M.flip(o, axis));
      M.history.push();
      FP.ui.refresh();
    },

    fitToArtboard() {
      const sel = M.selected(FP.state.doc);
      if (!sel.length) return;
      sel.forEach(o => M.fitToArtboard(FP.state.doc, o));
      M.history.push();
      FP.ui.refresh();
    },

    setGrid(v) { FP.state.grid = !!v; },
    setShadow(v) { FP.state.shadow = !!v; },
    setSnap(v) { FP.state.snap = !!v; },
    setLockAspect(v) { FP.state.lockAspect = !!v; },

    setBg(hex) {
      FP.state.doc.bg = hex;
      M.history.push();
      FP.ui.refresh();
    },

    setDocSize(w, h) {
      FP.state.doc.w = w; FP.state.doc.h = h;
      M.history.push();
      FP.ui.fitView();
      FP.ui.refresh();
      FP.ui.syncControls();
    },

    clearAll() {
      const st = FP.state;
      st.doc.objects = [];
      st.selection = [];
      M.history.push();
      FP.ui.refresh();
    }
  };

  function applyToolDefaults(name) {
    const st = FP.state;
    const t = FP.TOOLS[name];
    if (!t) return;
    if (t.fill === true) st.style.fillOn = true;
    if (t.fill === false) st.style.fillOn = false;
    if (t.stroke === true) st.style.strokeOn = true;
    if (t.stroke === false) st.style.strokeOn = false;
    if (t.strokePx && st.style.weight === FP.STYLE_DEFAULT.weight) st.style.weight = t.strokePx;
  }

  FP.tools = { begin, move, end, finishPending, cancelPending, snapAngle, boxFromDrag, applyScale, applyRotation, placeImageAt, placeLoadedImage, makePoint, BOX_TOOLS, MULTI_TOOLS };
  FP.cmd = cmd;
})(window.FP);