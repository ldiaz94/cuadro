#!/usr/bin/env node
// cuadro's command line: `cuadro render <page> <out.mp4> [options]`,
// `cuadro voice <script.json> --provider p [options]` and
// `cuadro make "<prompt>" --provider p [options]`.
// Parses the arguments, calls render(), voice() or make() and shows
// progress on stderr: for render, one updating line on a terminal, about
// ten lines otherwise (for job logs); for voice, one line per spoken line;
// for make, one line per step.
// Depends on render.js, voice.js and make.js. Leaves out every other
// subcommand.
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { make } from '../src/make.js';
import { render } from '../src/render.js';
import { voice } from '../src/voice.js';

const usage = `usage: cuadro render <page.html> <out.mp4> [--props json] [--audio file] [--root dir]
       cuadro voice <script.json> --provider p [--voice v] [--model m] [--out dir] [--base-url url]
                   [--fps n]
       cuadro make "<prompt>" --provider p [--model m] [--out dir] [--rounds n] [--base-url url]
                   [--voice-provider p [--voice v]]

  --props json   props merged over the composition's defaults
  --audio file   soundtrack, cut or padded to the video's length
  --root dir     directory served to the browser (default: .); the page must be under it

  --provider p   elevenlabs, gemini, openai (or any compatible server) or qwen
  --voice v      the provider's voice (default: the provider's own)
  --model m      the provider's model (default: the provider's own)
  --out dir      where the audio files and voice.json go (default: voice)
  --base-url u   the provider's API address, to use another server
  --fps n        frames per second of the loudness levels in voice.json (default: 30)
  The script is { "lines": [{ "id", "text" }] }, or a scene script whose say lines it speaks.

  make writes <out>/video.js and index.html, checked in Chromium:
  --provider p   anthropic, gemini or openai (or any compatible server)
  --model m      the provider's model (default: the provider's own)
  --out dir      the output folder, under the working directory (default: make-out)
  --rounds n     revisions after the first draft, at most (default: 3)
  --base-url u   the provider's API address, to use another server
  --voice-provider p, --voice v   narrate it, with a voice provider above
  It exits 3 when the file passed the check but the model did not approve it.

  API keys come from ELEVENLABS_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY,
  DASHSCOPE_API_KEY and ANTHROPIC_API_KEY. OPENAI_BASE_URL points openai at
  another server, which gets OPENAI_COMPAT_API_KEY instead of OPENAI_API_KEY.`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      props: { type: 'string' }, audio: { type: 'string' }, root: { type: 'string', default: '.' },
      provider: { type: 'string' }, voice: { type: 'string' }, model: { type: 'string' },
      out: { type: 'string' }, 'base-url': { type: 'string' },
      rounds: { type: 'string' }, fps: { type: 'string' }, 'voice-provider': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(e.message);
}
const { values, positionals } = args;
if (values.help) { console.log(usage); process.exit(0); }
if (positionals[0] === 'voice') await runVoice();
if (positionals[0] === 'make') await runMake();
if (positionals[0] !== 'render' || positionals.length !== 3) fail('expected: render <page.html> <out.mp4>, voice <script.json> or make "<prompt>"');
let props;
try {
  props = values.props && JSON.parse(values.props);
} catch (e) {
  fail(`--props is not JSON: ${e.message}`);
}

const start = performance.now();
const tty = process.stderr.isTTY;
const fps = (done) => done / ((performance.now() - start) / 1000);
try {
  let every = 1;
  await render({
    page: positionals[1], out: positionals[2], props, audio: values.audio, root: values.root,
    onProgress(done, total) {
      if (done === 1) every = tty ? 1 : Math.max(1, Math.round(total / 10));
      if (done % every && done !== total) return;
      const rate = fps(done), eta = Math.round((total - done) / rate);
      const line = `frame ${done}/${total}  ${rate.toFixed(1)} fps  eta ${eta}s`;
      process.stderr.write(tty ? `\r${line}\x1b[K` : `${line}\n`);
    },
  });
  if (tty) process.stderr.write('\n');
  console.error(`wrote ${positionals[2]} in ${((performance.now() - start) / 1000).toFixed(1)}s`);
} catch (e) {
  if (tty) process.stderr.write('\n');
  console.error(e.message);
  process.exit(1);
}

/** Runs `cuadro voice`, one progress line per spoken line, and exits. */
async function runVoice() {
  if (positionals.length !== 2) fail('expected: voice <script.json>');
  if (!values.provider) fail('voice needs --provider');
  try {
    await voice({
      script: positionals[1], out: values.out, provider: values.provider, voice: values.voice,
      model: values.model, baseUrl: values['base-url'], fps: values.fps === undefined ? undefined : Number(values.fps),
      onLine: ({ id, index, total, skipped }) => console.error(`line ${index + 1}/${total}  ${id}  ${skipped ? 'unchanged' : 'spoken'}`),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

/** Runs `cuadro make`, one progress line per step, says how to preview and render, and exits. */
async function runMake() {
  if (positionals.length !== 2) fail('expected: make "<prompt>"');
  if (!values.provider) fail('make needs --provider');
  const rounds = Number(values.rounds ?? 3);
  if (!Number.isInteger(rounds) || rounds < 0) fail('--rounds must be a whole number');
  if (values.voice && !values['voice-provider']) fail('make takes --voice only with --voice-provider');
  try {
    const { page, reviewed } = await make({
      prompt: positionals[1], provider: values.provider, model: values.model, baseUrl: values['base-url'], out: values.out, rounds,
      voiceProvider: values['voice-provider'], voice: values.voice, onStep: (m) => console.error(m),
    });
    console.error(`preview: serve this folder with byte ranges (npx serve .) and open /${relative('.', page)}`);
    console.error(`render:  npx cuadro render ${page} out.mp4`);
    if (!reviewed) process.exit(3);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

/** Prints the message and usage, and exits 2. */
function fail(message) {
  console.error(`cuadro: ${message}\n${usage}`);
  process.exit(2);
}
