// cuadro scenes: designed views for an explainer video, styled by a theme.
// Each scene is scene(props) => view, where a view is (frame) => content,
// so scenes and hand-written views mix freely. Each takes its `length` in
// frames and spreads its beats across it, so nothing stands still while
// a voice talks:
//
//   title    kicker, headline word by word, a mark swept under *words*, sub
//   kinetic  short lines, one per beat, each replacing the last
//   stat     1-3 numbers, each counting up in its beat, then dimmed
//   steps    a list with a highlight moving down it, the current step large
//   tiles    a grid with a highlight moving through it
//   endCard  logo, a line, a call to action and a URL
//
//   0     Fade                                   length-Fade   length
//   |fade in|-- beat 1 --|-- beat 2 --|-- beat 3 --|fade out|
//   beats tile [0, length - Fade); the fades overlap the first and last,
//   and the scenes before and after when played with play().
//
// stage(theme(...), view) draws the themed frame with a slowly drifting
// glow behind the view; play(...) plays scenes in order, each one
// cross-fading into the next. Sizes come from theme.js's custom
// properties in container units, so the scenes fill any frame size, and
// a portrait frame stacks what sits side by side in landscape.
// Depends on spark, animate.js, timeline.js and composition.js (for fps).
// Leaves out transitions other than cross-fades, icons and images other
// than the end card's logo, and props that no video has needed yet.
import { html } from 'spark';
import { interpolate, spring, easeInOut } from './animate.js';
import { sequence } from './timeline.js';
import { currentComposition } from './composition.js';

/** Frames a scene takes to fade in, and to fade out; play() overlaps scenes by this much. */
export const Fade = 12;

/** The shortest beat, in frames: enough for something to arrive and be seen. */
const MinBeat = 15;

/** Splits [0, length - Fade) into n back-to-back beats, as { from, to } frames. */
export function beats(length, n) {
  if (!(Number.isInteger(n) && n >= 1)) throw new Error(`scenes: ${n} is not a number of beats`);
  const span = length - Fade;
  if (!(Number.isInteger(length) && span >= n * MinBeat)) {
    throw new Error(`scenes: ${n} beats need a length of at least ${n * MinBeat + Fade} frames, not ${length}`);
  }
  const edge = (i) => Math.round((i * span) / n);
  return Array.from({ length: n }, (_, i) => ({ from: edge(i), to: edge(i + 1) }));
}

/** Plays [length, view] clips in order, each overlapping the next by Fade frames (a cross-fade). */
export function play(...clips) {
  return (frame) => {
    let from = 0;
    return clips.map(([length, view]) => {
      const clip = sequence(from, length, view)(frame);
      from += length - Fade;
      return clip;
    });
  };
}

/** How long play(...clips) lasts, for the composition's durationInFrames. */
export function playLength(...clips) {
  return clips.reduce((sum, [length]) => sum + length, 0) - Fade * (clips.length - 1);
}

/** The themed frame: background, drifting glow, then the view on top. */
export function stage(theme, view) {
  return (frame) => {
    addStyles();
    const fps = currentComposition().fps;
    /** A glow wandering slowly around (x, y), in percent of the frame. */
    const glow = (colour, x, y, speed) => html`<i style=${() => {
      const s = frame() / fps;
      return {
        background: `radial-gradient(closest-side, color-mix(in srgb, var(${colour}) 30%, transparent), transparent)`,
        transform: `translate(${x + 14 * Math.sin(s * speed)}cqw, ${y + 16 * Math.cos(s * speed * 0.8)}cqh)`,
      };
    }}></i>`;
    return html`<div class="cq-stage" style=${theme}>
      <div class="cq-glow">${glow('--accent', 80, 20, 0.21)}${glow('--accent2', 15, 85, 0.17)}</div>
      ${view(frame)}
    </div>`;
  };
}

