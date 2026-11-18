// cuadro script: a video written as data, a list of scenes with their
// narration, and what cuadro needs to know about it before playing it.
//
//   { "format": "16:9", "theme": "light", "brand": { "accent", "accent2", "logo" },
//     "music": "music.wav", "language": "es", "captions": true,
//     "font": "fonts/noto-sans-jp.woff2",
//     "scenes": [ { "type": "stat", "props": { ... }, "say": "..." },
//                 { "code": "scenes/twin.js", "props": { ... }, "say": "..." } ] }
//
// check(script) checks a script against the schema below and names the bad
// path in its error (`scenes[2].props.items: expected an array`). It also
// fails a script whose on-screen text (or `say` lines, with captions) has
// letters beyond the bundled fonts' Latin set, unless it names a `font` to
// fall back to, so no text renders as empty boxes or in whatever font the
// machine has. Each
// designed scene type lists its props, their limits and its length without
// narration; the same table checks scripts and is shown to `cuadro make`'s
// model. lines(script) gives the `say` lines as a voice script (scene i's
// line has the id `scene<i+1>`), and timing(script, voice) each scene's
// length in frames: its line plus a little air, or the type's own length
// without narration, and never less than its beats need.
// Depends on scenes.js for its timing constants and theme.js for the theme
// names, and on nothing that needs a page, so Node and the browser both
// use it. Leaves out JSON Schema itself, defaults beyond the theme and format, and
// checking what a code scene draws.
import { Fade, MinBeat } from './scenes.js';
import { themes } from './theme.js';

