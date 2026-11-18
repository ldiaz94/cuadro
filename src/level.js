// cuadro level: the narration at a video frame: how loud it is, for scenes
// that move to the voice (a waveform that follows the spoken line), and
// which word is being said, for scenes that light things up as they are
// named.
// levels is a line's `levels` from voice.json, one number from 0 to 1 per
// frame. level(levels, frame) is the value at that frame, averaged with its
// two neighbours so a bar does not jitter, and 0 outside the line.
// words is a line's `words`, [{ text, start, end }] in seconds; word(words,
// frame, fps) is the index of the word being said.
// Depends on nothing, so a page can import it. Leaves out any other
// smoothing.

/** The loudness at a frame, from 0 to 1, lightly smoothed; 0 before the first frame and after the last. */
export function level(levels, frame) {
  const f = Math.round(frame);
  if (!(f >= 0 && f < levels.length)) return 0;
  const at = (i) => levels[Math.min(Math.max(i, 0), levels.length - 1)];
  return (at(f - 1) + at(f) + at(f + 1)) / 3;
}

/** The index of the word being said at a frame: the last one started by then (so it holds through pauses); -1 before the first. */
export function word(words, frame, fps) {
  const seconds = frame / fps;
  let i = -1;
  while (i + 1 < words.length && words[i + 1].start <= seconds) i++;
  return i;
}
