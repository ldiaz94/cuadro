// cuadro make: turns a prompt into a video's scene script, by asking a
// language model and checking what it writes.
// The model gets the script format, the catalogue of designed scenes (their
// doc comments and props from scenes.d.ts, their limits from script.js),
// the themes, and the code-scene contract (player.d.ts), and replies with
// script.json plus a module for each `code` scene. cuadro checks the script
// against its schema, writes it beside an index.html that runs the player
// in the output folder, speaks its `say` lines if there is a voice
// provider, and opens it in Chromium. A schema error, a page error, a
// failed setFrame, or a step that takes too long sends the problem (and
// the frames) back for a fix. A script that passes is shown to the model
// as stills (one per designed scene, three per code scene) for review:
// it replies OK, or a better script, which is checked again. A review request that fails is asked
// once more. It stops at OK or after `rounds` revisions, and keeps the last
// script that passed, also when a later reply or request fails; the result
// says whether the model approved it.
// The model's code runs in a tab that may load only from cuadro's server,
// which serves only the output folder and the two libraries.
// Depends on llm.js, script.js, voice.js, serve.js and chromium.js. Leaves
// out rendering the mp4 (that is `cuadro render`), editing an existing
// script, writing a whole page instead of a script, and any check of how
// good the video looks beyond the review.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepTimeout, launch, within } from './chromium.js';
import { chat } from './llm.js';
import { Fade } from './scenes.js';
import { check as checkScript, timing, types } from './script.js';
import { serve } from './serve.js';
import { theme, themes } from './theme.js';
import { voice } from './voice.js';

/** Makes <out>/script.json, its code scenes and <out>/index.html from prompt; onStep(message) reports progress. */
export async function make({
  prompt, provider, model, baseUrl, out = 'make-out', rounds = 3, root = process.cwd(),
  voiceProvider, voice: voiceName, timeout = StepTimeout, onStep = () => {},
}) {
  if (!inside(root, out)) throw new Error(`cuadro: ${out} must be a folder inside ${resolve(root)}`);
  const libs = libraries(root);
  await mkdir(join(out, 'scenes'), { recursive: true });
  await writeFile(join(out, 'index.html'), page(libs, Boolean(voiceProvider)));
  const system = await context();
  const messages = [{ role: 'user', text: request(prompt, Boolean(voiceProvider)) }];
  const ask = async () => {
    const text = await chat({ provider, model, baseUrl, system, messages });
    messages.push({ role: 'assistant', text });
    return text;
  };

  let saved; // the draft whose files are on disk
  /** Writes a draft's script and modules, speaks its lines, and resolves to its voice.json (undefined without a voice provider). */
  const save = async (draft) => {
    saved = draft;
    await writeFile(join(out, 'script.json'), draft.script);
    for (const [path, source] of Object.entries(draft.modules)) await writeFile(join(out, path), source);
    if (!voiceProvider) return undefined;
    return voice({
      script: join(out, 'script.json'), out: join(out, 'voice'), provider: voiceProvider, voice: voiceName,
      onLine: ({ id, index, total, skipped }) => onStep(`voice ${index + 1}/${total}: ${id}${skipped ? ' (unchanged)' : ''}`),
    });
  };
  /** Checks a draft against the schema, saves it, and shoots its stills in Chromium. */
  const attempt = async (draft) => {
    const script = parse(draft.script);
    if (script.problem) return script;
    const missing = script.scenes.findIndex((s) => s.code && !(s.code in draft.modules));
    if (missing >= 0) return { problem: `scenes[${missing}].code: the reply has no \`\`\`js ${script.scenes[missing].code} block` };
    const narration = await save(draft);
    return check(root, out, libs, stills(script, narration), timeout);
  };

  const { passed, reviewed } = await revise({ ask, messages, rounds, attempt, provider, onStep });
  if (saved !== passed) await save(passed);
  const file = join(out, 'script.json');
  onStep(reviewed ? `done: ${file}` : `not reviewed: ${file} passed the check, but the model did not approve it`);
  return { page: join(out, 'index.html'), file, reviewed };
}

/** The script in a draft's JSON, or { problem } if it is not JSON or breaks the schema. */
function parse(json) {
  let script;
  try {
    script = JSON.parse(json);
  } catch (e) {
    return { problem: `script.json is not JSON: ${e.message}` };
  }
  try {
    return checkScript(script);
  } catch (e) {
    return { problem: `script.json: ${e.message}` };
  }
}

