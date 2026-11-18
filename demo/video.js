// cuadro's demo: a ten-second title card. The mascot springs in, the name
// follows letter by letter, then three lines play one after another and
// everything fades out. Render it with `npm run demo`; preview it by
// serving the repo root and opening /demo/.
import { composition, sequence, series, interpolate, spring, easeOut, easeInOut, html } from 'cuadro';

const fps = 30;

/** The mascot, springing up from nothing with a little overshoot. */
const logo = (frame) => html`<img src="/doc/img/logo.svg" width="260" height="260" style=${() => ({
  transform: `scale(${spring({ frame: frame(), fps, config: { damping: 12 } })}) rotate(${interpolate(frame(), [0, 25], [-12, 0], { easing: easeOut })}deg)`,
})}>`;

/** The name, each letter springing up a few frames after the one before. */
const title = (text) => (frame) => [...text].map((ch, i) => html`<span style=${() => {
  const s = spring({ frame: frame() - 3 * i, fps, config: { damping: 14 } });
  return { opacity: Math.min(1, s), transform: `translateY(${interpolate(s, [0, 1], [80, 0], { extrapolate: 'extend' })}px)` };
}}>${ch}</span>`);

/** A line that slides in and out over its clip of `length` frames. */
const line = (text, length) => (frame) => html`<p class="line" style=${() => ({
  opacity: interpolate(frame(), [0, 10, length - 10, length], [0, 1, 1, 0]),
  transform: `translateX(${interpolate(frame(), [0, 12], [-40, 0], { easing: easeOut })}px)`,
})}>${text}</p>`;

composition({
  width: 1280, height: 720, fps, durationInFrames: 10 * fps,
  props: { name: 'cuadro' },
  view: (frame, props) => html`
    <style>
      .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
              color: #f6ecd2; font-family: Georgia, 'Times New Roman', serif; }
      h1 { font-size: 150px; font-weight: normal; margin: 10px 0 0; height: 180px; letter-spacing: 2px; }
      h1 span { display: inline-block; }
      .line { position: absolute; bottom: 70px; margin: 0; font: 36px system-ui, sans-serif; color: #e0a526; }
    </style>
    <div class="card" style=${() => ({
      background: `radial-gradient(circle at 50% ${interpolate(frame(), [0, 300], [30, 70])}%, #2d3866, #11152a 70%)`,
      opacity: interpolate(frame(), [270, 300], [1, 0], { easing: easeInOut }),
    })}>
      ${logo(frame)}
      <h1>${sequence(20, Infinity, title(props.name))(frame)}</h1>
      ${sequence(110, 160, series(
        [55, line('a frame signal drives the page', 55)],
        [55, line('spark redraws only what changed', 55)],
        [50, line('Chromium shoots it, ffmpeg encodes it', 50)],
      ))(frame)}
    </div>`,
});
