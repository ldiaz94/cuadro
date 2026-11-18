// cuadro player: plays a scene script (script.js) as a composition.
// player({ script, voice }) fetches script.json and, if there is one,
// voice/voice.json, checks the script, imports its code scenes, and plays
// every scene in order on a themed stage, cross-fading with play(). Each
// scene lasts as timing() says, and a narrated scene plays its line from
// its first frame, and the script's music, if any, plays from frame 0
// at MusicVolume, under the narration. A code scene module's default export gets
// { length, levels, words, say, fps } and returns a view (see player.d.ts);
// kinetic, steps and tiles get their line's words, to move as it names
// their items. With `captions: true` the narration's words are shown
// (captions.js), the scenes keep above them, and window.cuadro.captions
// lists the phrases for render.js's .srt.
// Paths in the script (code modules, the logo, the music, the font) are
// relative to script.json, and audio files to voice.json.
// Depends on script.js, scenes.js, theme.js, audio.js, captions.js and
// composition.js. Leaves out music fades, and any scene layout beyond
// play()'s.
import { html } from 'spark';
import { audio } from './audio.js';
import { CaptionBand, captions, cues } from './captions.js';
import { composition } from './composition.js';
import * as designed from './scenes.js';
import { check, timing } from './script.js';
import { theme } from './theme.js';

/** The music's gain: low enough that the narration stays clear over it. */
export const MusicVolume = 0.2;

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
  const said = []; // every spoken word, in seconds from the video's start
  let from = 0; // the frame the scene starts at
  const clips = timing(source, narration, fps).map(({ length, line }, i) => {
    const scene = source.scenes[i];
    const words = line?.words ?? [];
    said.push(...words.map((w) => ({ ...w, start: w.start + from / fps, end: w.end + from / fps })));
    from += length - designed.Fade;
    let view;
    if (scene.code) {
      const make = modules[i].default;
      if (typeof make !== 'function') throw new Error(`cuadro: ${scene.code} must export default a function that returns a view`);
      view = make({ length, levels: line?.levels ?? [], words, say: scene.say, fps });
    } else {
      const logo = scene.type === 'endCard' ? (scene.props.logo ? new URL(scene.props.logo, scriptUrl).href : brandLogo) : undefined;
      view = designed[scene.type]({ ...scene.props, ...(logo && { logo }), length, words });
    }
    return [length, line ? spoken(new URL(line.file, voiceUrl).href, view) : view];
  });
  const music = source.music && audio(new URL(source.music, scriptUrl).href, { volume: MusicVolume });
  const font = source.font && new URL(source.font, scriptUrl).href;
  const look = { ...theme(source.theme, source.brand, { font }), ...(source.captions && { '--safe-bottom': CaptionBand }) };
  const played = designed.play(...clips);
  const shown = source.captions && captions(said);
  const scenes = designed.stage(look, shown ? (frame) => html`${played(frame)}${shown(frame)}` : played);
  const cuadro = composition({
    width, height, fps, durationInFrames: designed.playLength(...clips),
    view: music ? (frame) => html`${music(frame)}${scenes(frame)}` : scenes,
  });
  if (source.captions) cuadro.captions = cues(said).map(({ start, end, text }) => ({ start, end, text }));
  return cuadro;
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
