// cuadro timeline: sequence and series, which place views in time.
// A view is a function of a frame getter, (frame) => content for a spark
// hole; both helpers take views and return views, so they nest. A sequence
// mounts its view only while the frame is inside its range, and hands it a
// local frame that starts at 0.
// Depends on spark. Leaves out per-sequence layout (wrap the view yourself)
// and transitions between clips (overlap two sequences instead).
import { computed, untrack } from 'spark';

/** Shows view from frame `from` for `duration` frames, counting its frames from 0. */
export function sequence(from, duration, view) {
  return (frame) => {
    const local = computed(() => frame() - from);
    const on = computed(() => local() >= 0 && local() < duration);
    // The hole reruns only when `on` flips, so the view mounts once per entry;
    // untrack keeps the view's own reads of the frame from remounting it.
    return () => (on() ? untrack(() => view(local)) : null);
  };
}

/** Plays [duration, view] clips back to back. */
export function series(...clips) {
  return (frame) => {
    let from = 0;
    return clips.map(([duration, view]) => {
      const clip = sequence(from, duration, view)(frame);
      from += duration;
      return clip;
    });
  };
}
