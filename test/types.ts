// Compiled, never run (npm run types): uses the API as a video would, so a
// wrong declaration fails to type-check.
import { composition, sequence, series, interpolate, spring, easeOut, bezier, html, signal, type View } from 'cuadro';
import { render } from 'cuadro/render';

const dot: View = (frame) => html`<b>${() => interpolate(frame(), [0, 10], [0, 1], { easing: easeOut, extrapolate: { left: 'clamp', right: 'extend' } })}</b>`;
const c = composition({
  width: 640, height: 360, fps: 30, durationInFrames: 90,
  props: { title: 'hi' },
  view: (frame, props) => html`<h1>${props.title}</h1>${sequence(10, 20, dot)(frame)}${series([5, dot], [Infinity, dot])(frame)}`,
});
const n: number = spring({ frame: 3, fps: c.fps, config: { damping: 12 }, to: 2 }) + bezier(0, 0, 1, 1)(0.5);
const [, set] = signal(n);
set((x) => x + 1);
void c.setFrame(0);
void render({ page: 'demo/index.html', out: 'out.mp4', props: { title: 'x' }, onProgress: (done: number, total: number) => {} });
