// cuadro captions: the narration on screen, a phrase at a time, with the
// word being said lit in the theme's accent.
//
//   ┌────────────────────────────────────┐
//   │                                    │
//   │      the scene, kept above the     │
//   │      band by --safe-bottom         │
//   │                                    │
//   │    ┌──────────────────────────┐    │ ┐
//   │    │ and meet ▐volunteer▌ men │    │ │ CaptionBand: at most two lines
//   │    └──────────────────────────┘    │ ┘ on a dark backdrop
//   └────────────────────────────────────┘
//
// words are a video's spoken words, [{ text, start, end }] in seconds from
// the video's start (voice.json's per line, moved to where each line plays).
// cues(words) groups them into phrases, [{ start, end, text, words }]:
// each ends after a sentence, after other punctuation once it holds
// MinWords, or at a pause of Gap, and one longer than MaxChars is cut in
// even parts; it stays up until the next one or Linger after its last word. captions(words)
// is the view, drawn inside a stage (scenes.js) so it takes the theme;
// render.js writes the same cues as an .srt when the page sets
// window.cuadro.captions.
// Depends on spark, composition.js and level.js. Leaves out positions
// other than the bottom, styling options, and splitting a word too long for
// a line.
import { computed, html } from 'spark';
import { currentComposition } from './composition.js';
import { word } from './level.js';

/** The most characters in a phrase: two lines at the caption size, at most, and usually one. */
export const MaxChars = 42;

/** Words a phrase needs before a comma may end it. */
const MinWords = 3;

/** A silence that ends a phrase, in seconds. */
const Gap = 0.6;

/** How long a phrase stays after its last word when no other follows at once, in seconds. */
const Linger = 0.6;

/** How early a phrase shows before its first word, in seconds, so the eye is there in time. */
const Early = 0.1;

/** The height scenes keep clear at the bottom of the frame for the captions, as --safe-bottom. */
export const CaptionBand = '21cqmin';

/** The words grouped into phrases: [{ start, end, text, words }], times in seconds. */
export function cues(words) {
  const clauses = [];
  let clause = [];
  words.forEach((w, i) => {
    if (clause.length && w.start - words[i - 1].end >= Gap) clauses.push(clause.splice(0));
    clause.push(w);
    if (/[.!?。！？]["'”»)]*$/u.test(w.text) || (clause.length >= MinWords && /[,;:、，]$/u.test(w.text))) clauses.push(clause.splice(0));
  });
  if (clause.length) clauses.push(clause);
  const groups = clauses.flatMap(even);
  return groups.map((g, i) => ({
    start: g[0].start,
    end: Math.min(g.at(-1).end + Linger, groups[i + 1]?.[0].start ?? Infinity),
    text: join(g),
    words: g,
  }));
}

/** A clause longer than MaxChars cut into as few parts as fit, of about equal length, so no word is left alone. */
function even(clause) {
  const total = join(clause).length;
  const parts = Math.ceil(total / MaxChars);
  if (parts <= 1) return [clause];
  const out = [[]];
  let chars = 0;
  for (const w of clause) {
    if (out.at(-1).length && chars >= (out.length * total) / parts) out.push([]);
    out.at(-1).push(w);
    chars += w.text.length + 1;
  }
  return out;
}

/** The words' text joined with spaces, but none between characters of scripts written without them. */
function join(words) {
  const tight = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}、。，！？]/u;
  return words.reduce((text, w, i) => text + (i && !(tight.test(text.at(-1)) && tight.test(w.text[0])) ? ' ' : '') + w.text, '');
}

/** The captions view: the phrase being said at the bottom of the frame, its current word lit. */
export function captions(words) {
  const list = cues(words);
  return (frame) => {
    addStyles();
    const fps = currentComposition().fps;
    const shown = computed(() => {
      const s = frame() / fps;
      return list.findIndex((c) => c.start - Early <= s && s < c.end);
    });
    return html`<div class="cq-captions">${() => {
      const cue = list[shown()];
      if (!cue) return null;
      // Each word is its own span, with the spaces cue.text has between them.
      let at = 0;
      return html`<p>${cue.words.map((w, i) => {
        const start = cue.text.indexOf(w.text, at);
        const space = cue.text.slice(at, start);
        at = start + w.text.length;
        return [space, html`<span class=${() => (word(cue.words, frame(), fps) === i ? 'cq-said' : '')}>${w.text}</span>`];
      })}</p>`;
    }}</div>`;
  };
}

/** Adds the captions' stylesheet to the page, once. */
function addStyles() {
  if (document.getElementById('cuadro-captions')) return;
  const style = document.createElement('style');
  style.id = 'cuadro-captions';
  style.textContent = Css;
  document.head.append(style);
}

/** Sized in container units of the stage, so they read the same on any frame; 5.4cqmin is 39 px on 1280x720. */
const Css = `
.cq-captions { position: absolute; left: 6cqw; right: 6cqw; bottom: 3.5cqmin; display: flex; justify-content: center; pointer-events: none; }
.cq-captions p { margin: 0; max-width: 100%; padding: 0.3em 0.7em; border-radius: 1.6cqmin; background: #0b0c10d9; color: #ffffff;
  font: 650 5.4cqmin/1.35 var(--font-body); letter-spacing: -0.01em; text-align: center; text-wrap: balance;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.cq-captions span { border-radius: 0.8cqmin; padding: 0 0.12em; margin: 0 -0.12em; }
.cq-captions .cq-said { background: var(--accent); color: var(--on-accent); }
`;
