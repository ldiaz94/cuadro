// cuadro make: turns a prompt into a video's source, by asking a language
// model and checking what it writes.
// The model gets cuadro's types and the README's "Learn it" section, and
// replies with a whole video.js. cuadro writes it beside an index.html in
// the output folder and opens it in Chromium. A page error, a failed
// setFrame, or a step that takes too long sends the problem (and the
// frames) back for a fixed file. A file that passes is shown to the model
// as five frames, for one review (with a note if they are all the same):
// it replies OK, or a better file, which is checked again. A review
// request that fails is asked once more. It stops at OK or after `rounds`
// revisions, and keeps the last file that passed, also when a later reply
// or request fails; the result says whether the model approved that file.
// The model's code runs in a tab that may load only from cuadro's server,
// which serves only the output folder and the two libraries.
// With a voice provider it first asks for a narration script, speaks it
// with voice.js, and has the video follow the lines' lengths.
// Depends on llm.js, voice.js, serve.js and chromium.js. Leaves out
// rendering the mp4 (that is `cuadro render`), editing an existing
// video.js, and any check of how good the video looks beyond the review.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StepTimeout, launch, within } from './chromium.js';
import { chat } from './llm.js';
import { serve } from './serve.js';
import { voice } from './voice.js';

/** Makes <out>/video.js and <out>/index.html from prompt; onStep(message) reports progress. */
export async function make({
  prompt, provider, model, baseUrl, out = 'make-out', rounds = 3, root = process.cwd(),
  voiceProvider, voice: voiceName, timeout = StepTimeout, onStep = () => {},
}) {
  if (!inside(root, out)) throw new Error(`cuadro: ${out} must be a folder inside ${resolve(root)}`);
  const libs = libraries(root);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'index.html'), page(libs));
  const system = await context();
  const messages = [];
  const ask = async () => {
    const text = await chat({ provider, model, baseUrl, system, messages });
    messages.push({ role: 'assistant', text });
    return text;
  };

  const narration = voiceProvider && await narrate({ prompt, out, ask, messages, voiceProvider, voiceName, provider, onStep });
  messages.push({ role: 'user', text: request(prompt, narration) });
  const file = join(out, 'video.js');
  const { passed, reviewed } = await revise({ ask, messages, rounds, file, check: () => check(root, out, libs, timeout), provider, onStep });
  await writeFile(file, passed);
  onStep(reviewed ? `done: ${file}` : `not reviewed: ${file} passed the check, but the model did not approve it`);
  return { page: join(out, 'index.html'), file, reviewed };
}

/**
 * Has the model write, fix and review file until it approves or the rounds run out; resolves to
 * { passed, reviewed }: the last source that passed the check, and whether the model approved it. Once
 * one has passed, any later failure (a reply without code, a network error) stops the loop with that
 * source instead of losing it.
 */
