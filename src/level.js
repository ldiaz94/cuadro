// cuadro level: the narration's loudness at a video frame, for scenes that
// move to the voice (a waveform that follows the spoken line).
// levels is a line's `levels` from voice.json, one number from 0 to 1 per
// frame. level(levels, frame) is the value at that frame, averaged with its
// two neighbours so a bar does not jitter, and 0 outside the line.
// Depends on nothing, so a page can import it. Leaves out any other
// smoothing.

/** The loudness at a frame, from 0 to 1, lightly smoothed; 0 before the first frame and after the last. */
export function level(levels, frame) {
  const f = Math.round(frame);
  if (!(f >= 0 && f < levels.length)) return 0;
  const at = (i) => levels[Math.min(Math.max(i, 0), levels.length - 1)];
  return (at(f - 1) + at(f) + at(f + 1)) / 3;
}
