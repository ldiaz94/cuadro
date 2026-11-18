// cuadro scenes: designed views for an explainer video, styled by a theme.
// Each scene is scene(props) => view, where a view is (frame) => content,
// so scenes and hand-written views mix freely. Each takes its `length` in
// frames and spreads its beats across it, so nothing stands still while
// a voice talks:
//
//   title    kicker, headline word by word, a mark swept under *words*, sub
//   kinetic  2-4 short lines, one per beat, each below the last, which dims
//   stat     1-3 numbers in rows, each counting up in its beat as a rule sweeps under it
//   steps    a list with a highlight moving down it, the current step large
//   tiles    a grid with a highlight moving through it
//   app      a phone or browser showing a screenshot or built rows, the camera easing in
//   quote    a big quote word by word, then who said it, with an avatar or initials
//   compare  two sides, the second revealed by a wipe, then picked as the better
//   endCard  logo and a line, then a call to action and a URL, held to the end
//
//   0     Fade                                   length-Fade   length
//   |fade in|-- beat 1 --|-- beat 2 --|-- beat 3 --|fade out|
//   beats tile [0, length - Fade); the fades overlap the first and last,
//   and the scenes before and after when played with play().
//
// Given its narration's `words` (voice.json), kinetic starts each line,
// and steps, tiles, app's rows and compare's sides move to each item,
// as the line says it (cued()).
//
// stage(theme(...), view) draws the themed frame with a slowly drifting
// glow behind the view; play(...) plays scenes in order, each one
// cross-fading into the next. Sizes come from theme.js's custom
// properties in container units, so the scenes fill any frame size, and
// a portrait frame stacks what sits side by side in landscape. A stage
// whose theme sets --safe-bottom (captions.js's CaptionBand) keeps the
// scenes above that band.
// Depends on spark, animate.js, timeline.js and composition.js (for fps).
// Leaves out transitions other than cross-fades, icons, images other than
// the end card's logo, the app's screenshot and the quote's avatar, and
// props that no video has needed yet.
import { html } from 'spark';
import { interpolate, spring, easeInOut } from './animate.js';
import { sequence } from './timeline.js';
import { currentComposition } from './composition.js';

/** Frames a scene takes to fade in, and to fade out; play() overlaps scenes by this much. */
export const Fade = 12;

/** The shortest beat, in frames: enough for something to arrive and be seen. */
export const MinBeat = 15;

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
 * A scene of `length` frames: fades in over frames 3 to 9 and out over
 * the first 4 of its last Fade frames (unless `fadeOut` is false, for the
 * last scene), so in play() the old scene is all but gone as the new one
 * arrives, and the new one is in place well before the overlap ends. It drifts slowly closer, and calls body(t) with t.frame(),
 * t.enter(at), a 0-to-1 spring released at frame `at`, and
 * t.between(a, b), 0 to 1 eased from frame a to frame b.
 */
export function scene(length, body, { className = '', fadeOut = true } = {}) {
  return (frame) => {
    const fps = currentComposition().fps;
    const t = {
      frame,
      enter: (at) => spring({ frame: frame() - at, fps, config: { damping: 15 } }),
      between: (a, b) => interpolate(frame(), [a, b], [0, 1], { easing: easeInOut }),
    };
    return html`<section class=${`cq-scene ${className}`} style=${() => ({
      opacity: Math.min(interpolate(frame(), [3, 9], [0, 1]), fadeOut ? interpolate(frame(), [length - Fade, length - Fade + 4], [1, 0]) : 1),
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
    ${sub && html`<p class="cq-sub" style=${() => rise(t.enter(end.from))}>${sub}</p>`}`, { className: 'cq-title' });
}

/** Two to four short lines, one per beat, each arriving word by word below the last, which dims. */
export function kinetic({ length, lines, words: said }) {
  const even = beats(length, lines.length);
  return scene(length, (t) => {
    const windows = cued(even, lines, said);
    return html`
    <div class="cq-lines">${lines.map((line, i) => {
      const { from, to } = windows[i];
      const last = i === lines.length - 1;
      return html`<h2 class="cq-display cq-hero" style=${() => ({ opacity: 1 - (last ? 0 : 0.65 * t.between(to - 6, to + 6)) })}>
        ${words(line, t, from, from + 10)}</h2>`;
    })}</div>
    ${progress(t, windows)}`;
  }, { className: 'cq-kinetic' });
}

