/* ------------------------------------------------------------------
   render.js — everything that puts pixels on the canvas.
   All draw functions take a p5 "target" (the sketch or a p5.Graphics)
   so the same code renders the live view and the export buffer.
------------------------------------------------------------------ */
(function (FP) {
  const M = FP.model;
  const U = FP.util;

  const HANDLE_R = 10;      // screen-space hit radius
  const ROT_DIST = 30;      // screen distance of the rotate handle above the box

  const ACCENT = '#4f6df5';
  const ACCENT_2 = '#17c3b2';

  /* handle layout: index -> anchor factors */
  const HANDLES = [
    { fx: 0, fy: 0, cur: 'nwse-resize' },   // 0 top-left
    { fx: 0.5, fy: 0, cur: 'ns-resize' },   // 1 top
    { fx: 1, fy: 0, cur: 'nesw-resize' },   // 2 top-right
    { fx: 1, fy: 0.5, cur: 'ew-resize' },   // 3 right
    { fx: 1, fy: 1, cur: 'nwse-resize' },   // 4 bottom-right
    { fx: 0.5, fy: 1, cur: 'ns-resize' },   // 5 bottom
    { fx: 0, fy: 1, cur: 'nesw-resize' },   // 6 bottom-left
    { fx: 0, fy: 0.5, cur: 'ew-resize' }    // 7 left
  ];
  FP.HANDLES = HANDLES;

  /* ---------------- view math ---------------- */
  FP.viewOps = {
    worldToScreen(p) {
      const v = FP.state.view;
      return { x: p.x * v.zoom + v.ox, y: p.y * v.zoom + v.oy };
    },
    screenToWorld(p) {
      const v = FP.state.view;
      return { x: (p.x - v.ox) / v.zoom, y: (p.y - v.oy) / v.zoom };
    },
    /* screen-space tolerance converted to world units */
    tol(screenPx) { return screenPx / FP.state.view.zoom; },
    fit(stageW, stageH, doc) {
      const pad = 56;
      const z = Math.max(0.05, Math.min((stageW - pad) / doc.w, (stageH - pad) / doc.h, 1.5));
      FP.state.view.zoom = z;
      FP.state.view.ox = (stageW - doc.w * z) / 2;
      FP.state.view.oy = (stageH - doc.h * z) / 2;
      return z;
    },
    setZoom(z, focusScreen) {
      const v = FP.state.view;
      const focus = focusScreen || { x: 0, y: 0 };
      const before = this.screenToWorld(focus);
      v.zoom = U.clamp(z, 0.05, 8);
      const after = this.screenToWorld(focus);
      v.ox += (after.x - before.x) * v.zoom;
      v.oy += (after.y - before.y) * v.zoom;
    }
  };

  /* ---------------- styling ---------------- */
  function applyFill(p, o) {
    if (o.fillOn) p.fill(U.rgba(o.fill, o.alpha !== undefined ? o.alpha : 1));
    else p.noFill();
  }
  function applyStroke(p, o) {
    if (o.strokeOn && o.weight > 0) {
      p.stroke(o.stroke);
      p.strokeWeight(o.weight);
      p.strokeCap(ROUND);
      p.strokeJoin(ROUND);
    } else {
      p.noStroke();
    }
  }

  /* ---------------- scene drawing ---------------- */
  function drawObject(p, o) {
    if (!o.visible) return;
    p.push();
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    p.translate(cx, cy);
    if (o.rot) p.rotate(o.rot);
    if (o.flipH || o.flipV) p.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    applyFill(p, o);
    applyStroke(p, o);
    const hw = o.w / 2, hh = o.h / 2;

    switch (o.type) {
      case 'rect':
      case 'square':
        p.rect(-hw, -hh, o.w, o.h, Math.min(o.radius || 0, Math.min(o.w, o.h) / 2));
        break;

      case 'ellipse':
      case 'circle':
        p.ellipse(0, 0, o.w, o.h);
        break;

      case 'triangle':
      case 'quad':
      case 'poly': {
        if (!o.pts || o.pts.length < 2) break;
        p.beginShape();
        o.pts.forEach(pt => p.vertex((pt.x - 0.5) * o.w, (pt.y - 0.5) * o.h));
        p.endShape(CLOSE);
        break;
      }

      case 'line':
      case 'brush': {
        if (!o.pts || o.pts.length < 2) break;
        p.noFill();
        if (!o.strokeOn) { p.stroke(o.fill); p.strokeWeight(o.weight); }
        p.beginShape();
        o.pts.forEach(pt => p.vertex((pt.x - 0.5) * o.w, (pt.y - 0.5) * o.h));
        p.endShape();
        break;
      }

      case 'bezier': {
        const q = (o.pts || []).map(pt => [(pt.x - 0.5) * o.w, (pt.y - 0.5) * o.h]);
        if (q.length < 4) break;
        p.noFill();
        if (!o.strokeOn) { p.stroke(o.fill); p.strokeWeight(o.weight); }
        p.bezier(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]);
        break;
      }

      case 'arc': {
        const a0 = Math.min(o.a0, o.a1), a1 = Math.max(o.a0, o.a1);
        if (o.arcMode === 'OPEN') p.noFill();
        p.arc(0, 0, o.w, o.h, U.rad(a0), U.rad(a1), o.arcMode);
        break;
      }

      case 'point':
        p.noStroke();
        p.circle(0, 0, Math.max(o.weight, 4));
        break;

      case 'image': {
        const rec = FP.images.get(o.imgKey);
        if (rec && rec.el) {
          p.push();
          if (o.radius > 0) {
            const d = p.drawingContext;
            d.save();
            roundedPath(d, -hw, -hh, o.w, o.h, Math.min(o.radius, Math.min(o.w, o.h) / 2));
            d.clip();
            p.image(rec.el, -hw, -hh, o.w, o.h);
            d.restore();
          } else {
            p.image(rec.el, -hw, -hh, o.w, o.h);
          }
          if (o.strokeOn && o.weight > 0) {
            p.noFill(); p.stroke(o.stroke); p.strokeWeight(o.weight);
            p.rect(-hw, -hh, o.w, o.h, Math.min(o.radius || 0, Math.min(o.w, o.h) / 2));
          }
          p.pop();
        } else {
          // image data missing (e.g. a restored session) — show a placeholder
          p.noFill();
          p.stroke('#8b93a5');
          p.strokeWeight(2);
          p.drawingContext.setLineDash([6, 5]);
          p.rect(-hw, -hh, o.w, o.h);
          p.drawingContext.setLineDash([]);
          p.noStroke();
          p.fill('#8b93a5');
          p.textAlign(CENTER, CENTER);
          p.textSize(Math.max(11, Math.min(20, o.w / 12)));
          p.text('image', 0, 0);
        }
        break;
      }
    }
    p.pop();
  }

  function roundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawObjects(p, doc) {
    doc.objects.forEach(o => drawObject(p, o));
  }

  /* ---------------- selection overlay ---------------- */

  /* positions of the eight scale handles + the rotate handle, in world & screen space */
  function handlePositions() {
    const doc = FP.state.doc;
    const sel = M.selected(doc);
    if (!sel.length) return { single: null, list: [], rotate: null };

    const zoom = FP.state.view.zoom;
    const rotLocal = ROT_DIST / zoom;

    if (sel.length === 1) {
      const o = sel[0];
      const list = HANDLES.map(h => {
        const world = M.toWorld(o, { x: h.fx * o.w, y: h.fy * o.h });
        return { kind: 'scale', index: HANDLES.indexOf(h), ...h, world, screen: FP.viewOps.worldToScreen(world) };
      });
      const rotWorld = M.toWorld(o, { x: o.w / 2, y: -rotLocal });
      const topWorld = M.toWorld(o, { x: o.w / 2, y: 0 });
      return {
        single: o, list,
        rotate: { kind: 'rotate', world: rotWorld, screen: FP.viewOps.worldToScreen(rotWorld), anchor: FP.viewOps.worldToScreen(topWorld) }
      };
    }

    // multi-selection: axis-aligned frame around the whole selection
    const b = M.selectionBounds(doc);
    const list = HANDLES.map(h => {
      const world = { x: b.x + h.fx * b.w, y: b.y + h.fy * b.h };
      return { kind: 'scale', index: HANDLES.indexOf(h), ...h, world, screen: FP.viewOps.worldToScreen(world) };
    });
    return { single: null, list, rotate: null, multiBounds: b };
  }

  /* which handle (if any) is under a screen point */
  function handleAt(screenPt) {
    const hp = handlePositions();
    if (!hp.list.length) return null;
    for (const h of hp.list) {
      if (Math.hypot(h.screen.x - screenPt.x, h.screen.y - screenPt.y) <= HANDLE_R) {
        return { kind: 'scale', index: h.index, fx: h.fx, fy: h.fy, cursor: h.cur };
      }
    }
    if (hp.rotate && Math.hypot(hp.rotate.screen.x - screenPt.x, hp.rotate.screen.y - screenPt.y) <= HANDLE_R + 1) {
      return { kind: 'rotate', cursor: 'grab' };
    }
    return null;
  }

  function drawSelection(p) {
    const doc = FP.state.doc;
    const sel = M.selected(doc);
    if (!sel.length) return;
    const z = FP.state.view.zoom;
    const ctx = p.drawingContext;
    const sw = 1 / z;

    // frame around every selected object
    p.push();
    p.noFill();
    ctx.setLineDash([]);
    sel.forEach(o => {
      const c = M.corners(o);
      p.stroke(ACCENT);
      p.strokeWeight(Math.max(0.8, 1 * sw));
      p.beginShape();
      c.forEach(pt => p.vertex(pt.x, pt.y));
      p.endShape(CLOSE);
    });
    ctx.setLineDash([]);
    p.pop();

    const hp = handlePositions();
    if (hp.multiBounds) {
      const b = hp.multiBounds;
      p.push();
      p.noFill();
      ctx.setLineDash([]);
      p.stroke(ACCENT_2);
      p.strokeWeight(Math.max(0.8, 1 * sw));
      p.rect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      p.pop();
    }

    // rotate handle stem
    if (hp.rotate) {
      p.push();
      ctx.setLineDash([4 * sw, 3 * sw]);
      p.stroke('#e7e9eeaa');
      p.strokeWeight(Math.max(0.8, 1 * sw));
      p.line(hp.rotate.anchor.x, hp.rotate.anchor.y, hp.rotate.world.x, hp.rotate.world.y);
      ctx.setLineDash([]);
      p.noStroke();
      p.fill(ACCENT_2);
      p.circle(hp.rotate.world.x, hp.rotate.world.y, 11 * sw);
      p.fill('#0b0d12');
      p.circle(hp.rotate.world.x, hp.rotate.world.y, 4 * sw);
      p.pop();
    }

    // scale handles
    const s = 9 * sw;
    p.push();
    p.stroke('#0b0d12');
    p.strokeWeight(1 * sw);
    p.fill('#ffffff');
    hp.list.forEach(h => p.rect(h.world.x - s / 2, h.world.y - s / 2, s, s, 2 * sw));
    p.pop();
  }

  /* rubber-band preview while a multi-point object is being built */
  function drawPending(p) {
    const pd = FP.state.pending;
    if (!pd || !pd.pts.length) return;
    const z = FP.state.view.zoom;
    const sw = 1 / z;
    const ctx = p.drawingContext;
    const tool = FP.TOOLS[pd.tool] || {};

    p.push();
    ctx.setLineDash([5 * sw, 4 * sw]);
    p.stroke(ACCENT_2);
    p.strokeWeight(Math.max(1, 1.5 * sw));
    p.noFill();
    if (pd.pts.length > 1) {
      p.beginShape();
      pd.pts.forEach(pt => p.vertex(pt.x, pt.y));
      p.endShape();
    }
    if (pd.hover && FP.state.pointerInside) {
      const last = pd.pts[pd.pts.length - 1];
      p.line(last.x, last.y, pd.hover.x, pd.hover.y);
      if (pd.tool === 'poly' && pd.pts.length > 1) {
        ctx.setLineDash([3 * sw, 5 * sw]);
        p.stroke('#ffffff88');
        p.line(pd.hover.x, pd.hover.y, pd.pts[0].x, pd.pts[0].y);
      }
    }
    ctx.setLineDash([]);
    p.noStroke();
    p.fill('#ffffff');
    pd.pts.forEach((pt, i) => {
      const lead = i === 0 && (pd.tool === 'poly');
      p.fill(lead ? ACCENT_2 : '#ffffff');
      p.circle(pt.x, pt.y, 8 * sw);
    });
    p.pop();
  }

  /* live preview of the shape currently being dragged/placed */
  function drawDraft(p) {
    const d = FP.state.draft;
    if (!d) return;
    p.push();
    p.drawingContext.globalAlpha = 0.92;
    drawObject(p, d);
    p.drawingContext.globalAlpha = 1;
    p.pop();
    // live size readout for box tools
    if (d.w > 4 && d.h > 4) {
      const z = FP.state.view.zoom;
      p.push();
      p.noStroke();
      const label = Math.round(d.w) + ' × ' + Math.round(d.h) + (d.rot ? '  ' + Math.round(U.deg(d.rot)) + '°' : '');
      const c = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
      const tp = M.toWorld(d, { x: d.w / 2, y: d.h / 2 + 14 / z });
      p.textSize(11 / z);
      p.textAlign(CENTER, CENTER);
      const wpx = p.textWidth(label);
      p.fill('#0b0d12cc');
      p.rect(tp.x - wpx / 2 - 5 / z, tp.y - 8 / z, wpx + 10 / z, 16 / z, 4 / z);
      p.fill('#ffffff');
      p.text(label, tp.x, tp.y);
      p.pop();
    }
  }

  /* marquee rectangle (screen->world rect already stored in world units) */
  function drawMarquee(p) {
    const m = FP.state.marquee;
    if (!m) return;
    const z = FP.state.view.zoom;
    const sw = 1 / z;
    p.push();
    p.drawingContext.setLineDash([5 * sw, 4 * sw]);
    p.stroke(ACCENT_2);
    p.strokeWeight(Math.max(0.8, 1.2 * sw));
    p.fill('rgba(23,195,178,0.10)');
    p.rect(m.x, m.y, m.w, m.h);
    p.drawingContext.setLineDash([]);
    p.pop();
  }

  /* brush cursor: a ring showing the actual stroke width */
  function drawBrushCursor(p) {
    if (FP.state.tool !== 'brush' || !FP.state.pointerInside || FP.state.draft) return;
    const z = FP.state.view.zoom;
    const c = FP.state.cursor;
    const r = Math.max(3, FP.state.style.weight / 2);
    p.push();
    p.noFill();
    p.stroke('#ffffffaa');
    p.strokeWeight(1 / z);
    p.circle(c.x, c.y, r * 2);
    p.pop();
  }

  function drawOverlay(p) {
    drawMarquee(p);
    drawPending(p);
    drawDraft(p);
    drawSelection(p);
    drawBrushCursor(p);
  }

  FP.render = {
    applyFill, applyStroke, drawObject, drawObjects, drawSelection,
    drawPending, drawDraft, drawMarquee, drawOverlay, drawBrushCursor,
    handlePositions, handleAt, roundedPath,
    HANDLE_R, ROT_DIST
  };
})(window.FP);