/**
 * Has the model write, fix and review the script until it approves or the rounds run out; resolves
 * to { passed, reviewed }: the last draft that passed the check, and whether the model approved it.
 * A draft is { script, modules }: the JSON text and every code scene written so far, by path, so a
 * reply may leave out the modules it does not change. Once one has passed, any later failure (a reply
 * without a script, a network error) stops the loop with that draft instead of losing it.
 */
async function revise({ ask, messages, rounds, attempt, provider, onStep }) {
  let passed, problem, reviewing = false, reviewed = false, modules = {};
  try {
    for (let round = 1; round <= rounds + 1; round++) {
      onStep(`round ${round}: asking ${provider}…`);
      const reply = reviewing ? await twice(ask, (e) => onStep(`round ${round}: ${e.message.split('\n')[0]}; asking again`)) : await ask();
      const script = block(reply);
      if (reviewing && !script && approves(reply)) {
        reviewed = true;
        break;
      }
      if (!script) throw new Error('cuadro: the model replied without a ```json block holding script.json');
      modules = { ...modules, ...codeBlocks(reply) };
      const draft = { script, modules };
      const result = await attempt(draft);
      problem = result.problem;
      reviewing = !problem;
      if (reviewing) passed = draft;
      onStep(`round ${round}: ${problem ? problem.split('\n')[0] : `ok${round <= rounds ? ', reviewing' : ''}`}`);
      messages.push({ role: 'user', text: reviewing ? review(result.frames) : fix(problem), images: result.shots });
    }
  } catch (e) {
    if (!passed) throw e;
    onStep(`stopped: ${e.message.split('\n')[0]}; keeping the last script that passed`);
  }
  if (!passed) throw new Error(`cuadro: no script.json passed the check in ${rounds + 1} tries; the last problem:\n${problem}`);
  return { passed, reviewed };
}

/** Calls request, and once more if it fails, after telling retrying(error). */
async function twice(request, retrying) {
  try {
    return await request();
  } catch (e) {
    retrying(e);
    return await request();
  }
}

/** Whether a review reply approves: no code block, and the word OK at its start or its end. */
function approves(reply) {
  const text = reply.trim();
  return !text.includes('```') && (/^OK\b/.test(text) || /\bOK[.!]?$/.test(text));
}

/** The contents of the first ```json block in a reply, or undefined. */
function block(reply) {
  return reply.match(/```json[^\n]*\n([\s\S]*?)```/)?.[1];
}

/** The reply's code scenes, by path: each ```js block named scenes/<name>.js, after the fence or on its first line as a comment. */
function codeBlocks(reply) {
  const found = {};
  for (const [, info, body] of reply.matchAll(/```(?:js|javascript)([^\n]*)\n([\s\S]*?)```/g)) {
    const path = info.match(ScenePath)?.[0] ?? body.match(FirstLinePath)?.[1];
    if (path) found[path] = body;
  }
  return found;
}

/** A code scene's path, as the schema allows it; and the same as a comment on a block's first line. */
const ScenePath = /scenes\/[A-Za-z0-9_-]+\.js/;
const FirstLinePath = /^\s*\/\/\s*(scenes\/[A-Za-z0-9_-]+\.js)/;

/** Where to take the review's stills in a designed scene (when its beats have mostly arrived) and in a code scene (to show it change), as parts of its length. */
const DesignedStills = [0.75];
const CodeStills = [0.25, 0.55, 0.85];

/** The frames to review, by scene. */
function stills(script, narration) {
  let from = 0;
  return timing(script, narration, narration?.fps ?? 30).flatMap(({ length }, i) => {
    const frames = (script.scenes[i].code ? CodeStills : DesignedStills).map((q) => from + Math.round(q * length));
    from += length - Fade;
    return frames;
  });
}

