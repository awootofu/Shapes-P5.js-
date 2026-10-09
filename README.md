# Flat Paint Studio

A small drawing application built with **p5.js** — a flat-colour "paint" program in the browser.

Midterm project for **Computer Graphics**.

## Requirements covered

| # | Requirement | Where it lives |
|---|---|---|
| 1 | **Load image from source** | File picker, remote URL, and drag & drop. Every image load goes through p5's `loadImage()`. See `js/ui.js` → *Image source* → `loadSource()`. |
| 2 | **All shape primitives** (p5.js reference) | 11 primitives: `point`, `line`, `triangle`, `quad`, `rect`, `square`, `ellipse`, `circle`, `arc`, `bezier`, `poly` (custom `beginShape()` vertices) + freehand `brush` and placed `image` objects. |
| 2a | **Flat colour geometry** | Solid fills only, no gradients or textures. Six curated flat palettes, plus native colour pickers, opacity and stroke weight. |
| 3 | **Transformation of objects on the canvas** | On-canvas **move / scale / rotate** handles *and* a numeric Transform panel (X, Y, W, H, rotation slider, ±90° steps, flip H/V, layer order, fit-to-artboard). |
| 4 | **Deploy to `*.github.io`** | GitHub Pages via Actions: `.github/workflows/deploy.yml`. |

## Running it

No build step, no bundler, no dependencies to install for the app itself.

```bash
# from this folder
python -m http.server 8080
# then open http://localhost:8080
```

Open it with a local server rather than `file://` — `loadImage()` from a remote URL
needs a real HTTP origin, and some browsers block canvas export from `file://`.

## Using it

**Tools** — `V` select · `B` brush · `L` line · `R` rectangle · `U` square ·
`E` ellipse · `O` circle · `T` triangle · `Q` quad · `P` polygon · `A` arc ·
`C` bezier · `D` point · `I` image · `H` pan

**Editing** — drag to draw · click point-by-point for line/triangle/quad/polygon/bezier
(`Enter` closes a polygon) · `Shift` constrains · `Alt` drags out from the centre,
and `Alt`-dragging an object duplicates it · `Del` deletes · `Ctrl+Z` / `Ctrl+Shift+Z`
undo/redo · arrows nudge 1 px (`Shift` = 10 px) · `[` `]` stroke weight · `,` `.`
layer order · `Ctrl+S` export PNG · wheel zooms, `Space`-drag pans · `0` fit, `Home` reset.

**Transforming a shape that is already on the canvas** — pick the **Select** tool (`V`),
click the object, then drag its body to move, a corner handle to scale, the round handle
above it to rotate. Exactly what you asked for in the brief: transform *existing* objects,
not just newly drawn ones.

## Project layout

```
index.html              markup + panels
css/style.css           the whole UI skin
js/config.js            palettes, tool table, shared state, math helpers
js/model.js             document model: objects, hit testing, transforms, history, SVG export
js/render.js            all drawing (live canvas + export buffer share the same code)
js/tools.js             pointer state machine + document commands
js/ui.js                panels, layers, keyboard, image loading, export
js/sketch.js            the p5 sketch: setup/draw, canvas sizing, world<->screen mapping
tests/smoke.mjs         headless verification (47 checks) — see below
.github/workflows/deploy.yml   GitHub Pages deployment
```

Design notes:

- **One object model, two renderers.** `js/model.js` owns the geometry; `js/render.js`
  draws it into either the live p5 canvas or a `createGraphics()` buffer for export —
  so what you export is exactly what you see.
- **Undo is snapshot-based.** Each commit serialises the document to JSON on a stack
  (60 deep). Loaded bitmaps are keyed in `FP.images` so snapshots stay small.
- **Transforms are exact under rotation.** Scaling works in the object's own rotated
  frame, so the anchored corner stays pinned and the rotation is untouched while you drag.
- **History does not fight the UI.** Snapshots capture `doc` + style + view only, never
  the transient selection/drag state.

## Tests

47 headless checks drive the real app in Chrome (via CDP) and assert on the real
document model and real canvas pixels — every primitive, colour, transform, image path
and the export buffer.

```bash
cd tests
npm install          # only puppeteer-core; it drives your installed Chrome/Edge
node smoke.mjs
```

Expected: `47/47 checks passed — all green`.

The app exposes a small test surface on `window.FP` (`FP.api.reset()`, `FP.api.dump()`,
`FP.api.toWorld/toScreen`, `FP.cmd.*`, `FP.tools.*`) which is what the suite drives.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` publishes the repo root as a static site.

1. Push this folder to a GitHub repository (any name — `p5-flat-paint` suggested).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`; the **Deploy to GitHub Pages** workflow publishes it.
4. Your app is live at `https://<username>.github.io/<repo>/`.

No secrets, no build output — GitHub Pages serves the static files straight from the repo.