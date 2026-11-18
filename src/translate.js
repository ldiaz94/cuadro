// cuadro translate: a scene script in another language.
// translate({ script, to, provider }) sends a language model the script's
// words, its `say` lines and every scene's text props (code scenes keep
// what they show in props too), as one JSON array, and puts the
// translations back in place. Everything else stays: the structure, the
// brand, the numbers, logos, images and the code scenes' modules. It sets `language` and writes
// script.<to>.json beside the script, so the paths in it still resolve.
// Depends on llm.js and script.js. Leaves out text a code scene writes in
// its module rather than its props, and checking the translation beyond
// its shape.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { chat } from './llm.js';
import { check } from './script.js';

/** Translates the script file into the language `to` (BCP-47) and writes script.<to>.json beside it; resolves to its path. */
export async function translate({ script, to, provider, model, baseUrl }) {
  const [language] = Intl.getCanonicalLocales(to);
  const source = check(JSON.parse(await readFile(script, 'utf8')));
  const slots = texts(source);
  const reply = await chat({ provider, model, baseUrl, system: System, messages: [{ role: 'user', text: request(slots.map((s) => s.get()), language) }] });
  const translated = parse(reply, slots.length);
  slots.forEach((slot, i) => slot.set(translated[i]));
  source.language = language;
  check(source);
  const file = join(dirname(script), `${basename(script, extname(script))}.${language}.json`);
  await writeFile(file, JSON.stringify(source, null, 2) + '\n');
  return file;
}

/** The props that are paths, not words. */
const Paths = ['logo', 'image'];

/** Every string to translate, as { get, set }: each scene's text props (by depth), then its say line. */
function texts(script) {
  const slots = [];
  const walk = (holder, key) => {
    const value = holder[key];
    if (typeof value === 'string' && !Paths.includes(key)) slots.push({ get: () => holder[key], set: (v) => (holder[key] = v) });
    else if (value && typeof value === 'object') for (const k of Object.keys(value)) walk(value, k);
  };
  for (const scene of script.scenes) {
    if (scene.props) walk(scene, 'props');
    if (scene.say) walk(scene, 'say');
  }
  return slots;
}

/** What the model is told it is doing. */
const System = 'You translate the words of a short explainer video: its narration lines and the short texts on screen.';

/** The request: the strings as a JSON array, and how to translate them. */
function request(strings, language) {
  const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(language);
  return `Translate each string of this JSON array into ${name} (${language}), as a native speaker would say it.

- Keep the same number of strings, in the same order.
- Screen texts are short headlines and labels: keep them as short. Keep *asterisks* around the
  translation of the words they mark, and keep \\n line breaks.
- Where a screen text repeats words of a narration line, translate those words the same way in
  both, so the screen still matches what is said.
- Keep brand and product names, URLs and numbers as they are.

Reply with one \`\`\`json block holding the array of ${strings.length} translated strings.

\`\`\`json
${JSON.stringify(strings, null, 2)}
\`\`\``;
}

/** The translated strings from the reply's ```json block, or an error if they are not `count` non-empty strings. */
function parse(reply, count) {
  const json = reply.match(/```json[^\n]*\n([\s\S]*?)```/)?.[1];
  if (!json) throw new Error('cuadro: the translation came without a ```json block');
  const list = JSON.parse(json);
  if (!Array.isArray(list) || list.length !== count || !list.every((s) => typeof s === 'string' && s.trim())) {
    throw new Error(`cuadro: the translation must be ${count} non-empty strings, not ${JSON.stringify(list).slice(0, 200)}`);
  }
  return list;
}