/**
 * A scene of `length` frames: fades in over the second half of its first
 * Fade frames and out over the first half of its last, so in play() one
 * scene is gone before the next appears; it drifts slowly closer, and
 * calls body(t) with t.frame(), t.enter(at), a 0-to-1 spring released at
 * frame `at`, and t.between(a, b), 0 to 1 eased from frame a to frame b.
 */
export function scene(length, body, className = '') {
  return (frame) => {
    const fps = currentComposition().fps;
    const t = {
      frame,
      enter: (at) => spring({ frame: frame() - at, fps, config: { damping: 15 } }),
      between: (a, b) => interpolate(frame(), [a, b], [0, 1], { easing: easeInOut }),
    };
    return html`<section class=${`cq-scene ${className}`} style=${() => ({
      opacity: interpolate(frame(), [Fade / 2, Fade, length - Fade, length - Fade / 2], [0, 1, 1, 0]),
      transform: `scale(${interpolate(frame(), [0, length], [1, 1.035])})`,
    })}>${body(t)}</section>`;
  };
}

/** A headline: a kicker, the title word by word with *words* marked, and a sub line. */
export function title({ length, kicker, title, sub }) {
  const [head, mark, end] = beats(length, 3);
  return scene(length, (t) => html`
    ${kicker && html`<p class="cq-kicker" style=${() => ({ ...rise(t.enter(head.from)), '--w': t.between(head.from, head.from + 20) })}>${kicker}</p>`}
    <h1 class="cq-display cq-hero">${words(title, t, head.from + 4, mark.from)}</h1>
    ${sub && html`<p class="cq-sub" style=${() => rise(t.enter(end.from))}>${sub}</p>`}`, 'cq-title');
}

/** Short lines, one per beat, each arriving word by word and pushed up by the next. */
export function kinetic({ length, lines }) {
  const windows = beats(length, lines.length);
  return scene(length, (t) => html`
    <div class="cq-lines">${lines.map((line, i) => {
      const { from, to } = windows[i];
      const last = i === lines.length - 1;
      return html`<h2 class="cq-display cq-hero" style=${() => {
        const out = last ? 0 : t.between(to - 8, to + 4);
        return { opacity: 1 - out, transform: `translateY(${-10 * out}cqh)` };
      }}>${words(line, t, from, from + 10)}</h2>`;
    })}</div>
    ${progress(t, windows)}`, 'cq-kinetic');
}

/** 1-3 numbers, `{ value, prefix, suffix, label }`, each counting up in its own beat. */
export function stat({ length, title, stats }) {
  if (!(stats.length >= 1 && stats.length <= 3)) throw new Error('stat: give one to three numbers');
  const windows = beats(length, stats.length);
  return scene(length, (t) => html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-figures" style=${{ '--n': stats.length }}>${stats.map(({ value, prefix = '', suffix = '', label }, i) => {
      const { from } = windows[i];
      const decimals = (String(value).split('.')[1] ?? '').length;
      return html`<div class="cq-figure" style=${() => ({ ...rise(t.enter(from)), '--a': active(t, windows, i) })}>
        <b class="cq-display">${prefix}${() => (value * t.between(from, from + 36)).toFixed(decimals)}${suffix}</b>
        <i class="cq-rule"><i style=${() => ({ transform: `scaleX(${t.between(from + 6, from + 40)})` })}></i></i>
        <p>${label}</p>
      </div>`;
    })}</div>`, 'cq-stat');
}

/** A list of `{ title, text }` with a highlight moving down it, one step per beat, the current one shown large. */
export function steps({ length, title, items }) {
  const windows = beats(length, items.length);
  /** Where the highlight is, in rows from the top: it moves one row at the start of each beat after the first. */
  const row = (t) => windows.slice(1).reduce((sum, w) => sum + t.between(w.from - 6, w.from + 6), 0);
  return scene(length, (t) => html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-steps-body">
      <ol class="cq-list" style=${{ '--n': items.length }}>
        <i class="cq-pill" style=${() => ({ transform: `translateY(${100 * row(t)}%)` })}></i>
        ${items.map((item, i) => html`<li style=${() => ({ ...rise(t.enter(3 + 4 * i)), opacity: Math.min(1, t.enter(3 + 4 * i)) * (0.45 + 0.55 * active(t, windows, i)) })}>
          <span class="cq-num">${i + 1}</span>${item.title}</li>`)}
      </ol>
      <div class="cq-panel" style=${() => rise(t.enter(8))}>${items.map((item, i) => html`<div style=${() => {
        const { from, to } = windows[i]; // the old step leaves before the new one arrives
        const on = i === 0 ? 1 : t.between(from, from + 10), off = i === items.length - 1 ? 0 : t.between(to - 8, to);
        return { opacity: on - off, transform: `translateY(${4 * (1 - on) - 4 * off}cqh)` };
      }}>
        <b class="cq-display">${String(i + 1).padStart(2, '0')}</b>
        <h3 class="cq-display">${item.title}</h3>
        ${item.text && html`<p>${item.text}</p>`}
      </div>`)}
      ${progress(t, [{ from: 0, to: length - Fade }])}</div>
    </div>`, 'cq-steps');
}

