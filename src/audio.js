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
// recorded once.
// Depends on spark and composition.js. Leaves out fades, starting partway
// into the file, and playback speed.
import { untrack, onCleanup } from 'spark';
import { currentComposition } from './composition.js';

/** A view that plays src from its first frame until it unmounts. */
export function audio(src, { volume = 1 } = {}) {
  return (frame) => {
    const { frame: rootFrame, clips } = currentComposition();
    const url = new URL(src, document.baseURI).href;
    const from = untrack(rootFrame) - untrack(frame);
    let clip = clips.find((c) => c.src === url && c.from === from && c.volume === volume);
    if (!clip) clips.push((clip = { src: url, from, volume }));
    onCleanup(() => {
      const now = untrack(rootFrame);
      if (now > from) clip.until = now; // scrubbing back before the start is not an end
    });
    return null;
  };
}
