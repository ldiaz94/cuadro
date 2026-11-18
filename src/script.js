// cuadro script: a video written as data, a list of scenes with their
// narration, and what cuadro needs to know about it before playing it.
//
//   { "theme": "light", "brand": { "accent", "accent2", "logo" },
//     "scenes": [ { "type": "stat", "props": { ... }, "say": "..." },
//                 { "code": "scenes/twin.js", "say": "..." } ] }
//
// check(script) checks a script against the schema below and names the bad
// path in its error (`scenes[2].props.items: expected an array`). Each
// designed scene type lists its props, their limits and its length without
// narration; the same table checks scripts and is shown to `cuadro make`'s
// model. lines(script) gives the `say` lines as a voice script (scene i's
// line has the id `scene<i+1>`), and timing(script, voice) each scene's
// length in frames: its line plus a little air, or the type's own length
// without narration, and never less than its beats need.
// Depends on scenes.js for its timing constants and theme.js for the theme
// names, and on nothing that needs a page, so Node and the browser both
// use it. Leaves out JSON Schema itself, defaults beyond the theme, and
// checking what a code scene draws.
import { Fade, MinBeat } from './scenes.js';
import { themes } from './theme.js';

/** Strings must hold some text; where a scene shows them, `*words*` are marked and \n breaks the line. */
const Text = { type: 'string' };
/** A brand colour. */
const Colour = { type: 'string', pattern: /^#[0-9a-f]{6}$/i, about: 'a #rrggbb colour' };
/** Any finite number. */
const Num = { type: 'number' };

/** schema, but allowed to be missing. */
const optional = (schema) => ({ ...schema, optional: true });
/** An object with exactly these keys (the optional ones may be left out). */
const object = (props) => ({ type: 'object', props });
/** An array of min to max items, each matching items. */
const array = (items, min, max = Infinity) => ({ type: 'array', items, min, max });

/** An item of a list or grid. */
const Item = object({ title: Text, text: optional(Text) });

/**
 * The designed scenes (scenes.js) a script may use: their props without `length`, how many beats
 * the props make (each needs MinBeat frames), and their length in seconds without narration.
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
  endCard: { props: object({ logo: optional(Text), line: Text, cta: optional(Text), url: optional(Text) }), beats: () => 2, seconds: 4 },
};

/** The themes a script may name; theme.js defines them. */
export const ThemeNames = Object.keys(themes);

/** A code scene's length in seconds without narration. */
const CodeSeconds = 6;

const Script = object({
  theme: optional({ type: 'string', oneOf: ThemeNames }),
  brand: optional(object({ accent: optional(Colour), accent2: optional(Colour), logo: optional(Text) })),
  scenes: array({ type: 'object' }, 1),
});
const Designed = object({ type: { type: 'string', oneOf: Object.keys(types) }, props: { type: 'object' }, say: optional(Text) });
const Code = object({
  code: { type: 'string', pattern: /^scenes\/[A-Za-z0-9_-]+\.js$/, about: 'a module path like "scenes/name.js"' },
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
  });
  return script;
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
