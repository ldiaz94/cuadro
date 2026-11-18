// cuadro audio: a view that adds a sound file to the video.
// When it mounts it records { src, from, until, volume } in
// window.cuadro.clips, and render.js mixes the clips into the mp4:
//
//   src     the file's URL, resolved against the page's
//   from    the composition frame at which the view's local frame is 0
//   until   the composition frame at which it unmounted (absent if it
//           never did); the clip stops there, or where the file ends
//   volume  a gain, 1 as recorded
//
// A clip mounted again at the same frame (a preview scrubbed back) is
// recorded once. In a preview the view is also an <audio> element that
// plays and pauses with the bar, and seeks to its local frame when you
// scrub; a render never plays it.
// Depends on spark and composition.js. Leaves out fades, starting partway
// into the file, playback speed, and a volume above 1 in the preview (the
// element cannot amplify).
import { effect, untrack, onCleanup } from 'spark';
import { currentComposition } from './composition.js';

/** A view that plays src from its first frame until it unmounts. */
export function audio(src, { volume = 1 } = {}) {
  return (frame) => {
    const { frame: rootFrame, fps, clips, playing } = currentComposition();
    const url = new URL(src, document.baseURI).href;
    const from = untrack(rootFrame) - untrack(frame);
    let clip = clips.find((c) => c.src === url && c.from === from && c.volume === volume);
    if (!clip) clips.push((clip = { src: url, from, volume }));
    onCleanup(() => {
      const now = untrack(rootFrame);
      if (now > from) clip.until = now; // scrubbing back before the start is not an end
    });
    return playing ? player(url, volume, frame, fps, playing) : null;
  };
}

/** An <audio> element for the preview that follows the bar and the frame. */
function player(src, volume, frame, fps, playing) {
  const el = new Audio(src);
  el.volume = Math.min(volume, 1);
  effect(() => {
    if (playing()) {
      el.currentTime = untrack(frame) / fps; // also when it mounts during play
      el.play().catch(() => {}); // the browser may refuse before a click; stay silent
    } else {
      el.pause();
    }
  });
  effect(() => {
    const at = frame() / fps;
    if (!untrack(playing)) el.currentTime = at; // a scrub
  });
  onCleanup(() => el.pause()); // a detached element would play on
  return el;
}
