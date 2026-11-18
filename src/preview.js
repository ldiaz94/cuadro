// cuadro preview: a bar under the stage to scrub and play a composition in
// the browser. The stage is scaled to fit the window. Play advances the
// frame by the wall clock; that only drives the preview, never a render.
// Keys: space plays or pauses, left and right step a frame (with shift, a
// second). Audio clips play along through the playing getter it returns
// (see audio.js).
// Depends on spark. Leaves out loops and playback speed.
import { signal, effect, untrack, html, mount } from 'spark';

/** Height of the bar, in CSS pixels. */
const BarHeight = 48;

/** Wraps stage in a scaled frame and adds the bar under it; returns a getter for whether it plays. */
export function preview(stage, frame, setFrame, { width, height, fps, durationInFrames }) {
  const last = durationInFrames - 1;
  const [playing, setPlaying] = signal(false);
  const [scale, setScale] = signal(1);
  const fit = () => setScale(Math.min(1, innerWidth / width, (innerHeight - BarHeight) / height));
  addEventListener('resize', fit);
  fit();

  const seek = (n) => { setPlaying(false); setFrame(Math.max(0, Math.min(last, n))); };
  effect(() => {
    if (!playing()) return;
    const start = untrack(frame) >= last ? 0 : untrack(frame); // play from the end restarts
    const t0 = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      const n = start + Math.floor(((now - t0) * fps) / 1000);
      setFrame(Math.min(n, last));
      if (n >= last) setPlaying(false);
      else id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  });
  addEventListener('keydown', (e) => {
    const step = e.shiftKey ? fps : 1;
    if (e.key === ' ') setPlaying((p) => !p);
    else if (e.key === 'ArrowLeft') seek(frame() - step);
    else if (e.key === 'ArrowRight') seek(frame() + step);
    else return;
    e.preventDefault();
  });

  document.body.style.background = '#222';
  const box = html`<div style=${() => ({ width: `${width * scale()}px`, height: `${height * scale()}px`, margin: '0 auto' })}></div>`;
  stage.style.transformOrigin = '0 0';
  effect(() => { stage.style.transform = `scale(${scale()})`; });
  stage.replaceWith(box);
  box.append(stage);
  mount(document.body, () => html`
    <div style=${{ display: 'flex', gap: '12px', alignItems: 'center', height: `${BarHeight}px`, padding: '0 12px', font: '14px system-ui', color: '#ddd' }}>
      <button style="width:5em" @click=${() => setPlaying((p) => !p)}>${() => (playing() ? 'pause' : 'play')}</button>
      <input type="range" min="0" max=${last} style="flex:1" .value=${frame} @input=${(e) => seek(Number(e.target.value))}>
      <span style="font-variant-numeric:tabular-nums">${() => `${frame()} / ${last} · ${(frame() / fps).toFixed(2)}s`}</span>
    </div>`);
  return playing;
}
