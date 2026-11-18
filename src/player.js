// cuadro player: plays a scene script (script.js) as a composition.
// player({ script, voice }) fetches script.json and, if there is one,
// voice/voice.json, checks the script, imports its code scenes, and plays
// every scene in order on a themed stage, cross-fading with play(). Each
// scene lasts as timing() says, and a narrated scene plays its line from
// its first frame. A code scene module's default export gets
// { length, levels, say, fps } and returns a view (see player.d.ts).
// Paths in the script (code modules, the logo) are relative to script.json,
// and audio files to voice.json.
// Depends on script.js, scenes.js, theme.js, audio.js and composition.js.
// Leaves out music, captions and any scene layout beyond play()'s.
import { html } from 'spark';
import { audio } from './audio.js';
import { composition } from './composition.js';
import * as designed from './scenes.js';
import { check, timing } from './script.js';
import { theme } from './theme.js';

/**
 * Plays the script at the URL `script` with the narration listed at `voice` (null for none; a
 * missing file also means none), on a width x height stage at voice.json's fps or 30; resolves to
 * window.cuadro.
 */
export async function player({ script = 'script.json', voice = 'voice/voice.json', width = 1280, height = 720 } = {}) {
  const scriptUrl = new URL(script, location.href);
  const voiceUrl = voice && new URL(voice, location.href);
  const source = check(await json(scriptUrl, true));
  const narration = voiceUrl ? await json(voiceUrl, false) : undefined;
  const fps = narration?.fps ?? 30;
  const modules = await Promise.all(source.scenes.map((scene) => scene.code && import(new URL(scene.code, scriptUrl).href)));
  const brandLogo = source.brand?.logo && new URL(source.brand.logo, scriptUrl).href;
  const clips = timing(source, narration, fps).map(({ length, line }, i) => {
    const scene = source.scenes[i];
    let view;
    if (scene.code) {
      const make = modules[i].default;
      if (typeof make !== 'function') throw new Error(`cuadro: ${scene.code} must export default a function that returns a view`);
      view = make({ length, levels: line?.levels ?? [], say: scene.say, fps });
    } else {
      const logo = scene.type === 'endCard' ? (scene.props.logo ? new URL(scene.props.logo, scriptUrl).href : brandLogo) : undefined;
      view = designed[scene.type]({ ...scene.props, ...(logo && { logo }), length });
    }
    return [length, line ? spoken(new URL(line.file, voiceUrl).href, view) : view];
  });
  return composition({
    width, height, fps, durationInFrames: designed.playLength(...clips),
    view: (frame) => designed.stage(theme(source.theme, source.brand), designed.play(...clips))(frame),
  });
}

/** view with the audio file src playing from its first frame. */
function spoken(src, view) {
  return (frame) => html`${audio(src)(frame)}${view(frame)}`;
}

/** The JSON at url; if it is missing, an error when needed, else undefined. */
async function json(url, needed) {
  const res = await fetch(url);
  if (res.ok) return res.json();
  if (needed) throw new Error(`cuadro: could not load ${url.pathname}: HTTP ${res.status}`);
  return undefined;
}