/** A grid of 2-6 `{ title, text }` tiles that arrive together, then a highlight moving through them, a tile per beat. */
export function tiles({ length, title, items }) {
  if (!(items.length >= 2 && items.length <= 6)) throw new Error('tiles: give two to six tiles');
  const windows = beats(length, items.length);
  const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
  return scene(length, (t) => html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-grid" style=${{ '--cols': columns }}>${items.map((item, i) => html`<div class="cq-tile" style=${() => {
      const a = active(t, windows, i);
      const p = t.enter(4 + 3 * i);
      return { '--a': a, opacity: Math.min(1, p), transform: `translateY(${(1 - p) * 8 - 1.5 * a}cqh) scale(${1 + 0.025 * a})` };
    }}>
      <span class="cq-index">${String(i + 1).padStart(2, '0')}</span>
      <h3 class="cq-display">${item.title}</h3>
      ${item.text && html`<p>${item.text}</p>`}
    </div>`)}</div>`, 'cq-tiles');
}

/** The last word: a logo (an image URL), a line, a call to action and a URL, arriving one per beat. */
export function endCard({ length, logo, line, cta, url }) {
  const [first, second, third] = beats(length, 3);
  return scene(length, (t) => html`
    ${logo && html`<img class="cq-logo" src=${logo} alt="" style=${() => ({ transform: `scale(${t.enter(first.from)})` })}>`}
    <h2 class="cq-display cq-line">${words(line, t, first.from + 6, second.from)}</h2>
    ${cta && html`<span class="cq-cta" style=${() => ({
      ...rise(t.enter(second.from)),
      '--s': ((t.frame() - second.from) % 75) / 30, // a sheen crosses it in 30 frames, every 75
    })}>${cta}</span>`}
    ${url && html`<p class="cq-url" style=${() => rise(t.enter(third.from))}>${url}</p>`}`, 'cq-end');
}

/** Style for something rising into place as p goes from 0 to 1 (and a little past). */
function rise(p) {
  return { opacity: Math.min(1, Math.max(0, p)), transform: `translateY(${(1 - p) * 0.6}em)` };
}

/** How much item i of windows is the current one: 0 to 1, easing over the change; the last stays on. */
function active(t, windows, i) {
  const { from, to } = windows[i];
  const on = i === 0 ? 1 : t.between(from - 6, from + 6);
  const off = i === windows.length - 1 ? 0 : t.between(to - 6, to + 6);
  return on - off;
}

