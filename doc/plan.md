# cuadro: plan for v0.1

Videos in code on spark. A video is a web page whose drawing is a pure
function of one `frame` signal; the renderer sets the frame, screenshots,
and pipes the PNGs to ffmpeg.

## API sketch

```js
// video.js, loaded by video.html (an import map maps 'cuadro' and 'spark')
import { composition, sequence, series, interpolate, spring, html } from 'cuadro';

composition({
  width: 1920, height: 1080, fps: 30, durationInFrames: 300,
  props: { title: 'Hola' },                  // defaults; --props merges over them
  view: (frame, props) => html`
    <main>
      ${sequence(0, 90, (f) => html`<h1 style=${() => ({
          transform: `scale(${spring({ frame: f(), fps: 30 })})` })}>${props.title}</h1>`)(frame)}
      ${series([60, Intro], [120, Body], [Infinity, Outro])(frame)}
    </main>`,
});
```

- **A view is `(frame: Getter<number>) => Child`.** spark has no context,
  so time is passed in, not looked up. `sequence` and `series` take views
  and return views, so they nest. The root view also gets `props`.
- `sequence(from, duration, view)`: mounts `view(local)` while
  `from <= frame < from + duration`, with `local = frame - from`; unmounts
  (disposing its effects) outside. Built on spark's function child hole
  over a `computed` boolean, so it remounts only on entry, not every frame.
- `series(...[duration, view])`: back-to-back sequences.
- `interpolate(x, inRange, outRange, { easing, extrapolate })`: piecewise
  linear over ≥2 increasing stops; `extrapolate: 'clamp' | 'extend'`
  (default `'clamp'`, one value or `{ left, right }`).
- `spring({ frame, fps, config: { mass=1, stiffness=100, damping=10 }, from=0, to=1 })`:
  closed-form damped oscillator (no stepping, so frame N never depends on
  having computed N-1).
- Easings: `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut` (CSS's
  curves) and `bezier(x1, y1, x2, y2)` that makes them.
- `composition(...)` mounts the view on `document.body` at the given size
  and exposes `window.cuadro = { width, height, fps, durationInFrames,
  setFrame(n): Promise }`. `setFrame` sets the signal (spark flushes
  synchronously), then awaits `document.fonts.ready` and every `<img>`'s
  `decode()`. Props come from `?props=<json>`. Without `?render`, it also
  shows the preview bar.
- Preview bar (`src/preview.js`): scrubber, play/pause, frame number,
  space and arrow keys. Play advances the frame by wall clock (preview
  only; never what is drawn when rendering). The stage scales to fit the
  window. Any static server works (`npx serve`, `python3 -m http.server`).
- Node: `render({ page, out, props, audio, onProgress })` from
  `cuadro/render`, and the CLI
  `cuadro render <page> out.mp4 [--props json] [--audio file] [--root dir]`.
  It serves `--root` (default cwd) on a loopback port with a ~25-line
  `node:http` static server, opens `<page>?render&props=…` in Chromium at
  the composition's size, and for each frame: `setFrame(n)`, PNG
  screenshot, write to `ffmpeg -f image2pipe … -c:v libx264 -pix_fmt
  yuv420p [-i audio -c:a aac -shortest]`. Progress (`frame 120/300, 38
  fps, eta 5s`) on stderr. Exits non-zero on page errors or ffmpeg failure.
  Chromium: `$CHROMIUM`, else Playwright's own (`npx playwright install
  chromium`), so it runs as a job at Tangent too.

## Modules

| file | what | deps |
|---|---|---|
| `src/animate.js` | interpolate, spring, easings | none (pure) |
| `src/timeline.js` | sequence, series | spark |
| `src/composition.js` | composition, frame signal, `window.cuadro` | spark, preview |
| `src/preview.js` | scrubber/play bar | spark |
| `src/index.js` | browser exports (+ re-exports spark) | |
| `src/render.js` | static server, Chromium, ffmpeg | playwright-core, ffmpeg |
| `bin/cuadro.js` | CLI arg parsing over render | render |
| `src/index.d.ts`, `src/render.d.ts` | types | |

Estimate ~450 lines of JS. Deps: `spark` (`github:ldiaz94/spark#v0.1.1`),
`playwright-core` (exact pin). Node ≥ 20, ffmpeg with libx264 on PATH.

## Tests (the ones that catch real bugs)

- `animate.test.js` (node): interpolate at/between/beyond stops, clamp vs
  extend per side, multi-segment, easing applied per segment, bad ranges
  throw; spring starts at `from`, settles to `to` within tolerance,
  underdamped overshoots, critically/overdamped doesn't; bezier endpoints
  and CSS `ease` midpoint.
- `timeline.test.js` (Chromium): sequence mounts at `from`, unmounts at
  `from+duration`, local frame is right, inner effects are disposed on
  unmount, it does not remount between frames inside its range; series
  hands over at exact boundaries.
- `render.test.js` (Chromium + ffmpeg): a 12-frame fixture renders to an
  mp4 with 12 frames at the right size (ffprobe); rendering twice with the
  same props gives identical per-frame hashes; different props differ;
  waits for an image to load before the shot.

## Order of work (one commit each)

1. Scaffold: package.json, LICENSE, .gitignore, stub README.
2. `animate.js` + tests + types.
3. `timeline.js` + Chromium test harness + tests.
4. `composition.js` (no preview yet).
5. `render.js` + `bin/cuadro.js` + render tests.
6. `preview.js`.
7. Demo: 10 s title card (logo image, springing text) with music
   synthesised by ffmpeg at build time (self-made, nothing to license);
   `npm run demo`, `npm run gif` → `doc/img/demo.gif`.
8. README, logo, banner.

## Open choices (my defaults)

- Views get `frame` as an argument rather than a global `currentFrame()`;
  explicit, nests, no hidden stack. Cost: you pass `frame` down.
- No `delayRender`-style hook in 0.1: fonts and `<img>` are awaited;
  anything else must be ready before `composition()` is called.
- No `cuadro preview` server command: the preview is a static page.
