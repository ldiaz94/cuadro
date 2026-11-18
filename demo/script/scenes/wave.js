// A code scene for the script demo: a row of bars that rise in turn and
// move to the scene's narration line, under a headline with a marked word.
// Without narration (levels is empty) the bars breathe on their own. Its
// text comes from the script's props, so translate reaches it.
// Depends on cuadro, cuadro/scenes and cuadro/level.
import { html, interpolate } from 'cuadro';
import { scene } from 'cuadro/scenes';
import { level } from 'cuadro/level';

/** How many bars there are. */
const Bars = 24;

/** The scene: props.kicker, then props.title with props.mark swept under it, over the bars. */
export default ({ length, levels, props }) => scene(length, (t) => {
  /** Bar i's height from 0 to 1: the voice a little later for each bar, or a slow wave without one. */
  const loud = (i) => (levels.length ? level(levels, t.frame() - i) : 0.5 + 0.4 * Math.sin(t.frame() / 9 + i / 2));
  return html`
    <p class="cq-kicker" style=${() => ({ opacity: Math.min(1, t.enter(0)), '--w': t.between(0, 20) })}>${props.kicker}</p>
    <h2 class="cq-display cq-head">${props.title} <span class="cq-mark" style=${() => ({ '--w': t.between(20, 40) })}>${props.mark}</span></h2>
    <div style="display: flex; align-items: center; gap: 1.2cqmin; height: 40cqh">
      ${Array.from({ length: Bars }, (_, i) => html`<i style=${() => ({
        flex: '1', borderRadius: '1cqmin', background: `color-mix(in srgb, var(--accent) ${Math.round((100 * i) / (Bars - 1))}%, var(--accent2))`,
        height: `${(10 + 90 * loud(i)) * interpolate(t.frame(), [10 + i, 30 + i], [0, 1])}%`,
      })}></i>`)}
    </div>`;
});
