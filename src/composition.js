// cuadro composition: the page that renders frame N when asked.
// It owns the frame signal, mounts the view on a stage of the video's size,
// and exposes window.cuadro for the renderer: the video's size, rate and
// length, the audio clips mounted so far, and setFrame(n), which resolves
// once fonts and images are ready.
// Props are the defaults given here, merged with ?props=<json> from the URL.
// Without ?render in the URL the page also shows the preview bar.
// Depends on spark and preview.js. Leaves out waiting on anything but
// fonts and <img> (CSS background images, fetches, video), and more than
// one composition per page.
import { signal, mount } from 'spark';
import { preview } from './preview.js';

/** The page's composition, for views that need more than their local frame. */
let current = null;

/** Returns the page's composition: its root frame getter, fps and clips. */
export function currentComposition() {
  if (!current) throw new Error('cuadro: no composition on this page yet');
  return current;
}

/** Mounts view(frame, props) and makes the page renderable; returns window.cuadro. */
export function composition({ width, height, fps, durationInFrames, view, props = {} }) {
  for (const [name, v] of Object.entries({ width, height, fps, durationInFrames })) {
    if (!(Number.isInteger(v) && v > 0)) throw new Error(`composition: ${name} must be a positive integer`);
  }
  const params = new URLSearchParams(location.search);
  const allProps = { ...props, ...JSON.parse(params.get('props') ?? '{}') };
  const [frame, set] = signal(0);

  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'relative', overflow: 'hidden', width: `${width}px`, height: `${height}px` });
  document.body.style.margin = '0';
  document.body.append(stage);
  const setFrame = async (n) => {
    if (!(Number.isInteger(n) && n >= 0 && n < durationInFrames)) throw new Error(`setFrame: ${n} is not a frame in [0, ${durationInFrames})`);
    set(n); // spark flushes synchronously, so the DOM is already updated
    await ready();
  };
  const clips = [];
  window.cuadro = { width, height, fps, durationInFrames, clips, setFrame };
  current = { frame, fps, clips };
  mount(stage, () => view(frame, allProps));
  if (!params.has('render')) preview(stage, frame, setFrame, window.cuadro);
  return window.cuadro;
}

/** Resolves when fonts are loaded and every image is decoded; a broken image rejects. */
async function ready() {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images, (img) =>
      img.decode().catch(() => { throw new Error(`cuadro: image failed to load: ${img.src}`); })),
  );
}