/** Strings must hold some text; where a scene shows them, `*words*` are marked and \n breaks the line. */
const Text = { type: 'string' };
/** A brand colour. */
const Colour = { type: 'string', pattern: /^#[0-9a-f]{6}$/i, about: 'a #rrggbb colour' };
/** Any finite number. */
const Num = { type: 'number' };
/** true or false. */
const Bool = { type: 'boolean' };

/** schema, but allowed to be missing. */
const optional = (schema) => ({ ...schema, optional: true });
/** An object with exactly these keys (the optional ones may be left out). */
const object = (props) => ({ type: 'object', props });
/** An array of min to max items, each matching items. */
const array = (items, min, max = Infinity) => ({ type: 'array', items, min, max });

/** An item of a list or grid. */
const Item = object({ title: Text, text: optional(Text) });
/** A row of an app's screen. */
const Row = object({ kind: optional({ type: 'string', oneOf: ['item', 'sent', 'received', 'profile'] }), title: Text, text: optional(Text) });
/** A side of a comparison. */
const Side = object({ label: Text, items: array(Text, 1, 4) });

/**
 * The designed scenes (scenes.js) a script may use: their props without `length`, how many beats
 * the props make (each needs MinBeat frames), their length in seconds without narration, and, for
 * some, a rule across props that returns what is wrong.
 */
export const types = {
  title: { props: object({ kicker: optional(Text), title: Text, sub: optional(Text) }), beats: () => 3, seconds: 4 },
  kinetic: { props: object({ lines: array(Text, 2, 4) }), beats: (p) => p.lines.length, seconds: 5 },
  stat: {
    props: object({ title: optional(Text), stats: array(object({ value: Num, prefix: optional(Text), suffix: optional(Text), label: Text }), 1, 3) }),
    beats: (p) => p.stats.length, seconds: 4.5,
  },
  steps: { props: object({ title: optional(Text), items: array(Item, 2, 5) }), beats: (p) => p.items.length, seconds: 6 },
  tiles: { props: object({ title: optional(Text), items: array(Item, 2, 6) }), beats: (p) => p.items.length, seconds: 5.5 },
  app: {
    props: object({ title: optional(Text), device: optional({ type: 'string', oneOf: ['phone', 'browser'] }), image: optional(Text), rows: optional(array(Row, 2, 4)) }),
    beats: (p) => p.rows?.length ?? 2, seconds: 5.5, rule: (p) => !p.image === !p.rows && 'give image or rows, not both',
  },
  quote: { props: object({ quote: Text, name: Text, role: optional(Text), image: optional(Text) }), beats: () => 2, seconds: 5 },
  compare: { props: object({ title: optional(Text), left: Side, right: Side }), beats: () => 3, seconds: 6 },
  endCard: { props: object({ logo: optional(Text), line: Text, cta: optional(Text), url: optional(Text) }), beats: () => 2, seconds: 4 },
};

/** The themes a script may name; theme.js defines them. */
export const ThemeNames = Object.keys(themes);

/**
 * The frame shapes a script may ask for, and their sizes: 720 pixels on the short side, so a portrait
 * video has the landscape one's text sizes and its render time.
 */
export const formats = { '16:9': { width: 1280, height: 720 }, '9:16': { width: 720, height: 1280 } };

/** A code scene's length in seconds without narration. */
const CodeSeconds = 6;

const Script = object({
  format: optional({ type: 'string', oneOf: Object.keys(formats) }),
  theme: optional({ type: 'string', oneOf: ThemeNames }),
  brand: optional(object({ accent: optional(Colour), accent2: optional(Colour), logo: optional(Text) })),
  music: optional(Text),
  language: optional({ type: 'string', pattern: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, about: 'a BCP-47 language code like "es" or "pt-BR"' }),
  captions: optional(Bool),
  font: optional({ type: 'string', pattern: /\.(woff2?|ttf|otf)$/i, about: 'a font file (.woff2, .woff, .ttf or .otf)' }),
  scenes: array({ type: 'object' }, 1),
});
const Designed = object({ type: { type: 'string', oneOf: Object.keys(types) }, props: { type: 'object' }, say: optional(Text) });
const Code = object({
  code: { type: 'string', pattern: /^scenes\/[A-Za-z0-9_-]+\.js$/, about: 'a module path like "scenes/name.js"' },
  props: optional({ type: 'object' }),
  say: optional(Text),
});

/** Returns script if it matches the schema; otherwise throws, naming the first bad path. */
export function check(script) {
  match(script, Script, '');
  script.scenes.forEach((scene, i) => {
    const at = `scenes[${i}]`;
    if ('code' in scene) return match(scene, Code, at);
    match(scene, Designed, at);
    match(scene.props, types[scene.type].props, `${at}.props`);
    const wrong = types[scene.type].rule?.(scene.props);
    if (wrong) throw new Error(`${at}.props: ${wrong}`);
  });
  if (!script.font) script.scenes.forEach((scene, i) => {
    if (scene.props) covered(scene.props, `scenes[${i}].props`);
    if (scene.say && script.captions) covered(scene.say, `scenes[${i}].say`);
  });
  return script;
}

/** The letters the bundled fonts draw: Latin-1's, and the few Latin Extended ones they have. */
const Drawn = /[\u0000-\u00ff\u0131\u0152\u0153]/;

/** Throws if a string in value (a prop or a line; the logo and image paths aside) has a letter the bundled fonts lack. */
function covered(value, path) {
  if (typeof value === 'string') {
    const missing = [...value].find((c) => /\p{L}/u.test(c) && !Drawn.test(c));
    if (missing) throw new Error(`${path}: "${missing}" is not in cuadro's fonts (Latin only); set "font" to a font file that has it, such as a Noto Sans`);
  } else if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) if (!['logo', 'image'].includes(key)) covered(v, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`);
  }
}

/** Throws unless value matches schema; path names value in the message. */
function match(value, schema, path) {
  const fail = (expected) => {
    throw new Error(`${path || 'script'}: expected ${expected}`);
  };
  const { type } = schema;
  if (type === 'string') {
    if (typeof value !== 'string' || !value.trim()) fail(schema.about ?? 'a non-empty string');
    if (schema.pattern && !schema.pattern.test(value)) fail(schema.about);
    if (schema.oneOf && !schema.oneOf.includes(value)) fail(`one of ${schema.oneOf.join(', ')}, not ${JSON.stringify(value)}`);
  } else if (type === 'number') {
    if (!Number.isFinite(value)) fail('a number');
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') fail('true or false');
  } else if (type === 'array') {
    if (!Array.isArray(value)) fail('an array');
    const { min, max } = schema;
    if (value.length < min || value.length > max) fail(max === Infinity ? `at least ${min} items` : `${min} to ${max} items, not ${value.length}`);
    value.forEach((v, i) => match(v, schema.items, `${path}[${i}]`));
  } else if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('an object');
    if (!schema.props) return;
    const at = (key) => (path ? `${path}.${key}` : key);
    for (const key of Object.keys(value)) {
      if (!(key in schema.props)) throw new Error(`${at(key)}: unknown key; expected ${Object.keys(schema.props).join(', ')}`);
    }
    for (const [key, sub] of Object.entries(schema.props)) {
      if (value[key] === undefined) {
        if (!sub.optional) throw new Error(`${at(key)}: missing`);
      } else match(value[key], sub, at(key));
    }
  }
}

/** The id of scene i's line in the voice script and voice.json. */
export const lineId = (i) => `scene${i + 1}`;

/** The script's `say` lines as a voice script: { lines: [{ id, text }] }. */
export function lines(script) {
  return { lines: script.scenes.flatMap((scene, i) => (scene.say ? [{ id: lineId(i), text: scene.say }] : [])) };
}

/** Frames of quiet after a scene's line, past the cross-fade into the next scene. */
export const Air = 20;

/** Frames the last scene holds after its line, as nothing follows it. */
export const Hold = 45;

/**
 * Each scene's { length, line }: line is its entry in voice.json (undefined without one) and length
 * is the line's frames plus Air (Hold for the last scene), or the type's seconds without a line;
 * never less than 2 seconds or what the scene's beats need.
 */
export function timing(script, voice, fps = 30) {
  const spoken = new Map((voice?.lines ?? []).map((line) => [line.id, line]));
  return script.scenes.map((scene, i) => {
    const line = scene.say ? spoken.get(lineId(i)) : undefined;
    const last = i === script.scenes.length - 1;
    const wanted = line ? Math.ceil(line.seconds * fps) + (last ? Hold : Air) : Math.round((scene.code ? CodeSeconds : types[scene.type].seconds) * fps);
    const beats = scene.code ? 1 : types[scene.type].beats(scene.props);
    return { length: Math.max(wanted, 2 * fps, beats * MinBeat + Fade), line };
  });
}