/** How large the numbers are for 1, 2 or 3 of them, in --t-mega. */
const StatSizes = [1.5, 0.95, 0.62];

/** 1-3 numbers, `{ value, prefix, suffix, label }`, a row each, arriving together, each counting up in its own beat. */
export function stat({ length, title, stats }) {
  if (!(stats.length >= 1 && stats.length <= 3)) throw new Error('stat: give one to three numbers');
  const windows = beats(length, stats.length);
  return scene(length, (t) => html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-figures" style=${{ '--k': StatSizes[stats.length - 1] }}>${stats.map(({ value, prefix = '', suffix = '', label }, i) => {
      const { from, to } = windows[i];
      const decimals = (String(value).split('.')[1] ?? '').length;
      // display: contents, so the numbers share a column and the labels line up
      return html`<div class="cq-figure" style=${() => ({ '--a': active(t, windows, i) })}>
        <b class="cq-display" style=${() => rise(t.enter(2 + 4 * i))}>${prefix}${() => (value * t.between(from, from + 36)).toFixed(decimals)}${suffix}</b>
        <p style=${() => rise(t.enter(4 + 4 * i))}>${label}</p>
        <i class="cq-rule"><i style=${() => ({ transform: `scaleX(${t.between(from + 6, to)})` })}></i></i>
      </div>`;
    })}</div>`, { className: 'cq-stat' });
}

/** A list of `{ title, text }` with a highlight moving down it, one step per beat, the current one shown large. */
export function steps({ length, title, items, words: said }) {
  const even = beats(length, items.length);
  /** Where the highlight is, in rows from the top: it moves one row at the start of each beat after the first. */
  const row = (t, windows) => windows.slice(1).reduce((sum, w) => sum + t.between(w.from - 6, w.from + 6), 0);
  return scene(length, (t) => {
    const windows = cued(even, items.map((item) => item.title), said);
    return html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-steps-body">
      <ol class="cq-list" style=${{ '--n': items.length }}>
        <i class="cq-pill" style=${() => ({ transform: `translateY(${100 * row(t, windows)}%)` })}></i>
        ${items.map((item, i) => html`<li style=${() => ({ ...rise(t.enter(1 + 3 * i)), opacity: Math.min(1, t.enter(1 + 3 * i)) * (0.45 + 0.55 * active(t, windows, i)) })}>
          <span class="cq-num">${i + 1}</span>${item.title}</li>`)}
      </ol>
      <div class="cq-panel" style=${() => rise(t.enter(2))}>${items.map((item, i) => html`<div style=${() => {
        const { from, to } = windows[i]; // the old step leaves before the new one arrives
        const on = i === 0 ? 1 : t.between(from, from + 10), off = i === items.length - 1 ? 0 : t.between(to - 8, to);
        return { opacity: on - off, transform: `translateY(${4 * (1 - on) - 4 * off}cqh)` };
      }}>
        <b class="cq-display">${String(i + 1).padStart(2, '0')}</b>
        <h3 class="cq-display">${item.title}</h3>
        ${item.text && html`<p>${item.text}</p>`}
      </div>`)}
      ${progress(t, [{ from: 0, to: length - Fade }])}</div>
    </div>`;
  }, { className: 'cq-steps' });
}

