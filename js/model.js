/* ------------------------------------------------------------------
   model.js — the document model: objects, geometry, hit testing,
   transforms, and undo history. No DOM, no rendering.
------------------------------------------------------------------ */
(function (FP) {
  const U = FP.util;

  /* ================= object creation ================= */

  function baseObject(type, props) {
    const o = {
      id: U.uid('o'),
      type: type,
      x: 0, y: 0, w: 1, h: 1,
      rot: 0,
      flipH: false, flipV: false,
      visible: true,
      name: FP.LABELS[type] || type,
      fillOn: true, fill: FP.state.style.fill, alpha: 1,
      strokeOn: false, stroke: FP.state.style.stroke, weight: FP.state.style.weight,
      radius: 0,
      a0: 0, a1: 180, arcMode: 'PIE',
      pts: null,
      imgKey: null, imgName: null
    };
    return Object.assign(o, props || {});
  }

  function styleFromState(o, tool) {
    const s = FP.state.style;
    const t = FP.TOOLS[tool] || {};
    if (t.fill === null || t.fill === undefined) { o.fillOn = s.fillOn; o.strokeOn = s.strokeOn; }
    else { o.fillOn = t.fill; o.strokeOn = t.stroke; }
    o.fill = s.fill;
    o.alpha = s.alpha;
    o.stroke = s.stroke;
    o.weight = (t.strokePx && t.stroke && s.weight === FP.STYLE_DEFAULT.weight) ? t.strokePx : s.weight;
    o.radius = s.radius;
    o.a0 = s.a0; o.a1 = s.a1; o.arcMode = s.arcMode;
    return o;
  }

  /* build a box object (rect / square / ellipse / circle / arc / image) */
  function makeBox(type, tool, box, extra) {
    const o = styleFromState(baseObject(type), tool);
    o.x = box.x; o.y = box.y; o.w = box.w; o.h = box.h;
    return Object.assign(o, extra || {});
  }

  /* points given in world space -> normalised local points inside [0,1]x[0,1] */
  function normalizePoints(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    let w = maxX - minX, h = maxY - minY;
    const degenerateW = w < 0.5, degenerateH = h < 0.5;
    if (degenerateW) { w = 1; minX = (minX + maxX) / 2 - 0.5; }
    if (degenerateH) { h = 1; minY = (minY + maxY) / 2 - 0.5; }
    const npts = pts.map(p => ({
      x: degenerateW ? 0.5 : (p.x - minX) / w,
      y: degenerateH ? 0.5 : (p.y - minY) / h
    }));
    return { pts: npts, box: { x: minX, y: minY, w: w, h: h } };
  }

  /* build a path object from world-space points (line / brush / triangle / quad / poly / bezier) */
  function makePath(type, tool, worldPts, extra) {
    const n = normalizePoints(worldPts);
    const o = styleFromState(baseObject(type), tool);
    o.x = n.box.x; o.y = n.box.y; o.w = n.box.w; o.h = n.box.h;
    o.pts = n.pts;
    return Object.assign(o, extra || {});
  }

  /* ================= coordinate helpers ================= */

  /* object centre in world space */
  function center(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }

  /* world point -> object box space (0..w, 0..h), rotation + flips undone */
  function toLocal(o, p) {
    const c = center(o);
    let dx = p.x - c.x, dy = p.y - c.y;
    const co = Math.cos(-o.rot), si = Math.sin(-o.rot);
    let rx = dx * co - dy * si;
    let ry = dx * si + dy * co;
    if (o.flipH) rx = -rx;
    if (o.flipV) ry = -ry;
    return { x: rx + o.w / 2, y: ry + o.h / 2 };
  }

  /* object box space -> world point */
  function toWorld(o, l) {
    const c = center(o);
    let rx = l.x - o.w / 2, ry = l.y - o.h / 2;
    if (o.flipH) rx = -rx;
    if (o.flipV) ry = -ry;
    const co = Math.cos(o.rot), si = Math.sin(o.rot);
    return { x: c.x + rx * co - ry * si, y: c.y + rx * si + ry * co };
  }

  /* local box space -> normalised 0..1 (guarding degenerate boxes) */
  function toNorm(o, l) {
    return { x: o.w > 1e-6 ? l.x / o.w : 0.5, y: o.h > 1e-6 ? l.y / o.h : 0.5 };
  }

  /* the four corners of the object box, in world space (TL, TR, BR, BL) */
  function corners(o) {
    return [
      toWorld(o, { x: 0, y: 0 }),
      toWorld(o, { x: o.w, y: 0 }),
      toWorld(o, { x: o.w, y: o.h }),
      toWorld(o, { x: 0, y: o.h })
    ];
  }

  /* ================= geometry predicates ================= */

  function pointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const hit = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = U.clamp(t, 0, 1);
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }

  function distToPolyline(p, poly) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const d = distToSegment(p, poly[i - 1], poly[i]);
      if (d < best) best = d;
    }
    if (poly.length === 1) best = Math.hypot(p.x - poly[0].x, p.y - poly[0].y);
    return best;
  }

  /* world points of a path object's normalised points */
  function pathPoints(o) {
    if (!o.pts) return [];
    return o.pts.map(pt => toWorld(o, { x: pt.x * o.w, y: pt.y * o.h }));
  }

  /* polygon approximation of an arc, in local box space centred on 0,0 */
  function arcPolygon(o, steps) {
    const n = steps || 48;
    const a0 = U.rad(Math.min(o.a0, o.a1));
    const a1 = U.rad(Math.max(o.a0, o.a1));
    const hw = o.w / 2, hh = o.h / 2;
    const pts = [];
    if (o.arcMode !== 'OPEN') pts.push({ x: 0, y: 0 });
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hh });
    }
    return pts;
  }

  /* ================= hit testing =================
     p is a world point. tol is a world-space tolerance (already scaled by zoom
     by the caller) so picking stays pleasant however far you zoom in.
  ------------------------------------------------- */
  function hitTest(o, p, tol) {
    if (!o.visible) return false;
    const l = toLocal(o, p);
    const nx = toNorm(o, l);
    const inside = nx.x >= 0 && nx.x <= 1 && nx.y >= 0 && nx.y <= 1;
    const strokeTol = tol + (o.strokeOn ? o.weight / 2 : 0);

    switch (o.type) {
      case 'rect':
      case 'square':
        if (o.radius > 0.5) {
          // rounded corners: approximate by ignoring the corner cut-outs
          const r = o.radius;
          if (!inside) return false;
          const cxL = r, cyL = r;
          const cuts = [[l.x < r && l.y < r, cxL, cyL], [l.x > o.w - r && l.y < r, o.w - r, cyL],
                        [l.x > o.w - r && l.y > o.h - r, o.w - r, o.h - r], [l.x < r && l.y > o.h - r, cxL, o.h - r]];
          for (const [near, ccx, ccy] of cuts) {
            if (near && Math.hypot(l.x - ccx, l.y - ccy) > r + strokeTol) return false;
          }
          return o.fillOn || nearEdge(l, o, strokeTol);
        }
        return o.fillOn ? inside : nearEdge(l, o, strokeTol);

      case 'ellipse':
      case 'circle': {
        const rx = o.w / 2, ry = o.h / 2;
        const ex = (l.x - rx) / (rx || 1), ey = (l.y - ry) / (ry || 1);
        const r = Math.hypot(ex, ey);
        if (o.fillOn) {
          if (r <= 1 + strokeTol / Math.max(rx, ry)) return true;
        }
        const thickness = strokeTol / Math.max(rx, ry);
        return Math.abs(r - 1) <= Math.max(thickness, 0.04);
      }

      case 'triangle':
      case 'quad':
      case 'poly': {
        const poly = pathPoints(o);
        if (poly.length < 3) return false;
        if (o.fillOn && pointInPolygon(p.x, p.y, poly)) return true;
        const closes = poly.concat([poly[0]]);
        return distToPolyline(p, closes) <= strokeTol;
      }

      case 'line':
      case 'bezier':
      case 'brush': {
        const poly = pathPoints(o);
        if (!poly.length) return false;
        return distToPolyline(p, poly) <= strokeTol + 2;
      }

      case 'arc': {
        const poly = arcPolygon(o, 40).map(v => toWorld(o, { x: v.x + o.w / 2, y: v.y + o.h / 2 }));
        if (o.arcMode === 'OPEN') return distToPolyline(p, poly) <= strokeTol + 2;
        if (o.fillOn && pointInPolygon(p.x, p.y, poly)) return true;
        const closes = poly.concat([poly[0]]);
        return distToPolyline(p, closes) <= strokeTol;
      }

      case 'point':
        return Math.hypot(l.x - o.w / 2, l.y - o.h / 2) <= Math.max(tol, o.weight) + 2;

      case 'image':
        return o.fillOn === false ? true : (inside || nearEdge(l, o, strokeTol));

      default:
        return inside;
    }
  }

  function nearEdge(l, o, tol) {
    const t = Math.max(tol, 1.5);
    return l.x <= t || l.y <= t || l.x >= o.w - t || l.y >= o.h - t;
  }

  /* topmost object under a world point */
  function pick(doc, p, tol) {
    for (let i = doc.objects.length - 1; i >= 0; i--) {
      if (hitTest(doc.objects[i], p, tol)) return doc.objects[i];
    }
    return null;
  }

  /* all objects whose axis-aligned bounds intersect a world rect */
  function pickRect(doc, rect) {
    return doc.objects.filter(o => o.visible && U.rectIntersect(U.rotatedBounds(o), rect));
  }

  /* ================= selection helpers ================= */
  function findById(doc, id) {
    for (let i = 0; i < doc.objects.length; i++) if (doc.objects[i].id === id) return doc.objects[i];
    return null;
  }
  function selected(doc) {
    return FP.state.selection.map(id => findById(doc, id)).filter(Boolean);
  }
  function selectionBounds(doc) {
    const sel = selected(doc);
    if (!sel.length) return null;
    if (sel.length === 1) return U.rotatedBounds(sel[0]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    sel.forEach(o => {
      const b = U.rotatedBounds(o);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function selectOnly(doc, id) { FP.state.selection = id ? [id] : []; }
  function toggleSelect(doc, id) {
    const i = FP.state.selection.indexOf(id);
    if (i >= 0) FP.state.selection.splice(i, 1); else FP.state.selection.push(id);
  }
  function selectAll(doc) { FP.state.selection = doc.objects.filter(o => o.visible).map(o => o.id); }
  function deselect() { FP.state.selection = []; }

  /* ================= document operations ================= */

  function add(doc, o, opts) {
    doc.objects.push(o);
    if (!opts || opts.select !== false) selectOnly(doc, o.id);
    return o;
  }
  function remove(doc, ids) {
    const set = new Set(ids);
    doc.objects = doc.objects.filter(o => !set.has(o.id));
    FP.state.selection = FP.state.selection.filter(id => !set.has(id));
  }
  function duplicate(doc, ids) {
    const out = [];
    ids.forEach(id => {
      const src = findById(doc, id);
      if (!src) return;
      const copy = JSON.parse(JSON.stringify(src, replacer));
      copy.id = U.uid('o');
      copy.name = src.name;
      copy.x += 18; copy.y += 18;
      copy.imgKey = src.imgKey;
      doc.objects.push(copy);
      out.push(copy.id);
    });
    if (out.length) FP.state.selection = out;
    return out;
  }
  function moveBy(objs, dx, dy) { objs.forEach(o => { o.x += dx; o.y += dy; }); }
  function bringToFront(doc, ids) {
    const set = new Set(ids);
    const keep = doc.objects.filter(o => !set.has(o.id));
    const move = doc.objects.filter(o => set.has(o.id));
    doc.objects = keep.concat(move);
  }
  function sendToBack(doc, ids) {
    const set = new Set(ids);
    const keep = doc.objects.filter(o => !set.has(o.id));
    const move = doc.objects.filter(o => set.has(o.id));
    doc.objects = move.concat(keep);
  }
  function rotateBy(o, deltaRad) {
    o.rot += deltaRad;
    wrapAngle(o);
  }
  function wrapAngle(o) {
    while (o.rot > Math.PI) o.rot -= Math.PI * 2;
    while (o.rot <= -Math.PI) o.rot += Math.PI * 2;
    if (Math.abs(o.rot) < 1e-9) o.rot = 0;
  }
  function flip(o, axis) {
    if (axis === 'h') o.flipH = !o.flipH; else o.flipV = !o.flipV;
  }
  function fitToArtboard(doc, o) {
    const pad = 24;
    const sx = (doc.w - pad * 2) / o.w, sy = (doc.h - pad * 2) / o.h;
    const s = Math.min(sx, sy);
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    o.w *= s; o.h *= s;
    o.x = cx - o.w / 2; o.y = cy - o.h / 2;
  }

  /* ================= serialisation ================= */
  function replacer(key, value) {
    if (key === '_snap' || key === 'sel') return undefined;
    return value;
  }
  function serialize(state) {
    const s = state || FP.state;
    return JSON.stringify({
      version: FP.VERSION,
      doc: { name: s.doc.name, w: s.doc.w, h: s.doc.h, bg: s.doc.bg, objects: s.doc.objects },
      style: s.style,
      view: s.view,
      flags: { grid: s.grid, shadow: s.shadow, snap: s.snap, lockAspect: s.lockAspect, imgFit: s.imgFit }
    }, replacer);
  }
  function deserialize(json) {
    const data = (typeof json === 'string') ? JSON.parse(json) : json;
    const s = FP.state;
    s.doc = {
      name: data.doc.name || 'Untitled',
      w: data.doc.w || 1280, h: data.doc.h || 720,
      bg: data.doc.bg || '#ffffff',
      objects: data.doc.objects || []
    };
    if (data.style) Object.assign(s.style, data.style);
    if (data.view) Object.assign(s.view, data.view);
    if (data.flags) Object.assign(s, data.flags);
    s.selection = [];
    return s.doc;
  }

  /* ================= history ================= */
  const history = {
    stack: [],
    index: -1,
    limit: 60,
    push() {
      const snap = serialize();
      if (this.stack[this.index] === snap) return;            // no-op change
      this.stack = this.stack.slice(0, this.index + 1);
      this.stack.push(snap);
      if (this.stack.length > this.limit) this.stack.shift();
      this.index = this.stack.length - 1;
    },
    reset() {
      this.stack = [serialize()];
      this.index = 0;
    },
    canUndo() { return this.index > 0; },
    canRedo() { return this.index < this.stack.length - 1; },
    undo() {
      if (!this.canUndo()) return false;
      this.index -= 1;
      deserialize(this.stack[this.index]);
      return true;
    },
    redo() {
      if (!this.canRedo()) return false;
      this.index += 1;
      deserialize(this.stack[this.index]);
      return true;
    }
  };

  /* ================= export ================= */
  function toSVG(doc, opts) {
    const pad = 0;
    const w = doc.w, h = doc.h;
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    parts.push('<rect width="100%" height="100%" fill="' + doc.bg + '"/>');
    doc.objects.forEach(o => {
      if (!o.visible) return;
      const t = 'translate(' + (o.x + o.w / 2) + ' ' + (o.y + o.h / 2) + ') rotate(' + (U.deg(o.rot)) + ') scale(' +
        (o.flipH ? -1 : 1) + ' ' + (o.flipV ? -1 : 1) + ')';
      const paint = 'fill="' + (o.fillOn ? U.rgba(o.fill, o.alpha) : 'none') + '"' +
        ' stroke="' + (o.strokeOn ? o.stroke : 'none') + '" stroke-width="' + (o.strokeOn ? o.weight : 0) + '"' +
        ' stroke-linecap="round" stroke-linejoin="round"';
      parts.push('<g transform="' + t + '">' + shapeSVG(o, paint) + '</g>');
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  function shapeSVG(o, paint) {
    const hw = o.w / 2, hh = o.h / 2;
    const P = o.pts || [];
    const localPts = P.map(p => [(p.x - 0.5) * o.w, (p.y - 0.5) * o.h]);
    switch (o.type) {
      case 'rect': case 'square':
        return '<rect x="' + (-hw) + '" y="' + (-hh) + '" width="' + o.w + '" height="' + o.h +
          '" rx="' + (o.radius || 0) + '" ' + paint + '/>';
      case 'ellipse': case 'circle':
        return '<ellipse cx="0" cy="0" rx="' + hw + '" ry="' + hh + '" ' + paint + '/>';
      case 'triangle': case 'quad': case 'poly':
        return '<polygon points="' + localPts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') + '" ' + paint + '/>';
      case 'line': case 'brush':
        return '<polyline points="' + localPts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') +
          '" fill="none" ' + paint + '/>';
      case 'bezier': {
        const b = localPts;
        if (b.length < 4) return '';
        return '<path d="M' + b[0][0].toFixed(2) + ' ' + b[0][1].toFixed(2) + ' C' + b[1][0].toFixed(2) + ' ' + b[1][1].toFixed(2) +
          ' ' + b[2][0].toFixed(2) + ' ' + b[2][1].toFixed(2) + ' ' + b[3][0].toFixed(2) + ' ' + b[3][1].toFixed(2) +
          '" fill="none" ' + paint + '/>';
      }
      case 'arc': {
        const a0 = U.rad(Math.min(o.a0, o.a1)), a1 = U.rad(Math.max(o.a0, o.a1));
        const p0 = [Math.cos(a0) * hw, Math.sin(a0) * hh];
        const p1 = [Math.cos(a1) * hw, Math.sin(a1) * hh];
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        let d = 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + hw + ' ' + hh + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
        if (o.arcMode === 'PIE') d += ' L0 0 Z';
        else if (o.arcMode === 'CHORD') d += ' Z';
        return '<path d="' + d + '" ' + (o.arcMode === 'OPEN' ? 'fill="none" ' : '') + paint + '/>';
      }
      case 'point':
        return '<circle cx="0" cy="0" r="' + Math.max(o.weight, 2) + '" fill="' + U.rgba(o.fill, o.alpha) + '" stroke="none"/>';
      default:
        return '';
    }
  }

  FP.model = {
    baseObject, makeBox, makePath, normalizePoints, styleFromState,
    center, toLocal, toWorld, toNorm, corners, pathPoints, arcPolygon,
    hitTest, pick, pickRect, pointInPolygon, distToSegment, distToPolyline,
    findById, selected, selectionBounds, selectOnly, toggleSelect, selectAll, deselect, wrapAngle,
    add, remove, duplicate, moveBy, bringToFront, sendToBack, rotateBy, flip, fitToArtboard,
    serialize, deserialize, replacer, history, toSVG, shapeSVG
  };
})(window.FP);