async function revise({ ask, messages, rounds, file, check, provider, onStep }) {
  let passed, problem, reviewing = false, reviewed = false;
  try {
    for (let round = 1; round <= rounds + 1; round++) {
      onStep(`round ${round}: asking ${provider}…`);
      const reply = reviewing ? await twice(ask, (e) => onStep(`round ${round}: ${e.message.split('\n')[0]}; asking again`)) : await ask();
      const source = code(reply);
      if (reviewing && !source && approves(reply)) {
        reviewed = true;
        break;
      }
      if (!source) throw new Error('cuadro: the model replied without a ```js block holding video.js');
      await writeFile(file, source);
      const result = await check();
      problem = result.problem;
      reviewing = !problem;
      if (reviewing) passed = source;
      onStep(`round ${round}: ${problem ? problem.split('\n')[0] : `ok${round <= rounds ? ', reviewing' : ''}`}`);
      messages.push({ role: 'user', text: reviewing ? review(result.frames, result.note) : fix(problem), images: result.shots });
    }
  } catch (e) {
    if (!passed) throw e;
    onStep(`stopped: ${e.message.split('\n')[0]}; keeping the last file that passed`);
  }
  if (!passed) throw new Error(`cuadro: no video.js passed the check in ${rounds + 1} tries; the last problem:\n${problem}`);
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

/** The contents of the first ```js block in a reply, or undefined. */
function code(reply) {
  return reply.match(/```(?:js|javascript)[^\n]*\n([\s\S]*?)```/)?.[1];
}

/** The system prompt: what cuadro is, its types, the README's guide and the rules. */
async function context() {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const learn = readme.slice(readme.indexOf('## Learn it'), readme.indexOf('\n## ', readme.indexOf('## Learn it') + 1));
  const types = await readFile(new URL('./index.d.ts', import.meta.url), 'utf8');
  const spark = await readFile(new URL('./index.d.ts', import.meta.resolve('spark')), 'utf8');
  return `You write videos in code with cuadro, a small JavaScript library on spark, a reactive library.
A video is an ES module, video.js, loaded by a page in Chromium. It calls composition(...), and draws
everything as a function of the frame signal. cuadro renders it by setting every frame in turn and
taking a screenshot.

Your output: reply with exactly one \`\`\`js fenced block holding the whole video.js, and nothing else
that matters. It imports only from 'cuadro' (which re-exports all of spark, including html). It calls
composition with width 1280, height 720 and fps 30, unless the request says otherwise. Paths to files
are relative to video.js, which sits in the same folder as its index.html.

Rules for a deterministic video: draw only from frame and props. Never use Date.now, Math.random
without a seed, requestAnimationFrame, setTimeout, CSS animations or transitions. Load everything the
video needs before calling composition, except fonts and <img>, which cuadro waits for. Use no
network resources: no remote fonts, images or scripts. Name fonts by their generic family (sans-serif,
serif, monospace) or a font file the video loads: a named system font such as Helvetica may be missing,
or be a bitmap font that draws nothing, on the machine that renders. Make sure every element the request
asks for ends up fully visible.

Here is cuadro's guide:

${learn}
Here are cuadro's types (src/index.d.ts):

\`\`\`ts
${types}\`\`\`

And spark's, which cuadro re-exports:

\`\`\`ts
${spark}\`\`\`
`;
}

/** The first user message: the prompt, and the narration's lines if there are any. */
function request(prompt, narration) {
  let text = `Write video.js for this video:\n\n${prompt}\n`;
  if (narration) {
    text += `
It is narrated. voice/voice.json (beside video.js) holds the spoken lines, in order, with their
lengths in seconds:

${JSON.stringify(narration, null, 2)}

Import it with: import voice from './voice/voice.json' with { type: 'json' };
Make one scene per line, sized from its seconds (Math.ceil(seconds * fps) plus a short pause), and
place each line's clip in its scene with audio('voice/' + line.file, { volume: 1 }) inside the
matching sequence. Read the lengths from the imported voice.json, not from the numbers above.
`;
  }
  return text;
}

/** Asks for a narration script, speaks it into <out>/voice, and returns its { lines: [{ id, file, seconds }] }. */
async function narrate({ prompt, out, ask, messages, voiceProvider, voiceName, provider, onStep }) {
  messages.push({ role: 'user', text: `Before video.js, write the narration for this video, one line per scene:

${prompt}

Reply with one \`\`\`json block holding { "lines": [{ "id": "...", "text": "..." }] }. Each id is
unique and made of letters, digits, - or _.` });
  onStep(`script: asking ${provider}…`);
  const reply = await ask();
  const json = reply.match(/```(?:json)?[^\n]*\n([\s\S]*?)```/)?.[1] ?? reply;
  let script;
  try {
    script = JSON.parse(json);
  } catch {
    throw new Error('cuadro: the model\'s narration script is not JSON');
  }
  const file = join(out, 'script.json');
  await writeFile(file, JSON.stringify(script, null, 2) + '\n');
  // voice() checks the script: lines present, ids safe and unique, text not empty.
  const { lines } = await voice({
    script: file, out: join(out, 'voice'), provider: voiceProvider, voice: voiceName,
    onLine: ({ id, index, total, skipped }) => onStep(`voice ${index + 1}/${total}: ${id}${skipped ? ' (unchanged)' : ''}`),
  });
  return { lines: lines.map(({ id, file, seconds }) => ({ id, file, seconds })) };
}

/** The user message after a failed check. */
function fix(problem) {
  return `The video failed cuadro's check:\n\n${problem}\n\nReply with the whole fixed video.js in one \`\`\`js block.`;
}

/** The user message after a passed check, sent with the screenshots of frames, and a note if they are all the same. */
function review(frames, note) {
  return `It runs. These are frames ${frames.join(', ')}.${note ? ` Note: ${note}.` : ''} If the video matches the request, reply with just OK.
Otherwise reply with the whole corrected video.js in one \`\`\`js block.`;
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

/** index.html: an import map for cuadro and spark, and video.js. */
function page(libs) {
  const imports = { cuadro: '/' + libs.cuadro, spark: '/' + libs.spark };
  return `<!doctype html>
<meta charset="utf-8">
<title>cuadro make</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module" src="./video.js"></script>
`;
}

/** How long to wait for the page to call composition, in milliseconds. */
const LoadTimeout = 10000;

/**
 * Opens out/index.html and shoots five frames; resolves to { problem, shots, frames, note } (problem undefined if it passed).
 * The model's code runs here, so the server serves only out and the two libraries, and the tab may load
 * nothing from any other origin.
 */
async function check(root, out, libs, timeout) {
  let server, browser;
  try {
    server = await serve(root, { allow: [relative(root, out), dirname(libs.cuadro), dirname(libs.spark)] });
    browser = await launch();
    const tab = await browser.newPage();
    await tab.route('**', (route) => (new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort()));
    const url = new URL(relative(resolve(root), resolve(out, 'index.html')).split(sep).join('/'), server.origin + '/');
    return await shoot(tab, `${url.href}?render`, timeout);
  } finally {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }
}

/** Loads url in tab and shoots five frames, each step within timeout; any failure is the problem. */
async function shoot(tab, url, timeout) {
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
    if (!(Number.isInteger(total) && total > 0)) return failure(`durationInFrames is ${total}; it must be a positive whole number`);
    await tab.setViewportSize({ width, height });
    const frames = [...new Set([0, 0.25, 0.5, 0.75, 1].map((q) => Math.round(q * (total - 1))))];
    for (const n of frames) {
      await within(tab.evaluate((n) => window.cuadro.setFrame(n), n), timeout, `setFrame(${n})`);
      if (errors.length) return failure();
      shots.push(await tab.screenshot({ clip: { x: 0, y: 0, width, height } }));
    }
    // A still title card is fine, so this is only a note for the review; too short a video is not looked at.
    const still = total >= 5 && shots.every((s) => s.equals(shots[0]));
    return { shots, frames, note: still ? `frames ${frames.join(', ')} are all identical: nothing moves` : undefined };
  } catch (e) {
    return failure(e.message);
  }
}