/** A grid of 2-6 `{ title, text }` tiles that arrive together, then a highlight moving through them, a tile per beat. */
export function tiles({ length, title, items, words: said }) {
  if (!(items.length >= 2 && items.length <= 6)) throw new Error('tiles: give two to six tiles');
  const even = beats(length, items.length);
  const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
  return scene(length, (t) => {
    const windows = cued(even, items.map((item) => item.title), said);
    return html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-grid" style=${{ '--cols': columns }}>${items.map((item, i) => html`<div class="cq-tile" style=${() => {
      const a = active(t, windows, i);
      const p = t.enter(1 + 2 * i);
      return { '--a': a, opacity: Math.min(1, p), transform: `translateY(${(1 - p) * 8 - 1.5 * a}cqh) scale(${1 + 0.025 * a})` };
    }}>
      <span class="cq-index">${String(i + 1).padStart(2, '0')}</span>
      <h3 class="cq-display">${item.title}</h3>
      ${item.text && html`<p>${item.text}</p>`}
    </div>`)}</div>`;
  }, { className: 'cq-tiles' });
}

/** The last word: a logo (an image URL) and a line, then a call to action and a URL, held to the end. */
export function endCard({ length, logo, line, cta, url }) {
  const [first, second] = beats(length, 2);
  return scene(length, (t) => html`
    ${logo && html`<img class="cq-logo" src=${logo} alt="" style=${() => ({ transform: `scale(${t.enter(first.from)})` })}>`}
    <h2 class="cq-display cq-line">${words(line, t, first.from + 6, second.from)}</h2>
    ${cta && html`<span class="cq-cta" style=${() => ({
      ...rise(t.enter(second.from)),
      '--s': ((t.frame() - second.from) % 75) / 30, // a sheen crosses it in 30 frames, every 75
    })}>${cta}</span>`}
    ${url && html`<p class="cq-url" style=${() => rise(t.enter(second.from + 10))}>${url}</p>`}`, { className: 'cq-end', fadeOut: false });
}

/** Frames before its word that a cued beat starts, so the change lands as the word is heard. */
const Lead = 4;

/**
 * The beats `even` (from beats()), moved so each starts Lead frames before the first narration word that
 * matches its key (an item's title or a line) is said; keys never said fall evenly between those that
 * are. Without words, or if two beats would start under MinBeat apart, it is `even`. It reads the fps,
 * so it runs while drawing.
 */
function cued(even, keys, said) {
  if (!said?.length) return even;
  const fps = currentComposition().fps;
  const span = even.at(-1).to;
  const anchors = []; // [key index, start frame] of the keys found
  let next = 0; // the first word a key may match: keys are said in order
  keys.forEach((key, i) => {
    const wanted = keyWords(key);
    const j = said.findIndex((w, k) => k >= next && wanted.some((x) => alike(x, plain(w.text))));
    if (j >= 0) {
      anchors.push([i, Math.max(0, Math.round(said[j].start * fps) - Lead)]);
      next = j + 1;
    }
  });
  if (!anchors.length) return even;
  if (anchors[0][0] !== 0) anchors.unshift([0, 0]);
  anchors.push([keys.length, span]);
  const starts = [];
  for (let a = 1; a < anchors.length; a++) {
    const [[i0, f0], [i1, f1]] = [anchors[a - 1], anchors[a]];
    for (let i = i0; i < i1; i++) starts[i] = Math.round(f0 + ((f1 - f0) * (i - i0)) / (i1 - i0));
  }
  const windows = starts.map((from, i) => ({ from, to: starts[i + 1] ?? span }));
  return windows.every((w) => w.to - w.from >= MinBeat) ? windows : even;
}

/** The words of a key worth matching: lower case, letters and digits only, the short ones dropped if any are long. */
function keyWords(key) {
  const all = key.split(/\s+/).map(plain).filter(Boolean);
  const long = all.filter((w) => w.length >= 3);
  return long.length ? long : all;
}

