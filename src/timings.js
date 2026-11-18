// cuadro timings: when each word of a spoken line is said, as
// [{ text, start, end }] in seconds from the line's start.
// split(text, language) cuts a line into words with Intl.Segmenter, so
// languages written without spaces (Japanese, Chinese, Thai) split too;
// punctuation stays with the word it touches ("works." and "¿Qué"), and
// a dash between spaces with the word before it.
// fromCharacters(alignment) turns a provider's per-character times
// (ElevenLabs) into word times. estimate(text, levels, fps) guesses them
// from the line's loudness (voice.js's levels), for providers that give no
// times (Gemini, OpenAI, Qwen):
//
//   loudness  ▁▅▇▆▅▇▁▁▁▁▆▇▅▆▇▅▁
//   voiced    [  phrase 1  ]    [ phrase 2 ]     pauses of MinPause or more split it
//   words     Hello  there,    big   world.     each pause takes the nearest word gap
//                                               (a comma's, if a word or so off) within a word's
//                                               length; words fill the voiced time
//                                               between by their length
//
// Depends on nothing. Leaves out speech recognition (a whisper.cpp
// transcript would need a model file and aligning its words with the
// script's), and syllable counting beyond letters.

/** Punctuation that opens what follows it, so it goes with the next word even after a space. */
const Opening = /^[\p{Ps}\p{Pi}¿¡"'«]/u;

/** The line's words, each { text, from, to }: its text with touching punctuation, and its UTF-16 range in text. */
export function split(text, language) {
  const words = [];
  let pending = null; // punctuation waiting for the next word, as { text, from }
  let gap = true; // whether whitespace came since the last word
  for (const { segment, index, isWordLike } of new Intl.Segmenter(language, { granularity: 'word' }).segment(text)) {
    if (isWordLike) {
      words.push({ text: (pending?.text ?? '') + segment, from: pending?.from ?? index, to: index + segment.length });
      pending = null;
      gap = false;
    } else if (!segment.trim()) {
      gap = true;
    } else if (words.length && (!gap || !Opening.test(segment))) {
      const last = words.at(-1);
      last.text += (gap ? ' ' : '') + segment;
      last.to = index + segment.length;
    } else {
      pending = { text: (pending?.text ?? '') + segment, from: pending?.from ?? index };
    }
  }
  return words;
}

/** Word times from per-character times: { characters, character_start_times_seconds, character_end_times_seconds }. */
export function fromCharacters({ characters, character_start_times_seconds: starts, character_end_times_seconds: ends }, language) {
  const owner = []; // the character each UTF-16 unit of the joined text belongs to
  characters.forEach((c, i) => owner.push(...Array(c.length).fill(i)));
  return split(characters.join(''), language).map(({ text, from, to }) => ({
    text, start: round(starts[owner[from]]), end: round(ends[owner[to - 1]]),
  }));
}

/** Loudness under which a frame counts as quiet, on voice.js's 0-to-1 scale. */
export const Quiet = 0.08;

/** The shortest quiet that splits the line into phrases, in seconds: longer than a gap between words. */
export const MinPause = 0.15;

/** Word times guessed from the line's loudness, levels, one value per frame at fps. */
export function estimate(text, levels, fps, language) {
  const words = split(text, language);
  if (!words.length) return [];
  const spans = voiced(levels, fps);
  const total = spans.reduce((sum, s) => sum + s.end - s.start, 0);
  // Positions are in voiced time: seconds of speech from the line's start, pauses left out.
  const sums = [0];
  for (const w of words) sums.push(sums.at(-1) + weight(w.text));
  const guess = (k) => (total * sums[k]) / sums.at(-1);
  const average = total / words.length; // a word's voiced seconds, on average
  const anchors = [[0, 0]]; // [word gap k, voiced position] pairs the words are spread between
  for (const pause of pauses(spans)) {
    let best;
    for (let k = anchors.at(-1)[0] + 1; k < words.length; k++) {
      // A gap after punctuation is where a speaker pauses, so it wins over one up to a word nearer.
      const off = Math.abs(guess(k) - pause);
      const cost = off - (/\p{P}$/u.test(words[k - 1].text) ? average : 0);
      if (cost <= average && (best === undefined || cost < best.cost)) best = { k, cost };
    }
    // A pause with no word gap near it is a breath inside a word, and the word runs across it.
    if (best) anchors.push([best.k, pause]);
  }
  anchors.push([words.length, total]);
  const position = [];
  for (let a = 1; a < anchors.length; a++) {
    const [[k0, p0], [k1, p1]] = [anchors[a - 1], anchors[a]];
    for (let k = k0; k < k1; k++) position[k] = p0 + ((p1 - p0) * (sums[k] - sums[k0])) / (sums[k1] - sums[k0]);
  }
  position[words.length] = total;
  return words.map((w, i) => ({ text: w.text, start: round(real(spans, position[i], true)), end: round(real(spans, position[i + 1], false)) }));
}

/** The voiced spans of a line as [{ start, end }] in seconds: loud frames, with quiets shorter than MinPause inside them. */
function voiced(levels, fps) {
  const spans = [];
  let quiet = 0; // quiet frames since the last loud one
  levels.forEach((v, f) => {
    if (v < Quiet) {
      quiet++;
    } else {
      if (!spans.length || quiet >= MinPause * fps) spans.push({ start: f / fps, end: (f + 1) / fps });
      else spans.at(-1).end = (f + 1) / fps;
      quiet = 0;
    }
  });
  return spans.length ? spans : [{ start: 0, end: Math.max(levels.length, 1) / fps }];
}

/** Where each pause falls in voiced time: the voiced seconds before it. */
function pauses(spans) {
  let sum = 0;
  return spans.slice(0, -1).map((s) => (sum += s.end - s.start));
}

/** The line time at voiced position p; on a pause, its end when `after`, else its start. */
function real(spans, p, after) {
  let sum = 0;
  for (const [i, s] of spans.entries()) {
    const length = s.end - s.start;
    const edge = sum + length; // computed as pauses() does, so a pause's position meets it exactly
    if (p < edge || (p === edge && !after) || i === spans.length - 1) return s.start + Math.min(Math.max(p - sum, 0), length);
    sum = edge;
  }
}

/** How long a word takes to say, roughly: a letter each, three for a digit (said as a word) or a CJK character (a syllable), and one for the gap. */
function weight(text) {
  let w = 1;
  for (const c of text) w += /[\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c) ? 3 : /\p{L}/u.test(c) ? 1 : 0;
  return w;
}

/** Seconds to the hundredth, as voice.json stores them. */
function round(s) {
  return Math.round(s * 100) / 100;
}