/** The system prompt: the script format, the scene catalogue, the themes and the code-scene contract. */
async function context() {
  const read = (file) => readFile(new URL(file, import.meta.url), 'utf8');
  const [scenesTypes, playerTypes, levelTypes, indexTypes] = await Promise.all(['./scenes.d.ts', './player.d.ts', './level.d.ts', './index.d.ts'].map(read));
  const sparkTypes = await readFile(new URL('./index.d.ts', import.meta.resolve('spark')), 'utf8');
  return `You make short explainer videos with cuadro by writing a scene script: JSON that lists designed
scenes in order, each with its line of narration. cuadro checks the script, speaks the lines, makes
each scene as long as its line, and plays the scenes one after another with cross-fades on a themed
1280x720 stage.

# Your reply

One \`\`\`json block holding script.json. For each code scene, also one \`\`\`js block whose fence names
its path (\`\`\`js scenes/orbit.js) and holds the whole module. Nothing else in the reply is read.

# The script

{ "theme": "light", "brand": { "accent": "#rrggbb", "accent2": "#rrggbb", "logo": "logo.svg" },
  "scenes": [ { "type": "title", "props": { ... }, "say": "..." },
              { "code": "scenes/name.js", "say": "..." } ] }

- theme: one of these (all scenes share it):
${Object.entries(themes).map(([name, t]) => `  - ${name}: background ${t['--bg']}, text ${t['--ink']}, accents ${t['--accent']} and ${t['--accent2']}, headings in ${t['--font-display'].split(',')[0]}`).join('\n')}
- brand (optional): accent and accent2 replace the theme's accents; pick the brand's own colours
  when you know them, and make sure accent reads well on the theme's background. logo is an image
  path relative to script.json: give it only if the request names one.
- scenes: designed scenes ({ type, props, say }) or code scenes ({ code, say }); no other keys.
- say: the words spoken over that scene, one or two natural sentences. The scene lasts as long as
  its line (about 2.5 words a second), so the lines set the video's length.

# Writing a good video

- Five to seven scenes, telling a story: a hook (a kinetic or title scene that names the viewer's
  problem), why it matters (a stat with a real figure, or kinetic lines), how it works (steps), the
  one idea that sets this apart (often the code scene), what you get (tiles), and an endCard.
- Put key words on screen, never the narration itself: headlines of a few words, item titles of
  one to three words, item texts of at most five. Mark one or two key words per headline with
  *asterisks*.
- Vary the scenes: don't use the same type twice in a row.
- Use only facts the request gives or that you are sure of; never invent figures for a stat scene.
- Prefer designed scenes; they are tested and look good. Write a code scene (at most two) only when
  an idea needs something visual the designed scenes cannot show: a transformation, a flow between
  things, a metaphor drawn with shapes. Make it the video's memorable moment: a full composition
  that keeps moving for its whole length and follows its narration line, not a slide of text.
- A code scene fills the frame as the designed ones do: its main visual spans most of the width and
  at least half the height, and its labels are var(--t-3) or larger. Plan it as three or four beats
  across its length (beats(length, n) from cuadro/scenes), each adding or changing something as the
  line says it (a headline that changes, a new element arriving, a highlight moving), so it tells a
  small story. Make the narration visible: something that pulses or a waveform of bars driven by
  level(levels, t.frame()).

# Designed scenes

Each scene's props, as TypeScript (cuadro adds \`length\` itself; never give it):

${catalogue(scenesTypes)}

# Code scenes

\`\`\`ts
${playerTypes.slice(playerTypes.indexOf('/**\n * What a code scene gets'))}\`\`\`

The theme's custom properties: ${Object.keys(theme()).join(' ')}.

Rules: draw only from the frame. Never use Date.now, Math.random, requestAnimationFrame, setTimeout,
CSS animations or transitions. Use no network resources. Fonts: var(--font-display) and
var(--font-body). Keep everything inside the frame and text at least var(--t-small).

cuadro/scenes (src/scenes.d.ts):

\`\`\`ts
${scenesTypes}\`\`\`

cuadro/level (src/level.d.ts):

\`\`\`ts
${levelTypes}\`\`\`

cuadro (src/index.d.ts), which re-exports spark:

\`\`\`ts
${indexTypes}\`\`\`

spark:

\`\`\`ts
${sparkTypes}\`\`\`
`;
}

/** Each designed scene type: its doc comment and props from scenes.d.ts, and the limits script.js checks. */
function catalogue(dts) {
  const shared = dts.slice(dts.indexOf('/** Text where'), dts.indexOf('/** A kicker'));
  const scenes = Object.entries(types).map(([name, { props, seconds }]) => {
    const found = dts.match(new RegExp(`/\\*\\* (.*) \\*/\\nexport function ${name}\\(props: (\\{[\\s\\S]*?\\})\\): View;`));
    if (!found) throw new Error(`cuadro: scenes.d.ts has no ${name}(props)`);
    const limits = Object.entries(props.props).filter(([, p]) => p.type === 'array').map(([key, p]) => `${key}: ${p.min} to ${p.max} items`);
    const shape = found[2].replace(/length: number;\s*/, '').replace(/\s+/g, ' ');
    return `// ${found[1].replace(/\.$/, '')}${limits.length ? ` (${limits.join('; ')})` : ''}; ${seconds} s without narration\n"${name}": ${shape}`;
  });
  return `\`\`\`ts\n${shared}\n${scenes.join('\n\n')}\n\`\`\``;
}

