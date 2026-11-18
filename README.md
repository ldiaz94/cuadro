![cuadro](doc/img/banner.svg)

# cuadro

cuadro makes videos in code. A video is a web page drawn with
[spark](https://github.com/ldiaz94/spark), and what it shows depends on
one thing only: a `frame` signal. To render, cuadro opens the page in
headless Chromium, sets the frame, takes a screenshot, and pipes each
picture to ffmpeg, which writes an mp4. Animation helpers (`interpolate`,
`spring`, easings) and a timeline (`sequence`, `series`) are pure
functions of the frame, so the same props always give the same video. The
same page is also its own preview, with a scrubber and play button. It is
like Remotion, but on spark instead of React, written from scratch.

*Cuadro* is Spanish for "frame", and also for "picture". The mascot is a
picture frame with a face, film sprocket holes along its bottom edge, and
a spark in its corner.

> **Status: experimental (0.1).** The API may change. cuadro is not on
> npm, and nobody outside the project has reviewed it yet.

## See it

![The demo video, as a GIF](doc/img/demo.gif)

This is [`demo/video.js`](demo/video.js), rendered with `npm run demo`
and turned into a GIF by `npm run gif`. The music is made from sine waves
by [`demo/music.js`](demo/music.js), so it is free to use.

## Get it

You need Node 20 or newer, ffmpeg with libx264 on the `PATH`, and
Chromium. cuadro uses `$CHROMIUM` if it is set, then Playwright's own
browser (`npx playwright install chromium`), then `chromium` on the
`PATH`.

```sh
npm install github:ldiaz94/cuadro#v0.1.0
npx cuadro render video.html out.mp4
```

## Learn it

A video is an HTML page. An import map tells the browser where to find
`cuadro` and `spark`. The page then calls `composition`:

```html
<script type="importmap">{ "imports": {
  "cuadro": "/node_modules/cuadro/src/index.js",
  "spark": "/node_modules/spark/src/index.js" } }</script>
<script type="module">
  import { composition, sequence, interpolate, spring, html } from 'cuadro';

  const title = (frame) => html`<h1 style=${() => ({
    transform: `scale(${spring({ frame: frame(), fps: 30 })})` })}>Hola</h1>`;

  composition({
    width: 1280, height: 720, fps: 30, durationInFrames: 150,
    props: { color: 'navy' },
    view: (frame, props) => html`
      <main style=${() => ({ background: props.color, height: '100%',
                             opacity: interpolate(frame(), [120, 150], [1, 0]) })}>
        ${sequence(15, 135, title)(frame)}
      </main>`,
  });
</script>
```

A **view** is a function from a frame getter to anything spark can put in
a hole: `(frame) => html`...``. You pass `frame` down yourself, because
spark has no context. `sequence` and `series` take views and return
views, so they nest. Inside a sequence, the frame counts from 0.

To preview, serve the project folder with any static server (`npx serve
.` or `python3 -m http.server`) and open the page. To render it, run:

```sh
npx cuadro render video.html out.mp4 --props '{"color":"teal"}' --audio song.mp3
```

| API | |
|---|---|
| `composition({ width, height, fps, durationInFrames, view, props })` | Mounts `view(frame, props)` on a stage of that size. The defaults in `props` are merged with `?props=<json>` from the URL. Sets `window.cuadro`, and adds the preview bar unless the URL has `?render`. |
| `sequence(from, duration, view)` | A view that mounts `view(local)` while `from <= frame < from + duration`, with `local = frame - from`. Outside that range it unmounts, and the view's effects are disposed. |
| `series([duration, view], ...)` | Sequences played back to back. Use `Infinity` for a last clip that stays. |
| `interpolate(x, inRange, outRange, { easing, extrapolate })` | Piecewise mapping over two or more increasing stops. `extrapolate` is `'clamp'` (the default) or `'extend'`, or `{ left, right }` to set each side. |
| `spring({ frame, fps, config, from, to })` | A damped spring, computed in closed form. `config` is `{ mass: 1, stiffness: 100, damping: 10 }` by default. It goes from `from` (0) to `to` (1). |
| `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut`, `bezier(x1, y1, x2, y2)` | CSS's easing curves. |
| `window.cuadro.setFrame(n)` | Shows frame `n`. Resolves once fonts are loaded and every `<img>` is decoded, and rejects if an image fails. |
| `render({ page, out, props, audio, root, onProgress })` | From `cuadro/render`, the Node API that the CLI calls. Use it in jobs. |
| spark's API | Re-exported, so a video needs only one import. |

| `cuadro render <page> <out.mp4>` | |
|---|---|
| `--props json` | Props merged over the composition's defaults. |
| `--audio file` | A soundtrack, cut or padded with silence to the video's length. |
| `--root dir` | The directory served to the browser (default `.`). The page must be inside it. |

Progress goes to stderr: one line that updates in a terminal, or about
ten lines when the output goes to a log.

**Rules for a deterministic video**: draw only from `frame` and `props`.
Don't use `Date.now`, `Math.random` without a seed,
`requestAnimationFrame`, CSS animations or transitions. Load everything
the video needs before calling `composition`, except fonts and `<img>`,
which cuadro waits for.

## How it works

Five ideas, a module each:

1. **Time is a signal** ([`src/composition.js`](src/composition.js)). The
   composition owns `frame`, and everything drawn is computed from it.
   spark updates the DOM synchronously on each write, so after
   `setFrame(n)` the page is already showing frame n. The only thing left
   to wait for is fonts and images.
2. **Animation is arithmetic** ([`src/animate.js`](src/animate.js)).
   `interpolate` and the easings are plain maths on the frame number.
   `spring` uses the closed-form solution of a damped oscillator instead
   of stepping through time, so frame 200 never depends on having drawn
   frame 199. Scrubbing and rendering out of order give the same picture.
3. **Time ranges are holes** ([`src/timeline.js`](src/timeline.js)). A
   sequence is a spark function hole that reads a computed "is the frame
   in range?" flag. The hole reruns only when that flag flips. So the
   view mounts once when its range begins, updates through its own
   effects while it plays, and is disposed when the range ends.
4. **The page is the preview** ([`src/preview.js`](src/preview.js)).
   Without `?render`, the composition scales its stage to fit the window
   and adds a bar with play/pause, a scrubber and the frame number. Play
   moves the frame by the wall clock. That is fine for watching, and it
   is never used when rendering.
5. **Rendering is a loop** ([`src/render.js`](src/render.js), with
   [`src/serve.js`](src/serve.js) and [`src/chromium.js`](src/chromium.js)).
   cuadro serves the root directory on a loopback port, opens the page at
   the composition's size, and loops over the frames: `setFrame(n)`, take
   a PNG screenshot, write it to ffmpeg's stdin. Writes wait when the
   pipe is full, and a page error or a failed image stops the render
   instead of hanging it. [`bin/cuadro.js`](bin/cuadro.js) parses the
   command line and shows progress.

## Tests

`npm test` runs `node --test`. The animation tests run in Node. The
others run in Chromium and ffmpeg against
[`test/fixture.html`](test/fixture.html), a 12-frame video.

- `interpolate`: values at, between and beyond the stops; clamp and
  extend on each side; easing applied per segment; bad ranges rejected.
  `spring`: starts at `from` and settles at `to`; overshoots only when
  underdamped; agrees with itself across the three damping regimes.
  `bezier`: matches CSS.
- `sequence` and `series`: mount and unmount at the exact boundaries;
  give the right local frame, also when nested; mount once per entry and
  dispose the view's effects on exit.
- composition: `setFrame` waits for an image that loads slowly; the
  preview's keys, scrubber and play button work.
- render: every frame comes out at the right size; the same props give
  identical frame checksums twice, and other props give different ones;
  audio is padded to the video's length; a page error or a broken image
  fails the render.

`npm run types` type-checks the declarations against
[`test/types.ts`](test/types.ts).

## Size

Lines of code, not counting comments or blank lines:

| module | lines |
|---|---|
| `src/animate.js` | 61 |
| `src/timeline.js` | 20 |
| `src/composition.js` | 32 |
| `src/preview.js` | 45 |
| `src/render.js` | 60 |
| `src/serve.js` | 32 |
| `src/chromium.js` | 19 |
| `src/index.js` | 4 |
| `bin/cuadro.js` | 52 |
| **total** | **325** |

The only dependencies are spark and playwright-core, plus ffmpeg from
the system.

## Left out

- Parallel or distributed rendering, and Lambda or cloud rendering.
  Frames are shot one at a time: on a laptop at 720p, about 25 a second
  for a simple page and 7 for the demo, which redraws a full-screen
  gradient on every frame.
- Frame-exact embedded video clips, captions, and transparent video.
- An embeddable React player. The preview is the page itself.
- Waiting on anything except fonts and `<img>`: there is no "delay
  render" hook. CSS background images and fetched data must be ready
  before `composition` is called.
- Audio in the preview, and audio mixing. A render takes one soundtrack.

## Licence

ISC: see [LICENSE](LICENSE).
