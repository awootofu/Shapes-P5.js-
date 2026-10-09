/* ------------------------------------------------------------------
   ui.js — the DOM side of the app: panel controls, colour palette,
   layer list, keyboard, drag & drop, image loading, export.
   The canvas itself lives in sketch.js; this file never touches p5
   except through FP.api (set by sketch.js).
------------------------------------------------------------------ */
(function (FP) {
  const M = FP.model;
  const U = FP.util;
  const R = FP.render;
  const $ = s => document.querySelector(s);

  const ui = FP.ui = {};
  let syncing = false;
  let el = {};
  let toastUntil = 0;

  /* ================= helpers ================= */
  const shapeIcon = {
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    circle: '<circle cx="12" cy="12" r="7"/>',
    triangle: '<path d="M12 5l7.5 14h-15z"/>',
    quad: '<path d="M5 9l6-4 8 5-2 9-10 .5z"/>',
    poly: '<path d="M12 4l7 5.2-2.7 8.3H7.7L5 9.2z"/>',
    line: '<path d="M4 19L20 5"/>',
    arc: '<path d="M4 18a8 8 0 0 1 16 0"/>',
    bezier: '<path d="M4 18C4 7 20 17 20 6"/>',
    brush: '<path d="M4 17c3-7 6 5 9-2s4 3 7-4"/>',
    point: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 17.5l4.5-4.5 3.5 3.5 2.5-2 4.5 4"/>'
  };

  function toast(msg, ms) {
    el['status-hint'].textContent = msg;
    toastUntil = Date.now() + (ms || 4200);
  }
  ui.toast = toast;

  /* ================= init ================= */
  ui.init = function () {
    [
      'topbar', 'btn-undo', 'btn-redo', 'btn-clear', 'btn-export', 'btn-zoom-in', 'btn-zoom-out',
      'btn-fit', 'btn-zoom-reset', 'zoom-readout', 'btn-load-image', 'file-image', 'btn-help',
      'help-overlay', 'btn-help-close', 'tools', 'stage', 'canvas-host', 'panel',
      'props-title', 'chk-fill', 'in-fill', 'in-alpha', 'out-alpha', 'chk-stroke', 'in-stroke',
      'in-weight', 'out-weight', 'row-radius', 'in-radius', 'out-radius', 'row-arc', 'in-a0',
      'in-a1', 'in-arcmode', 'out-arc', 'in-palette', 'swatches', 'sel-hint', 'in-x', 'in-y', 'in-w', 'in-h',
      'in-rot', 'out-rot', 'btn-rot-ccw', 'btn-rot-cw', 'btn-flip-h', 'btn-flip-v', 'btn-dup',
      'btn-front', 'btn-back', 'btn-del', 'btn-fit-art', 'btn-lock-aspect', 'in-img-url',
      'btn-load-url', 'btn-load-file-2', 'chk-img-fit', 'img-note', 'in-bg', 'in-canvas-size',
      'chk-grid', 'chk-shadow', 'chk-snap', 'layers', 'layer-count', 'status-hint',
      'status-coords', 'status-zoom', 'drop-overlay', 'card-transform'
    ].forEach(id => { el[id] = document.getElementById(id); });

    buildPalette();
    bindTopbar();
    bindTools();
    bindPanel();
    bindImage();
    bindCanvasSurface();
    bindKeyboard();
    bindHelp();
    refreshPaletteUI();
    FP.ui.syncControls();
    updateStatus();
  };

  /* ================= palettes ================= */
  function buildPalette() {
    el['in-palette'].innerHTML = FP.PALETTES
      .map((p, i) => '<option value="' + i + '">' + p.name + ' · ' + p.colors.length + ' flat colours</option>')
      .join('');
    el['in-palette'].value = String(FP.state.paletteIndex);
    renderSwatches();
  }

  function renderSwatches() {
    const pal = FP.PALETTES[FP.state.paletteIndex];
    el.swatches.innerHTML = pal.colors.map((c, i) =>
      '<button class="sw" data-i="' + i + '" style="background:' + c + '" title="' + c + ' · click = fill, shift-click = stroke"></button>'
    ).join('');
    refreshPaletteUI();
  }

  function refreshPaletteUI() {
    const pal = FP.PALETTES[FP.state.paletteIndex];
    const st = FP.state;
    const target = selectedStyleTarget();
    const fill = (target ? target.fill : st.style.fill).toLowerCase();
    const stroke = (target ? target.stroke : st.style.stroke).toLowerCase();
    Array.from(el.swatches.children).forEach((b, i) => {
      const c = (pal.colors[i] || '').toLowerCase();
      b.classList.toggle('on', c === fill);
      b.classList.toggle('on-stroke', c === stroke && c !== fill);
    });
  }

  /* when something is selected, the style controls edit the selection */
  function selectedStyleTarget() {
    const sel = M.selected(FP.state.doc);
    return sel.length ? sel[0] : null;
  }
  function forEachStyledTarget(fn) {
    const sel = M.selected(FP.state.doc);
    if (sel.length) { sel.forEach(fn); M.history.push(); }
    else fn(FP.state.style);
    FP.ui.refresh();
  }

  /* ================= topbar ================= */
  function bindTopbar() {
    el['btn-undo'].onclick = () => FP.cmd.undo();
    el['btn-redo'].onclick = () => FP.cmd.redo();
    el['btn-clear'].onclick = () => {
      if (!FP.state.doc.objects.length || confirm('Clear the whole artboard?')) FP.cmd.clearAll();
    };
    el['btn-export'].onclick = () => ui.exportPNG();
    el['btn-zoom-in'].onclick = () => zoomBy(1.25);
    el['btn-zoom-out'].onclick = () => zoomBy(1 / 1.25);
    el['btn-fit'].onclick = () => ui.fitView();
    el['btn-zoom-reset'].onclick = () => ui.resetView();
    el['btn-help'].onclick = () => { el['help-overlay'].hidden = false; };
    el['btn-help-close'].onclick = () => { el['help-overlay'].hidden = true; };
    el['help-overlay'].onclick = e => { if (e.target === el['help-overlay']) el['help-overlay'].hidden = true; };
  }

  function zoomBy(f) {
    const stage = el.stage.getBoundingClientRect();
    FP.viewOps.setZoom(FP.state.view.zoom * f, { x: stage.width / 2, y: stage.height / 2 });
    FP.ui.refresh();
  }

  /* ================= tools ================= */
  function bindTools() {
    el.tools.querySelectorAll('.tool').forEach(b => {
      b.onclick = () => FP.cmd.setTool(b.dataset.tool);
    });
  }

  /* ================= panel ================= */
  function bindPanel() {
    /* --- style --- */
    el['chk-fill'].onchange = () => forEachStyledTarget(t => { t.fillOn = el['chk-fill'].checked; });
    el['chk-stroke'].onchange = () => forEachStyledTarget(t => { t.strokeOn = el['chk-stroke'].checked; });
    el['in-fill'].oninput = () => forEachStyledTarget(t => { t.fill = el['in-fill'].value; });
    el['in-stroke'].oninput = () => forEachStyledTarget(t => { t.stroke = el['in-stroke'].value; });
    el['in-alpha'].oninput = () => {
      const v = el['in-alpha'].value / 100;
      el['out-alpha'].textContent = el['in-alpha'].value + '%';
      forEachStyledTarget(t => { t.alpha = v; });
    };
    el['in-weight'].oninput = () => {
      el['out-weight'].textContent = el['in-weight'].value;
      forEachStyledTarget(t => { t.weight = Number(el['in-weight'].value); t.strokeOn = true; });
    };
    el['in-radius'].oninput = () => {
      el['out-radius'].textContent = el['in-radius'].value;
      forEachStyledTarget(t => { t.radius = Number(el['in-radius'].value); });
    };
    el['in-a0'].oninput = el['in-a1'].oninput = () => {
      el['out-arc'].textContent = el['in-a0'].value + '° → ' + el['in-a1'].value + '°';
      forEachStyledTarget(t => { t.a0 = Number(el['in-a0'].value); t.a1 = Number(el['in-a1'].value); });
    };
    el['in-arcmode'].onchange = () => forEachStyledTarget(t => { t.arcMode = el['in-arcmode'].value; });

    /* --- palette --- */
    el['in-palette'].onchange = () => {
      FP.state.paletteIndex = Number(el['in-palette'].value);
      renderSwatches();
    };
    el.swatches.onclick = e => {
      const b = e.target.closest('.sw');
      if (!b) return;
      const hex = FP.PALETTES[FP.state.paletteIndex].colors[Number(b.dataset.i)];
      if (e.shiftKey) {
        forEachStyledTarget(t => { t.stroke = hex; t.strokeOn = true; });
      } else {
        forEachStyledTarget(t => { t.fill = hex; t.fillOn = true; });
      }
      FP.ui.syncControls();
      refreshPaletteUI();
    };
    el.swatches.oncontextmenu = e => {
      const b = e.target.closest('.sw');
      if (!b) return;
      e.preventDefault();
      const hex = FP.PALETTES[FP.state.paletteIndex].colors[Number(b.dataset.i)];
      forEachStyledTarget(t => { t.stroke = hex; t.strokeOn = true; });
      FP.ui.syncControls();
    };

    /* --- transform --- */
    const num = (id, apply) => {
      el[id].onchange = () => { if (!syncing) apply(Number(el[id].value) || 0); FP.ui.syncControls(); };
      el[id].oninput = () => { if (!syncing) apply(Number(el[id].value) || 0); };
    };
    num('in-x', v => { M.selected(FP.state.doc).forEach(o => { o.x = v; }); commitTransform(); });
    num('in-y', v => { M.selected(FP.state.doc).forEach(o => { o.y = v; }); commitTransform(); });
    num('in-w', v => { const sel = M.selected(FP.state.doc); sel.forEach(o => { const ar = o.w / o.h; o.w = Math.max(1, v); if (FP.state.lockAspect) o.h = o.w / ar; }); commitTransform(); });
    num('in-h', v => { const sel = M.selected(FP.state.doc); sel.forEach(o => { const ar = o.w / o.h; o.h = Math.max(1, v); if (FP.state.lockAspect) o.w = o.h * ar; }); commitTransform(); });

    el['in-rot'].oninput = () => {
      if (syncing) return;
      const sel = M.selected(FP.state.doc);
      if (!sel.length) return;
      const deg = Number(el['in-rot'].value);
      sel.forEach(o => { o.rot = U.rad(deg); });
      el['out-rot'].textContent = deg + '°';
      FP.ui.refresh();
    };
    el['in-rot'].onchange = () => commitTransform();

    el['btn-rot-ccw'].onclick = () => FP.cmd.rotateStep(-90);
    el['btn-rot-cw'].onclick = () => FP.cmd.rotateStep(90);
    el['btn-flip-h'].onclick = () => FP.cmd.flip('h');
    el['btn-flip-v'].onclick = () => FP.cmd.flip('v');
    el['btn-dup'].onclick = () => FP.cmd.duplicateSelection();
    el['btn-front'].onclick = () => FP.cmd.bringToFront();
    el['btn-back'].onclick = () => FP.cmd.sendToBack();
    el['btn-del'].onclick = () => FP.cmd.deleteSelection();
    el['btn-fit-art'].onclick = () => FP.cmd.fitToArtboard();
    el['btn-lock-aspect'].onclick = () => {
      FP.state.lockAspect = !FP.state.lockAspect;
      el['btn-lock-aspect'].textContent = 'Lock aspect: ' + (FP.state.lockAspect ? 'on' : 'off');
      el['btn-lock-aspect'].classList.toggle('primary', FP.state.lockAspect);
    };

    /* --- canvas --- */
    el['in-bg'].oninput = () => { FP.state.doc.bg = el['in-bg'].value; FP.ui.refresh(); };
    el['in-bg'].onchange = () => { M.history.push(); };
    el['in-canvas-size'].onchange = () => {
      const [w, h] = el['in-canvas-size'].value.split('x').map(Number);
      FP.cmd.setDocSize(w, h);
    };
    el['chk-grid'].onchange = () => { FP.cmd.setGrid(el['chk-grid'].checked); };
    el['chk-shadow'].onchange = () => { FP.cmd.setShadow(el['chk-shadow'].checked); };
    el['chk-snap'].onchange = () => { FP.cmd.setSnap(el['chk-snap'].checked); };
    el['chk-img-fit'].onchange = () => { FP.state.imgFit = el['chk-img-fit'].checked; };

    el.layers.onclick = e => {
      const li = e.target.closest('li');
      if (!li) return;
      const id = li.dataset.id;
      if (e.target.classList.contains('eyes')) {
        const o = M.findById(FP.state.doc, id);
        if (o) { o.visible = !o.visible; M.history.push(); FP.ui.refresh(); }
        return;
      }
      if (e.shiftKey) M.toggleSelect(FP.state.doc, id); else M.selectOnly(FP.state.doc, id);
      FP.ui.refresh();
      FP.ui.syncControls();
    };
  }

  function commitTransform() {
    if (syncing) return;
    M.history.push();
    FP.ui.refresh();
  }

  /* ================= image source ================= */
  function bindImage() {
    const openPicker = () => el['file-image'].click();
    el['btn-load-image'].onclick = openPicker;
    el['btn-load-file-2'].onclick = openPicker;
    el['file-image'].onchange = () => {
      const f = el['file-image'].files && el['file-image'].files[0];
      if (f) loadFile(f);
      el['file-image'].value = '';
    };
    el['btn-load-url'].onclick = () => loadUrl(el['in-img-url'].value.trim());
    el['in-img-url'].onkeydown = e => { if (e.key === 'Enter') loadUrl(el['in-img-url'].value.trim()); };
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('That file is not an image.'); return; }
    el['img-note'].textContent = 'Loading ' + file.name + '…';
    try {
      const dataUrl = await fileToDataUrl(file);
      loadSource(dataUrl, file.name);
    } catch (err) {
      el['img-note'].textContent = 'Could not read that file.';
    }
  }

  function loadUrl(url) {
    if (!url) { toast('Paste an image URL first.'); return; }
    const name = url.split('/').pop().split('?')[0] || 'remote image';
    el['img-note'].textContent = 'Loading ' + name + '…';
    loadSource(url, name);
  }

  function loadSource(src, name) {
    loadImage(src,
      img => {
        const key = FP.images.add(img, name, src);
        if (FP.state.imgFit) {
          FP.tools.placeLoadedImage(key, name);
          M.history.push();
          FP.ui.fitView();
        } else {
          FP.state.pendingImage = { key: key, name: name };
          FP.cmd.setTool('image');
          toast('Image ready — click or drag on the artboard to place it.');
        }
        el['img-note'].textContent = 'Loaded ' + name + ' (' + img.width + '×' + img.height + '). Use the Image tool to place another copy.';
        FP.ui.refresh();
        FP.ui.syncControls();
      },
      err => {
        el['img-note'].textContent = 'Failed to load ' + name +
          '. Remote images must send CORS headers (Access-Control-Allow-Origin) or they stay un-exportable — try downloading the file and using “From file…”.';
        toast('Image failed to load.');
      }
    );
  }

  /* drag & drop onto the canvas */
  function bindCanvasSurface() {
    const stage = el.stage;
    ['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => {
      e.preventDefault();
      stage.classList.add('dragging');
    }));
    ['dragleave', 'dragend'].forEach(t => stage.addEventListener(t, e => {
      if (e.target === stage) stage.classList.remove('dragging');
    }));
    stage.addEventListener('drop', e => {
      e.preventDefault();
      stage.classList.remove('dragging');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        loadFile(f);
        return;
      }
      const txt = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
      if (txt) loadUrl(txt);
    });
  }

  /* ================= keyboard ================= */
  function bindKeyboard() {
    window.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' && !typing) { FP.state.spaceDown = true; if (!e.repeat) FP.ui.refresh(); }
      if (e.key === 'Escape') {
        if (!el['help-overlay'].hidden) { el['help-overlay'].hidden = true; return; }
        FP.tools.cancelPending();
        M.deselect();
        FP.state.marquee = null;
        FP.state.draft = null;
        FP.state.drag = null;
        FP.ui.refresh(); FP.ui.syncControls();
        if (typing) t.blur();
        return;
      }
      if (typing) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) FP.cmd.redo(); else FP.cmd.undo();
        FP.ui.syncControls();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); FP.cmd.redo(); FP.ui.syncControls(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); FP.cmd.selectAll(); FP.ui.syncControls(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); FP.cmd.duplicateSelection(); FP.ui.syncControls(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); ui.exportPNG(); return; }

      switch (e.key) {
        case 'Delete': case 'Backspace':
          e.preventDefault(); FP.cmd.deleteSelection(); FP.ui.syncControls(); return;
        case 'Enter':
          if (FP.state.pending) { e.preventDefault(); FP.tools.finishPending(); FP.ui.syncControls(); }
          return;
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          if (!FP.state.selection.length) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
          const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
          FP.cmd.nudge(dx, dy); FP.ui.syncControls();
          return;
        }
        case '[':
          setWeight(Math.max(1, FP.state.style.weight - 1)); return;
        case ']':
          setWeight(Math.min(40, FP.state.style.weight + 1)); return;
        case ',':
          FP.cmd.sendToBack(); return;
        case '.':
          FP.cmd.bringToFront(); return;
        case '0': ui.fitView(); return;
        case 'Home': ui.resetView(); return;
        case '?': el['help-overlay'].hidden = false; return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v') FP.cmd.setTool('select');
      else if (key === 'b') FP.cmd.setTool('brush');
      else if (key === 'l') FP.cmd.setTool('line');
      else if (key === 'r') FP.cmd.setTool('rect');
      else if (key === 'u') FP.cmd.setTool('square');
      else if (key === 'e') FP.cmd.setTool('ellipse');
      else if (key === 'o') FP.cmd.setTool('circle');
      else if (key === 't') FP.cmd.setTool('triangle');
      else if (key === 'q') FP.cmd.setTool('quad');
      else if (key === 'p') FP.cmd.setTool('poly');
      else if (key === 'a') FP.cmd.setTool('arc');
      else if (key === 'c') FP.cmd.setTool('bezier');
      else if (key === 'd') FP.cmd.setTool('point');
      else if (key === 'i') FP.cmd.setTool('image');
      else if (key === 'h') FP.cmd.setTool('pan');
      FP.ui.syncControls();
    });

    window.addEventListener('keyup', e => {
      if (e.code === 'Space') { FP.state.spaceDown = false; FP.ui.refresh(); }
    });
  }

  function setWeight(w) {
    FP.state.style.weight = w;
    const sel = M.selected(FP.state.doc);
    if (sel.length) { sel.forEach(o => { o.weight = w; o.strokeOn = true; }); M.history.push(); }
    FP.ui.refresh(); FP.ui.syncControls();
  }

  function bindHelp() { /* wired in bindTopbar */ }

  /* ================= rendering hooks ================= */
  ui.refresh = function () {
    if (FP.api && FP.api.render) FP.api.render();
    renderLayers();
    updateStatus();
    refreshPaletteUI();
  };

  function renderLayers() {
    const doc = FP.state.doc;
    const list = doc.objects.slice().reverse();     // topmost first
    el['layer-count'].textContent = doc.objects.length;
    el.layers.innerHTML = list.map(o => {
      const sel = FP.state.selection.indexOf(o.id) >= 0;
      const chip = o.type === 'image'
        ? 'background:repeating-linear-gradient(45deg,#2b3245 0 3px,#4a5470 3px 6px)'
        : 'background:' + (o.fillOn ? U.rgba(o.fill, o.alpha) : 'transparent') +
          ';box-shadow:inset 0 0 0 2px ' + (o.strokeOn ? o.stroke : 'transparent');
      return '<li class="' + (sel ? 'sel' : '') + '" data-id="' + o.id + '">' +
        '<span class="thumb"><svg viewBox="0 0 24 24">' + (shapeIcon[o.type] || '') + '</svg></span>' +
        '<span class="chip" style="' + chip + '"></span>' +
        '<span class="lname">' + (o.name || FP.LABELS[o.type] || o.type) + '</span>' +
        '<button class="eyes" title="' + (o.visible ? 'Hide' : 'Show') + '">' + (o.visible ? '👁' : '🚫') + '</button>' +
        '</li>';
    }).join('');
  }

  ui.updateStatus = updateStatus;
  function updateStatus() {
    const st = FP.state;
    if (Date.now() > toastUntil) {
      const sel = M.selected(st.doc);
      let msg = (FP.TOOLS[st.tool] && FP.TOOLS[st.tool].hint) || '';
      if (st.pending) {
        msg = st.tool === 'poly'
          ? 'Click to add points · Enter or click the first point to close (' + st.pending.pts.length + ' points)'
          : 'Placing ' + FP.LABELS[st.tool] + ' — ' + st.pending.pts.length + ' point(s) so far · Esc cancels';
      } else if (sel.length === 1) {
        msg = sel[0].name + ' selected — drag to move, corner handles to scale, round handle to rotate.';
      } else if (sel.length > 1) {
        msg = sel.length + ' objects selected.';
      }
      el['status-hint'].textContent = msg;
    }
    el['status-coords'].textContent = 'x ' + Math.round(st.cursor.x) + '  y ' + Math.round(st.cursor.y);
    el['status-zoom'].textContent = 'zoom ' + Math.round(st.view.zoom * 100) + '%';
    el['zoom-readout'].textContent = Math.round(st.view.zoom * 100) + '%';
    el['btn-undo'].disabled = !M.history.canUndo();
    el['btn-redo'].disabled = !M.history.canRedo();
  }

  ui.setCursorInfo = function (world) {
    FP.state.cursor = world;
    updateStatus();
  };

  ui.updateCursor = function (world, screen) {
    const canvas = FP.api && FP.api.canvas();
    if (!canvas) return;
    const st = FP.state;
    let cursor = (FP.TOOLS[st.tool] || {}).cursor || 'default';
    if (st.tool === 'select') {
      const h = R.handleAt(screen);
      if (h) cursor = h.kind === 'rotate' ? 'grab' : (h.cursor || 'pointer');
      else cursor = M.pick(st.doc, world, FP.viewOps.tol(6)) ? 'move' : 'default';
    }
    if (st.spaceDown) cursor = 'grabbing';
    if (st.drag && st.drag.mode === 'pan') cursor = 'grabbing';
    canvas.style.cursor = cursor;
  };

  /* ================= view ================= */
  ui.fitView = function () {
    const r = el.stage.getBoundingClientRect();
    FP.viewOps.fit(r.width, r.height, FP.state.doc);
    FP.ui.refresh();
  };
  ui.resetView = function () {
    const r = el.stage.getBoundingClientRect();
    FP.viewOps.fit(r.width, r.height, FP.state.doc);
    FP.state.view.zoom = 1;
    FP.state.view.ox = (r.width - FP.state.doc.w) / 2;
    FP.state.view.oy = (r.height - FP.state.doc.h) / 2;
    FP.ui.refresh();
  };

  /* ================= control sync ================= */
  const show = (elem, on) => { if (elem) elem.hidden = !on; };
  ui.syncControls = function () {
    syncing = true;
    const st = FP.state;
    const sel = M.selected(st.doc);
    const target = sel.length ? sel[0] : null;
    const tool = FP.TOOLS[st.tool] || {};

    el['props-title'].textContent = sel.length ? (sel.length === 1 ? sel[0].name : sel.length + ' objects') : 'Tool defaults';
    el['sel-hint'].textContent = sel.length ? (sel.length === 1 ? sel[0].name : sel.length + ' selected') : 'nothing selected';

    const fillOn = target ? target.fillOn : st.style.fillOn;
    const fill = target ? target.fill : st.style.fill;
    const alpha = target ? (target.alpha !== undefined ? target.alpha : 1) : st.style.alpha;
    const strokeOn = target ? target.strokeOn : st.style.strokeOn;
    const stroke = target ? target.stroke : st.style.stroke;
    const weight = target ? target.weight : st.style.weight;
    const radius = target ? (target.radius || 0) : st.style.radius;

    el['chk-fill'].checked = fillOn;
    el['in-fill'].value = fill;
    el['in-alpha'].value = Math.round(alpha * 100);
    el['out-alpha'].textContent = Math.round(alpha * 100) + '%';
    el['chk-stroke'].checked = strokeOn;
    el['in-stroke'].value = stroke;
    el['in-weight'].value = weight;
    el['out-weight'].textContent = weight;

    const needRadius = target ? (target.type === 'rect' || target.type === 'square' || target.type === 'image') : (st.tool === 'rect' || st.tool === 'square');
    show(el['row-radius'], !!needRadius);
    el['in-radius'].value = radius;
    el['out-radius'].textContent = Math.round(radius);

    const needArc = target ? target.type === 'arc' : st.tool === 'arc';
    show(el['row-arc'], !!needArc);
    el['in-a0'].value = target && target.type === 'arc' ? target.a0 : st.style.a0;
    el['in-a1'].value = target && target.type === 'arc' ? target.a1 : st.style.a1;
    el['out-arc'].textContent = el['in-a0'].value + '° → ' + el['in-a1'].value + '°';
    el['in-arcmode'].value = target && target.type === 'arc' ? target.arcMode : st.style.arcMode;

    // transform fields
    if (target) {
      el['in-x'].value = Math.round(target.x);
      el['in-y'].value = Math.round(target.y);
      el['in-w'].value = Math.round(target.w);
      el['in-h'].value = Math.round(target.h);
      el['in-rot'].value = Math.round(U.deg(target.rot));
      el['out-rot'].textContent = Math.round(U.deg(target.rot)) + '°';
    } else {
      el['in-x'].value = ''; el['in-y'].value = ''; el['in-w'].value = ''; el['in-h'].value = '';
      el['in-rot'].value = 0; el['out-rot'].textContent = '0°';
    }
    const hasSel = sel.length > 0;
    ['in-x', 'in-y', 'in-w', 'in-h', 'in-rot', 'btn-rot-ccw', 'btn-rot-cw', 'btn-flip-h', 'btn-flip-v',
      'btn-dup', 'btn-front', 'btn-back', 'btn-del', 'btn-fit-art'].forEach(id => { el[id].disabled = !hasSel; });
    el['card-transform'].classList.toggle('dim', !hasSel);

    el['in-bg'].value = st.doc.bg;
    el['in-canvas-size'].value = st.doc.w + 'x' + st.doc.h;
    if (!el['in-canvas-size'].value) el['in-canvas-size'].selectedIndex = -1;
    el['chk-grid'].checked = st.grid;
    el['chk-shadow'].checked = st.shadow;
    el['chk-snap'].checked = st.snap;
    el['chk-img-fit'].checked = st.imgFit;
    el['btn-lock-aspect'].textContent = 'Lock aspect: ' + (st.lockAspect ? 'on' : 'off');
    el['btn-lock-aspect'].classList.toggle('primary', st.lockAspect);

    el.tools.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === st.tool));

    syncing = false;
  };

  /* ================= export ================= */
  ui.exportPNG = function () {
    const doc = FP.state.doc;
    if (!FP.api) return;
    const g = createGraphics(doc.w, doc.h);
    g.pixelDensity(1);
    g.noSmooth();
    g.background(doc.bg);
    R.drawObjects(g, doc);
    const canvas = g.canvas;
    const name = 'flat-paint-' + stamp() + '.png';
    const finish = () => {
      canvas.toBlob(blob => {
        if (blob) U.download(blob, name);
        else toast('Export blocked — one of the images on the canvas is not CORS-safe. Re-load it from a local file.');
        g.remove();
      }, 'image/png');
    };
    if (!M.history.canUndo() && !FP.state.doc.objects.length) { /* still export the empty page */ }
    finish();
  };

  ui.exportSVG = function () {
    const svg = M.toSVG(FP.state.doc);
    U.download(new Blob([svg], { type: 'image/svg+xml' }), 'flat-paint-' + stamp() + '.svg');
  };

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ================= boot ================= */
  ui.boot = function () {
    FP.cmd.setTool('select');
    FP.ui.fitView();
    FP.ui.refresh();
    FP.ui.syncControls();
    el['status-hint'].textContent = 'Ready. Drop an image onto the canvas, or pick a shape tool and draw.';
  };
})(window.FP);