/** The first user message: the prompt, and whether the lines will be spoken. */
function request(prompt, narrated) {
  return `Write script.json for this video:\n\n${prompt}\n\n${narrated
    ? 'It is narrated: every scene needs a say line.'
    : 'It is not narrated yet, so each scene lasts its type\'s default length; still write a say line for each scene.'}\n`;
}

/** The user message after a failed check. */
function fix(problem) {
  return `The script failed cuadro's check:\n\n${problem}\n\nReply with the whole fixed script.json in one \`\`\`json block, and any code scene you change.`;
}

/** The user message after a passed check, sent with the stills. */
function review(frames) {
  return `It runs. These are stills at frames ${frames.join(', ')}: one per designed scene, three per code scene.
Look for text that is cut off, overlaps or is too small, empty or unbalanced frames, and code scenes
that don't show their idea clearly. If the video matches the request and looks finished, reply with
just OK. Otherwise reply with the whole corrected script.json in one \`\`\`json block, and any code
scene you change.`;
}

/** Where cuadro's and spark's entry modules are, as paths under root: the copies this module itself runs with. */
function libraries(root) {
  const under = (url) => {
    const file = fileURLToPath(url);
    if (!inside(root, file)) throw new Error(`cuadro: ${file} is outside ${resolve(root)}, so the browser cannot load it; install cuadro there (npm install cuadro)`);
    return relative(resolve(root), file).split(sep).join('/');
  };
  return { cuadro: under(new URL('./index.js', import.meta.url)), spark: under(import.meta.resolve('spark')) };
}

/** Whether path is inside the directory root (and is not root itself). */
function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

/** index.html: an import map for cuadro's modules and spark, and the player, with or without voice/voice.json. */
function page(libs, narrated) {
  const src = '/' + dirname(libs.cuadro);
  const imports = { cuadro: '/' + libs.cuadro, spark: '/' + libs.spark };
  for (const name of ['theme', 'scenes', 'level', 'player']) imports[`cuadro/${name}`] = `${src}/${name}.js`;
  return `<!doctype html>
<meta charset="utf-8">
<title>cuadro make</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">
  import { player } from 'cuadro/player';
  await player(${narrated ? '' : '{ voice: null }'});
</script>
`;
}

/** How long to wait for the page to call composition, in milliseconds. */
const LoadTimeout = 10000;

// TODO: once render.js's still() is merged, shoot the review's stills with it instead of shoot() below.
/**
 * Opens out/index.html and shoots the given frames; resolves to { problem, shots, frames } (problem undefined if it passed).
 * The model's code runs here, so the server serves only out and the two libraries, and the tab may load
 * nothing from any other origin.
 */
async function check(root, out, libs, frames, timeout) {
  let server, browser;
  try {
    server = await serve(root, { allow: [relative(root, out), dirname(libs.cuadro), dirname(libs.spark)] });
    browser = await launch();
    const tab = await browser.newPage();
    await tab.route('**', (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
    const url = new URL(relative(resolve(root), resolve(out, 'index.html')).split(sep).join('/'), server.origin + '/');
    return await shoot(tab, `${url.href}?render`, frames, timeout);
  } finally {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }
}

/** Loads url in tab and shoots the frames, each step within timeout; any failure is the problem. */
async function shoot(tab, url, frames, timeout) {
  const errors = [];
  const shots = [];
  const failure = (why) => ({ problem: [...errors, why].filter(Boolean).join('\n'), shots });
  const broke = new Promise((ok) => tab.on('pageerror', ok)); // ends the wait for composition()
  tab.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  tab.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`HTTP ${r.status()} for ${r.url()}`));
  try {
    await within(tab.goto(url), timeout, 'loading the page');
    if (errors.length) return failure();
    const loaded = tab.waitForFunction(() => window.cuadro, null, { timeout: LoadTimeout }).then(() => true, () => false);
    if (!(await Promise.race([loaded, broke.then(() => false)]))) return failure('composition() was never called');
    const { width, height, durationInFrames: total } = await within(tab.evaluate(() => window.cuadro), timeout, 'reading window.cuadro');
    await tab.setViewportSize({ width, height });
    const shown = frames.map((n) => Math.min(n, total - 1));
    for (const n of shown) {
      await within(tab.evaluate((n) => window.cuadro.setFrame(n), n), timeout, `setFrame(${n})`);
      if (errors.length) return failure();
      shots.push(await tab.screenshot({ clip: { x: 0, y: 0, width, height } }));
    }
    return { shots, frames: shown };
  } catch (e) {
    return failure(e.message);
  }
}
