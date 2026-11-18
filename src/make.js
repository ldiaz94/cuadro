// cuadro make: turns a prompt into a video's source, by asking a language
// model and checking what it writes.
// The model gets cuadro's types and the README's "Learn it" section, and
// replies with a whole video.js. cuadro writes it beside an index.html in
// the output folder and opens it in Chromium. A page error, a failed
// setFrame, or five sample frames that are all the same send the problem
// (and the frames) back for a fixed file. A file that passes is shown to
// the model as five frames, for one review: it replies OK, or a better
// file, which is checked again. It stops at OK or after `rounds`
// revisions, and keeps the last file that passed.
// The model's code runs in a tab that may load only from cuadro's server,
// which serves only the output folder and the two libraries.
// With a voice provider it first asks for a narration script, speaks it
// with voice.js, and has the video follow the lines' lengths.
// Depends on llm.js, voice.js, serve.js and chromium.js. Leaves out
// rendering the mp4 (that is `cuadro render`), editing an existing
// video.js, and any check of how good the video looks beyond the review.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { StepTimeout, launch, within } from './chromium.js';
import { chat } from './llm.js';
import { serve } from './serve.js';
import { voice } from './voice.js';

/** Makes <out>/video.js and <out>/index.html from prompt; onStep(message) reports progress. */
export async function make({
  prompt, provider, model, baseUrl, out = 'make-out', rounds = 3, root = process.cwd(),
  voiceProvider, voice: voiceName, timeout = StepTimeout, onStep = () => {},
}) {
  if (relative(resolve(root), resolve(out)).split(sep)[0] === '..') throw new Error(`cuadro: ${out} is not under ${root}`);
  await mkdir(out, { recursive: true });
  const libs = await libraries(root);
  await writeFile(join(out, 'index.html'), page(libs));
  const system = await context();
  const messages = [];
  const ask = async () => {
    const text = await chat({ provider, model, baseUrl, system, messages });
    messages.push({ role: 'assistant', text });
    return text;
  };

  const narration = voiceProvider && await narrate({ prompt, out, ask, messages, voiceProvider, voiceName, onStep });
  messages.push({ role: 'user', text: request(prompt, narration) });
  let passed, problem, reviewing = false;
  for (let round = 1; round <= rounds + 1; round++) {
    const reply = await ask();
    const source = code(reply);
    if (reviewing && !source && /^\s*OK\b/.test(reply)) break;
    if (!source) throw new Error('cuadro: the model replied without a ```js block holding video.js');
    await writeFile(join(out, 'video.js'), source);
    const result = await check(root, out, libs, timeout);
    problem = result.problem;
    reviewing = !problem;
    if (reviewing) passed = source;
    if (problem) onStep(`round ${round}: ${problem.split('\n')[0]}`);
    else onStep(`round ${round}: ok${round <= rounds ? ', reviewing' : ''}`);
    messages.push({ role: 'user', text: reviewing ? review(result.frames) : fix(problem), images: result.shots });
  }
  if (!passed) throw new Error(`cuadro: no video.js passed the check in ${rounds + 1} tries; the last problem:\n${problem}`);
  await writeFile(join(out, 'video.js'), passed);
  onStep(`done: ${join(out, 'video.js')}`);
  return { page: join(out, 'index.html'), file: join(out, 'video.js') };
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
network resources: no remote fonts, images or scripts.

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
async function narrate({ prompt, out, ask, messages, voiceProvider, voiceName, onStep }) {
  messages.push({ role: 'user', text: `Before video.js, write the narration for this video, one line per scene:

${prompt}

Reply with one \`\`\`json block holding { "lines": [{ "id": "...", "text": "..." }] }. Each id is
unique and made of letters, digits, - or _.` });
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

/** The user message after a passed check, sent with the screenshots of frames. */
function review(frames) {
  return `It runs. These are frames ${frames.join(', ')}. If the video matches the request, reply with just OK.
Otherwise reply with the whole corrected video.js in one \`\`\`js block.`;
}

/** Where cuadro's and spark's entry modules are, as paths under root. */
async function libraries(root) {
  let cuadro;
  if (existsSync(join(root, 'node_modules', 'cuadro'))) cuadro = 'node_modules/cuadro/src/index.js';
  else if (await packageName(root) === 'cuadro') cuadro = 'src/index.js';
  else throw new Error(`cuadro: cuadro is not installed in ${resolve(root)}; run npm install cuadro there`);
  return { cuadro, spark: 'node_modules/spark/src/index.js' };
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

/** The name in root/package.json, or undefined. */
async function packageName(root) {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name;
  } catch {
    return undefined;
  }
}

/** How long to wait for the page to call composition, in milliseconds. */
const LoadTimeout = 10000;

/**
 * Opens out/index.html and shoots five frames; resolves to { problem, shots, frames } (problem undefined if it passed).
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
    const frames = [0, 0.25, 0.5, 0.75, 1].map((q) => Math.round(q * (total - 1)));
    for (const n of frames) {
      await within(tab.evaluate((n) => window.cuadro.setFrame(n), n), timeout, `setFrame(${n})`);
      if (errors.length) return failure();
      shots.push(await tab.screenshot({ clip: { x: 0, y: 0, width, height } }));
    }
    if (shots.every((s) => s.equals(shots[0]))) return { problem: `frames ${frames.join(', ')} are all identical: nothing moves`, shots, frames };
    return { shots, frames };
  } catch (e) {
    return failure(e.message);
  }
}