/** text word by word, from frame `at`, three frames apart; a mark sweeps under *marked words* at frame markAt. */
function words(text, t, at, markAt) {
  let n = 0; // words placed so far
  return text.split(/(\*[^*]+\*)/).map((part) => {
    const marked = /^\*.+\*$/.test(part);
    const spans = (marked ? part.slice(1, -1) : part).split(/(\s+)/).map((w) => {
      if (w === '') return null;
      if (/^\s+$/.test(w)) return w.includes('\n') ? html`<br>` : ' ';
      const k = n++;
      return html`<span class="cq-word" style=${() => rise(t.enter(at + 3 * k))}>${w}</span>`;
    });
    return marked ? html`<span class="cq-mark" style=${() => ({ '--w': t.between(markAt, markAt + 18) })}>${spans}</span>` : spans;
  });
}

/** Thin bars along the bottom, one per window, each filling as its window plays. */
function progress(t, windows) {
  return html`<div class="cq-progress">${windows.map(({ from, to }) => html`<i><i style=${() => ({
    transform: `scaleX(${interpolate(t.frame(), [from, to], [0, 1])})`,
  })}></i></i>`)}</div>`;
}

/** Adds the scenes' stylesheet to the page, once. */
function addStyles() {
  if (document.getElementById('cuadro-scenes')) return;
  const style = document.createElement('style');
  style.id = 'cuadro-scenes';
  style.textContent = Css;
  document.head.append(style);
}

