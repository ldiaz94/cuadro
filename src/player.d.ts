// Types for cuadro/player, written by hand beside src/player.js.
import type { Composition, View } from './index.js';
import type { Format } from './script.js';

/**
 * Plays a scene script: fetches script.json and voice.json (null for no narration), and makes the
 * composition, sized by the script's format or by `format` in the page's ?props.
 */
export function player(options?: { script?: string; voice?: string | null }): Promise<Composition>;
/** The gain of a script's music under the narration. */
export const MusicVolume: number;

/**
 * What a code scene gets. A code scene is an ES module whose default export takes a CodeScene and
 * returns a view: `export default ({ length, levels }) => scene(length, (t) => html`...`)`.
 * scene() lays out its children in a centred column inside the frame's padding; for a freer layout,
 * place things absolutely inside a child that fills it (position: relative; flex: 1).
 * It draws inside the themed stage, so it styles with the theme's custom properties (var(--accent),
 * var(--t-2), sizes in cqmin, cqw and cqh) and may reuse the designed scenes' classes (cq-kicker,
 * cq-head, cq-display, and cq-mark with --w from 0 to 1 for its sweep). It moves for its whole
 * length, and can move to its narration with level(levels, t.frame()). It imports only from
 * 'cuadro', 'cuadro/scenes' and 'cuadro/level'.
 *
 * @example
 * import { html, interpolate } from 'cuadro';
 * import { scene } from 'cuadro/scenes';
 * import { level } from 'cuadro/level';
 *
 * export default ({ length, levels }) => scene(length, (t) => html`
 *   <p class="cq-kicker" style=${() => ({ opacity: Math.min(1, t.enter(0)), '--w': t.between(0, 20) })}>Listen</p>
 *   <h2 class="cq-display cq-head">Your voice, <span class="cq-mark" style=${() => ({ '--w': t.between(20, 40) })}>everywhere</span></h2>
 *   <div style="display: flex; align-items: center; gap: 1.2cqmin; height: 40cqh">
 *     ${Array.from({ length: 24 }, (_, i) => html`<i style=${() => ({
 *       flex: '1', borderRadius: '1cqmin', background: 'var(--accent)',
 *       height: `${(10 + 90 * level(levels, t.frame() - i)) * interpolate(t.frame(), [10 + i, 30 + i], [0, 1])}%`,
 *     })}></i>`)}
 *   </div>`);
 */
export interface CodeScene {
  /** The scene's length in frames: its line plus a little air. */
  length: number;
  /** Its line's loudness, one 0-to-1 number per frame from the scene's start; empty without narration. */
  levels: number[];
  /** Its narration line, if it has one. */
  say?: string;
  /** Frames per second. */
  fps: number;
  /** The frame's shape; a portrait (9:16) frame is narrower, so stack what sits side by side. */
  format: Format;
}