/** A word lower-cased, without accents or punctuation, for matching. */
function plain(word) {
  return word.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whether two plain words are the same word, give or take an ending: equal, or sharing their first five letters (or all of a shorter one's four). */
function alike(a, b) {
  if (Math.min(a.length, b.length) < 4) return a === b;
  const n = Math.min(5, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

/**
 * A phone (or a browser window) showing a screenshot, `image`, panned from its top to its bottom
 * over two beats, or 2-4 built `rows`, one arriving per beat; the camera eases in and turns toward
 * the viewer for the whole scene. Beside it (above it in portrait) an optional headline.
 */
export function app({ length, title, device = 'phone', image, rows, words: said }) {
  if (!image === !rows) throw new Error('app: give an image or rows, not both');
  const even = beats(length, rows ? rows.length : 2);
  const end = length - Fade;
  return scene(length, (t) => {
    const windows = rows ? cued(even, rows.map((row) => row.title), said) : even;
    return html`
    ${title && html`<h2 class="cq-display cq-head">${words(title, t, 0, windows[0].to)}</h2>`}
    <div class="cq-view">
      <div class=${`cq-device cq-${device}`} style=${() => {
        const p = t.between(0, end);
        return { opacity: Math.min(1, t.enter(0)), '--turn': 1 - p, '--zoom': 0.86 + 0.08 * t.enter(0) + 0.06 * p, '--pan': 1 - 2 * p };
      }}>
        ${device === 'browser' && html`<div class="cq-bar"><i></i><i></i><i></i></div>`}
        <div class="cq-screen">${image
          ? html`<img src=${image} alt="" style=${() => ({ objectPosition: `50% ${100 * t.between(windows[0].from + 10, end)}%` })}>`
          : rows.map((row, i) => html`<div class=${`cq-row cq-${row.kind ?? 'item'}`} style=${() => {
            const p = t.enter(windows[i].from);
            return { '--a': active(t, windows, i), opacity: Math.min(1, Math.max(0, p)), transform: `translateY(${2 * (1 - p)}cqh) scale(${0.9 + 0.1 * p})` };
          }}>
            ${['item', 'profile'].includes(row.kind ?? 'item') && html`<span class="cq-avatar">${initials(row.title)}</span>`}
            <p><b>${row.title}</b>${row.text && html`<span>${row.text}</span>`}</p>
          </div>`)}</div>
      </div>
    </div>`;
  }, { className: 'cq-app' });
}

/** A quote word by word, its *marked words* swept in the second beat, as who said it arrives under it: an avatar (an image URL) or their initials, ringed by a sweep to the end. */
export function quote({ length, quote, name, role, image }) {
  const [said, by] = beats(length, 2);
  const count = quote.split(/\s+/).length;
  const size = count <= 10 ? 'var(--t-1)' : count <= 20 ? 'var(--t-2)' : 'var(--t-3)';
  return scene(length, (t) => html`
    <i class="cq-display cq-glyph" style=${() => ({ opacity: Math.min(1, t.enter(said.from)), transform: `translateY(${-3 * t.between(0, length)}cqh) rotate(${-8 + 8 * t.enter(said.from)}deg)` })}>“</i>
    <p class="cq-display cq-quoted" style=${{ fontSize: size }}>${words(quote, t, said.from + 4, by.from)}</p>
    <div class="cq-by" style=${() => rise(t.enter(by.from))}>
      <span class="cq-ring" style=${() => ({ '--p': t.between(by.from, length - Fade) })}>
        ${image ? html`<img src=${image} alt="">` : html`<span class="cq-avatar">${initials(name)}</span>`}</span>
      <p><b>${name}</b>${role && html`<span>${role}</span>`}</p>
    </div>`, { className: 'cq-quote' });
}

/**
 * Two sides, `{ label, items }`, side by side (stacked in portrait): the first with its items one by
 * one, then the second revealed by a wipe with its own, then the second picked: it lifts as the
 * first dims.
 */
export function compare({ length, title, left, right, words: said }) {
  const even = beats(length, 3);
  return scene(length, (t) => {
    const [first, second, verdict] = cued(even, [left.label, right.label, ''], said);
    /** 0 to 1 as the second side is picked. */
    const picked = () => t.between(verdict.from - 4, verdict.from + 10);
    /** A side's card: its label, and its items spread across its beat. */
    const side = ({ label, items }, { from, to }, better) => html`<div class=${`cq-side${better ? ' cq-better' : ''}`} style=${() => (better
      ? { '--r': t.between(from, from + 18), '--a': picked() }
      : { opacity: Math.min(1, t.enter(from)) * (1 - 0.45 * picked()) })}>
      <h3 class="cq-display">${label}</h3>
      <ul>${items.map((item, k) => html`<li style=${() => rise(t.enter(from + 8 + Math.round((k * (to - from - 8)) / items.length)))}>
        <i class="cq-tick"></i>${item}</li>`)}</ul>
    </div>`;
    return html`
    ${title && html`<h2 class="cq-display cq-head" style=${() => rise(t.enter(0))}>${title}</h2>`}
    <div class="cq-sides">
      ${side(left, first, false)}
      <span class="cq-vs" style=${() => ({ transform: `scale(${t.enter(second.from - 6)}) rotate(${360 * picked()}deg)` })}>vs</span>
      ${side(right, second, true)}
    </div>`;
  }, { className: 'cq-compare' });
}

/** The first letters of a name's first two words, for an avatar without a picture. */
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** Style for something rising into place as p goes from 0 to 1 (and a little past). */
function rise(p) {
  return { opacity: Math.min(1, Math.max(0, p)), transform: `translateY(${(1 - p) * 5}cqh)` };
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
.cq-scene { position: absolute; inset: 0; padding: var(--pad-y) var(--pad-x); display: flex; flex-direction: column; justify-content: center;
  padding-bottom: max(var(--pad-y), calc(var(--safe-bottom, 0px) + 3cqmin)); }
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
.cq-title { justify-content: space-between; }
.cq-title .cq-hero { margin-block: auto; max-width: 12em; font-size: calc(var(--t-hero) * 1.15); }
.cq-sub { max-width: 26em; font-size: var(--t-3); color: var(--muted); }

.cq-lines { display: flex; flex-direction: column; gap: 3cqh; }
.cq-progress { position: absolute; left: var(--pad-x); right: var(--pad-x); bottom: max(6cqh, var(--safe-bottom, 0px)); display: flex; gap: 1.2cqmin; }
.cq-progress > i { flex: 1; height: 0.5cqmin; border-radius: 1cqmin; background: var(--line); overflow: hidden; }
.cq-progress > i > i { display: block; height: 100%; background: var(--accent); transform-origin: left; }

.cq-figures { display: grid; grid-template-columns: auto 1fr; column-gap: 5cqw; align-items: center; }
.cq-figure { display: contents; }
.cq-figure b { font-size: min(calc(var(--t-mega) * var(--k)), 26cqw); line-height: 1;
  color: color-mix(in srgb, var(--accent) calc(var(--a) * 100%), color-mix(in srgb, var(--ink) 30%, transparent));
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.cq-rule { grid-column: 1 / -1; display: block; height: 0.5cqmin; margin: 2.4cqh 0; background: var(--line); }
.cq-rule i { display: block; height: 100%; background: var(--accent2); transform-origin: left; }
.cq-figure p { font-size: var(--t-3); line-height: 1.2; color: color-mix(in srgb, var(--ink) calc(var(--a) * 100%), var(--muted)); }

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
.cq-panel h3 { margin-top: 1cqh; font-size: var(--t-hero); }
.cq-panel p { margin-top: 2.5cqh; font-size: var(--t-3); line-height: 1.2; color: var(--muted); }
.cq-panel .cq-progress { left: 5cqmin; right: 5cqmin; bottom: 4cqmin; }

.cq-grid { display: grid; grid-template-columns: repeat(var(--cols), 1fr); grid-auto-rows: 1fr; gap: var(--gap); flex: 1 1 0; min-height: 0; }
.cq-tile { display: flex; flex-direction: column; justify-content: flex-end; padding: 3.6cqmin; border-radius: var(--radius);
  border: 1px solid var(--line); background: color-mix(in srgb, var(--accent) calc(var(--a) * 100%), var(--surface));
  color: color-mix(in srgb, var(--on-accent) calc(var(--a) * 100%), var(--ink));
  box-shadow: 0 calc(var(--a) * 3cqh) calc(var(--a) * 6cqh) -2cqh #0000004d; }
.cq-index { margin-bottom: auto; font-size: var(--t-small); font-weight: 700; color: color-mix(in srgb, currentColor calc(var(--a) * 100%), var(--accent)); }
.cq-tile h3 { font-size: var(--t-2); }
.cq-tile p { margin-top: 1cqh; line-height: 1.2; opacity: 0.75; }

.cq-end { align-items: center; text-align: center; }
.cq-logo { height: 18cqmin; width: auto; margin-bottom: 4cqh; }
.cq-line { font-size: var(--t-1); max-width: 14em; text-wrap: balance; }
.cq-cta { position: relative; overflow: hidden; margin-top: 5.5cqh; padding: 0.55em 1.4em; border-radius: 99em; background: var(--accent);
  color: var(--on-accent); font-size: var(--t-3); font-weight: 700; }
.cq-cta::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, #ffffff66, transparent 70%);
  transform: translateX(calc((var(--s) * 2 - 1) * 100%)); }
.cq-url { margin-top: 3.5cqh; color: var(--muted); font-weight: 600; }

.cq-app { flex-direction: row; align-items: center; justify-content: center; gap: 6cqw; }
.cq-app .cq-head { flex: 1 1 0; margin: 0; font-size: var(--t-1); }
.cq-view { align-self: stretch; display: flex; justify-content: center; }
.cq-device { display: flex; flex-direction: column; height: 100%; padding: 1.2cqmin; background: #101217;
  box-shadow: 0 0 0 0.3cqmin var(--line), 0 4cqh 10cqh -3cqh #00000066;
  transform: perspective(240cqmin) translateY(calc(var(--pan) * 2cqh)) rotateY(calc(var(--turn) * -14deg)) scale(var(--zoom)); }
.cq-phone { width: 56cqmin; border-radius: 6cqmin; }
.cq-browser { width: 62cqw; border-radius: 2cqmin; }
.cq-bar { display: flex; gap: 1cqmin; padding: 0.4cqmin 0.8cqmin 1.6cqmin; }
.cq-bar i { width: 1.6cqmin; height: 1.6cqmin; border-radius: 50%; background: #ffffff40; }
.cq-screen { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: 1.4cqmin;
  padding: 5cqmin 2.4cqmin 2.4cqmin; border-radius: 4.8cqmin; background: color-mix(in srgb, var(--bg) 88%, var(--ink)); color: var(--ink); }
.cq-phone .cq-screen::before { content: ''; position: absolute; top: 1.4cqmin; left: 50%; width: 14cqmin; height: 2.2cqmin; margin-left: -7cqmin;
  border-radius: 99em; background: #101217; }
.cq-browser .cq-screen { padding: 3cqmin; border-radius: 1cqmin; }
.cq-screen:has(img) { padding: 0; }
.cq-screen img { flex: 1; min-height: 0; width: 100%; object-fit: cover; border-radius: inherit; }
.cq-row { display: flex; align-items: center; gap: 1.8cqmin; padding: 1.6cqmin 2cqmin; border-radius: 2cqmin; background: var(--surface);
  font-size: var(--t-small); line-height: 1.2; box-shadow: 0 0 0 calc(var(--a) * 0.5cqmin) var(--accent); }
.cq-row p { display: flex; flex-direction: column; min-width: 0; }
.cq-row b { font-weight: 650; }
.cq-row p span { color: var(--muted); }
.cq-avatar { flex: none; display: grid; place-items: center; width: 2em; height: 2em; border-radius: 50%; background: var(--accent);
  color: var(--on-accent); font-weight: 700; letter-spacing: 0.02em; }
.cq-sent, .cq-received { max-width: 85%; border-radius: 3cqmin; }
.cq-sent { align-self: flex-end; border-bottom-right-radius: 0.6cqmin; background: var(--accent); color: var(--on-accent); }
.cq-sent p span { color: inherit; opacity: 0.75; }
.cq-received { align-self: flex-start; border-bottom-left-radius: 0.6cqmin; }
.cq-profile { flex-direction: column; gap: 1cqmin; text-align: center; }
.cq-profile p { align-items: center; }
.cq-profile b { font-size: var(--t-body); }

.cq-quote { justify-content: space-between; }
.cq-glyph { display: block; height: 0.42em; font-size: calc(var(--t-mega) * 1.1); font-style: normal; line-height: 0.8; color: var(--accent); }
.cq-quoted { margin-block: auto; max-width: 20em; line-height: 1.12; text-wrap: balance; }
.cq-by { display: flex; align-items: center; gap: 2.8cqmin; }
.cq-ring { flex: none; width: 15cqmin; height: 15cqmin; padding: 0.7cqmin; border-radius: 50%;
  background: conic-gradient(var(--accent2) calc(var(--p) * 360deg), var(--line) 0); }
.cq-ring > * { width: 100%; height: 100%; border: 0.6cqmin solid var(--bg); object-fit: cover; font-size: var(--t-3); }
.cq-by p { display: flex; flex-direction: column; font-size: var(--t-3); line-height: 1.2; }
.cq-by b { font-weight: 700; }
.cq-by p span { font-size: var(--t-body); color: var(--muted); }

.cq-sides { display: grid; grid-template-columns: 1fr auto 1fr; gap: 3cqmin; flex: 1 1 0; min-height: 0; }
.cq-side { display: flex; flex-direction: column; justify-content: center; gap: 4cqh; padding: 5cqmin; border-radius: var(--radius);
  border: 1px solid var(--line); background: var(--surface); }
.cq-side h3 { font-size: var(--t-2); }
.cq-side ul { display: flex; flex-direction: column; gap: 2.4cqh; margin: 0; padding: 0; list-style: none; }
.cq-side li { display: flex; align-items: center; gap: 2cqmin; font-size: var(--t-3); font-weight: 550; line-height: 1.15; }
.cq-tick { position: relative; flex: none; width: 1em; height: 1em; border-radius: 50%; background: var(--line); }
.cq-tick::before { content: ''; position: absolute; left: 28%; right: 28%; top: 47%; height: 0.1em; background: currentColor; }
.cq-better { border-color: transparent; background: var(--accent); color: var(--on-accent);
  clip-path: inset(0 calc((1 - var(--r)) * 100%) 0 0 round var(--radius));
  transform: translateY(calc(var(--a) * -1.5cqh)) scale(calc(1 + 0.03 * var(--a))); }
.cq-better .cq-tick { background: var(--on-accent); }
.cq-better .cq-tick::before { left: 36%; right: auto; top: 20%; width: 0.28em; height: 0.48em; background: none;
  border: solid var(--accent); border-width: 0 0.1em 0.1em 0; transform: rotate(45deg); }
.cq-vs { align-self: center; display: grid; place-items: center; width: 2.6em; height: 2.6em; border-radius: 50%; background: var(--ink);
  color: var(--bg); font-size: var(--t-small); font-weight: 750; text-transform: uppercase; }

@container (orientation: portrait) {
  .cq-figures { grid-template-columns: 1fr; }
  .cq-figure p { margin-top: 1cqh; }
  .cq-logo { height: 30cqmin; }
  .cq-line { font-size: var(--t-hero); }
  .cq-steps-body { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; gap: 3cqh; }
  .cq-grid { grid-template-columns: repeat(min(var(--cols), 2), 1fr); }
  .cq-app { flex-direction: column; align-items: stretch; gap: 4cqh; }
  .cq-app .cq-head { flex: none; font-size: var(--t-2); }
  .cq-view { flex: 1 1 0; min-height: 0; }
  .cq-device { transform: perspective(240cqmin) translateY(calc(var(--pan) * 2cqh)) rotateX(calc(var(--turn) * 12deg)) scale(var(--zoom)); }
  .cq-phone { width: 76cqw; }
  .cq-browser { width: 100%; }
  .cq-row { font-size: var(--t-body); }
  .cq-sides { grid-template-columns: none; grid-template-rows: 1fr auto 1fr; }
  .cq-vs { justify-self: center; }
  .cq-better { clip-path: inset(0 0 calc((1 - var(--r)) * 100%) 0 round var(--radius)); }
}
`;