/** The scenes' styles; every size is a theme property or a container unit. */
const Css = `
.cq-stage { position: absolute; inset: 0; overflow: hidden; container-type: size; background: var(--bg); color: var(--ink);
  font: 450 var(--t-body)/1.3 var(--font-body); -webkit-font-smoothing: antialiased; }
.cq-stage *, .cq-stage *::before, .cq-stage *::after { box-sizing: border-box; }
.cq-glow i { position: absolute; left: 0; top: 0; width: 90cqmax; height: 90cqmax; margin: -45cqmax 0 0 -45cqmax; }
.cq-scene { position: absolute; inset: 0; padding: var(--pad-y) var(--pad-x); display: flex; flex-direction: column; justify-content: center; }
.cq-scene > * { flex: none; }
.cq-scene :where(h1, h2, h3, p, ol) { margin: 0; padding: 0; }
.cq-display { font-family: var(--font-display); font-weight: var(--display-weight); letter-spacing: var(--tracking); line-height: 1.04; }
.cq-hero { font-size: var(--t-hero); text-wrap: balance; }
.cq-head { font-size: var(--t-2); margin-bottom: 6cqh; text-wrap: balance; }
.cq-word { display: inline-block; }
.cq-mark { color: var(--accent); background: linear-gradient(var(--accent2), var(--accent2)) no-repeat 0 92% / calc(var(--w) * 100%) 0.09em;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; }

.cq-kicker { display: flex; align-items: center; gap: 2cqmin; margin-bottom: 4cqh; font-size: var(--t-small); font-weight: 650;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.cq-kicker::before { content: ''; width: 7cqmin; height: 0.6cqmin; background: currentColor; transform-origin: left; transform: scaleX(var(--w)); }
.cq-title .cq-hero { max-width: 14em; }
.cq-sub { margin-top: 5cqh; max-width: 30em; font-size: var(--t-3); color: var(--muted); }

.cq-kinetic { align-items: center; text-align: center; }
.cq-lines { display: grid; place-items: center; }
.cq-lines > * { grid-area: 1 / 1; max-width: 12em; }
.cq-progress { position: absolute; left: var(--pad-x); right: var(--pad-x); bottom: 6cqh; display: flex; gap: 1.2cqmin; }
.cq-progress > i { flex: 1; height: 0.5cqmin; border-radius: 1cqmin; background: var(--line); overflow: hidden; }
.cq-progress > i > i { display: block; height: 100%; background: var(--accent); transform-origin: left; }

.cq-figures { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 5cqw; align-items: start; }
.cq-figure b { display: block; font-size: calc(var(--t-mega) * (1.6 - 0.25 * var(--n))); line-height: 0.95;
  color: color-mix(in srgb, var(--accent) calc(var(--a) * 100%), var(--line));
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.cq-rule { display: block; height: 0.6cqmin; margin: 3cqh 0; background: var(--line); }
.cq-rule i { display: block; height: 100%; background: var(--accent2); transform-origin: left; }
.cq-figure p { max-width: 16em; color: color-mix(in srgb, var(--ink) calc(var(--a) * 100%), var(--muted)); }

.cq-steps-body { display: grid; grid-template-columns: 1fr 1.15fr; gap: 5cqw; flex: 1 1 0; min-height: 0; }
.cq-list { position: relative; display: grid; grid-template-rows: repeat(var(--n), 1fr); list-style: none; }
.cq-list li { position: relative; display: flex; align-items: center; gap: 2.4cqmin; padding: 0 2.8cqmin; font-size: var(--t-3); font-weight: 650;
  letter-spacing: -0.01em; }
.cq-num { flex: none; display: grid; place-items: center; width: 1.8em; height: 1.8em; border-radius: 50%; border: 0.3cqmin solid currentColor;
  font-size: var(--t-small); }
.cq-pill { position: absolute; left: 0; right: 0; top: 0; height: calc(100% / var(--n)); border-radius: var(--radius); background: var(--surface);
  box-shadow: inset 0.8cqmin 0 0 var(--accent); }
.cq-panel { position: relative; display: grid; border-radius: var(--radius); background: var(--surface); padding: 5cqmin; }
.cq-panel > div { grid-area: 1 / 1; display: flex; flex-direction: column; justify-content: center; }
.cq-panel b { font-size: var(--t-2); color: var(--accent); }
.cq-panel h3 { margin-top: 1cqh; font-size: var(--t-1); }
.cq-panel p { margin-top: 2.5cqh; color: var(--muted); }
.cq-panel .cq-progress { left: 5cqmin; right: 5cqmin; bottom: 4cqmin; }

.cq-grid { display: grid; grid-template-columns: repeat(var(--cols), 1fr); grid-auto-rows: 1fr; gap: var(--gap); flex: 1 1 0; min-height: 0; }
.cq-tile { display: flex; flex-direction: column; justify-content: flex-end; padding: 3.6cqmin; border-radius: var(--radius);
  border: 1px solid var(--line); background: color-mix(in srgb, var(--accent) calc(var(--a) * 100%), var(--surface));
  color: color-mix(in srgb, var(--on-accent) calc(var(--a) * 100%), var(--ink));
  box-shadow: 0 calc(var(--a) * 3cqh) calc(var(--a) * 6cqh) -2cqh #0000004d; }
.cq-index { margin-bottom: auto; font-size: var(--t-small); font-weight: 700; color: color-mix(in srgb, currentColor calc(var(--a) * 100%), var(--accent)); }
.cq-tile h3 { font-size: var(--t-3); }
.cq-tile p { margin-top: 1.2cqh; font-size: var(--t-small); opacity: 0.75; }

.cq-end { align-items: center; text-align: center; }
.cq-logo { height: 18cqmin; width: auto; margin-bottom: 4cqh; }
.cq-line { font-size: var(--t-1); max-width: 14em; text-wrap: balance; }
.cq-cta { position: relative; overflow: hidden; margin-top: 5.5cqh; padding: 0.55em 1.4em; border-radius: 99em; background: var(--accent);
  color: var(--on-accent); font-size: var(--t-3); font-weight: 700; }
.cq-cta::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, #ffffff66, transparent 70%);
  transform: translateX(calc((var(--s) * 2 - 1) * 100%)); }
.cq-url { margin-top: 3.5cqh; color: var(--muted); font-weight: 600; }

@container (orientation: portrait) {
  .cq-figures { grid-template-columns: 1fr; gap: 5cqh; }
  .cq-figure b { font-size: calc(var(--t-mega) * (1.3 - 0.15 * var(--n))); }
  .cq-steps-body { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; gap: 3cqh; }
  .cq-grid { grid-template-columns: repeat(min(var(--cols), 2), 1fr); }
}
`;
