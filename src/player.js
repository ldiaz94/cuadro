// cuadro player: plays a scene script (script.js) as a composition.
// player({ script, voice }) fetches script.json and, if there is one,
// voice/voice.json, checks the script, imports its code scenes, and plays
// every scene in order on a themed stage, cross-fading with play(). Each
// scene lasts as timing() says, and a narrated scene plays its line from
// its first frame, and the script's music, if any, plays from frame 0
// at MusicVolume, under the narration. The stage has the size of the
// script's format (16:9 unless it says), or of the page's props' format,
// so one script renders in any shape: --props '{"format":"9:16"}'.
// A code scene module's default export gets { length, levels, say, fps,
// format } and returns a view (see player.d.ts).
// Paths in the script (code modules, logos, images, the music) are relative to script.json,
// and audio files to voice.json.
// Depends on script.js, scenes.js, theme.js, audio.js and composition.js.
// Leaves out captions, music fades, any scene layout beyond play()'s, and
// sizes other than the formats'.
import { html } from 'spark';
import { audio } from './audio.js';
import { composition } from './composition.js';
import * as designed from './scenes.js';
import { check, formats, timing } from './script.js';
import { theme } from './theme.js';

/** The music's gain: low enough that the narration stays clear over it. */
export const MusicVolume = 0.2;

/**
 * Plays the script at the URL `script` with the narration listed at `voice` (null for none; a
 * missing file also means none), on a stage of its format at voice.json's fps or 30; resolves to
 * window.cuadro.
 */
export async function player({ script = 'script.json', voice = 'voice/voice.json' } = {}) {
  const scriptUrl = new URL(script, location.href);
  const voiceUrl = voice && new URL(voice, location.href);
  const source = check(await json(scriptUrl, true));
  const narration = voiceUrl ? await json(voiceUrl, false) : undefined;
  const fps = narration?.fps ?? 30;
  /** A path in the script as a URL. */
  const resolved = (path) => new URL(path, scriptUrl).href;
  const modules = await Promise.all(source.scenes.map((scene) => scene.code && import(resolved(scene.code))));
  const format = urlProps().format ?? source.format ?? '16:9';
  if (!(format in formats)) throw new Error(`cuadro: no format ${format}; try ${Object.keys(formats).join(', ')}`);
  const clips = timing(source, narration, fps).map(({ length, line }, i) => {
    const scene = source.scenes[i];
    let view;
    if (scene.code) {
      const make = modules[i].default;
      if (typeof make !== 'function') throw new Error(`cuadro: ${scene.code} must export default a function that returns a view`);
      view = make({ length, levels: line?.levels ?? [], say: scene.say, fps, format });
    } else {
      const props = { ...scene.props, length };
      if (scene.type === 'endCard') props.logo ??= source.brand?.logo;
      for (const key of ['logo', 'image']) if (props[key]) props[key] = resolved(props[key]);
      view = designed[scene.type](props);
    }
    return [length, line ? spoken(new URL(line.file, voiceUrl).href, view) : view];
  });
  const music = source.music && audio(resolved(source.music), { volume: MusicVolume });
  const scenes = designed.stage(theme(source.theme, source.brand), designed.play(...clips));
  return composition({
    ...formats[format], fps, durationInFrames: designed.playLength(...clips),
    view: music ? (frame) => html`${music(frame)}${scenes(frame)}` : scenes,
  });
}

/** The props in the page's URL (?props=<json>), which composition() reads too; read here for the format, which sets the stage's size. */
function urlProps() {
  return JSON.parse(new URLSearchParams(location.search).get('props') ?? '{}');
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
