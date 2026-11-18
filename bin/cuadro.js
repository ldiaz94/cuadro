#!/usr/bin/env node
// cuadro's command line: `cuadro render <page> <out.mp4> [options]` and
// `cuadro voice <script.json> --provider p [options]`.
// Parses the arguments, calls render() or voice() and shows progress on
// stderr: for render, one updating line on a terminal, about ten lines
// otherwise (for job logs); for voice, one line per spoken line.
// Depends on render.js and voice.js. Leaves out every other subcommand.
import { parseArgs } from 'node:util';
import { render } from '../src/render.js';
import { voice } from '../src/voice.js';

const usage = `usage: cuadro render <page.html> <out.mp4> [--props json] [--audio file] [--root dir]
       cuadro voice <script.json> --provider p [--voice v] [--model m] [--out dir] [--base-url url]

  --props json   props merged over the composition's defaults
  --audio file   soundtrack, cut or padded to the video's length
  --root dir     directory served to the browser (default: .); the page must be under it

  --provider p   elevenlabs, gemini, openai (or any compatible server) or qwen
  --voice v      the provider's voice (default: the provider's own)
  --model m      the provider's model (default: the provider's own)
  --out dir      where the audio files and voice.json go (default: voice)
  --base-url u   the provider's API address, to use another server

  API keys come from ELEVENLABS_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
  (OPENAI_BASE_URL for other servers) and DASHSCOPE_API_KEY.`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      props: { type: 'string' }, audio: { type: 'string' }, root: { type: 'string', default: '.' },
      provider: { type: 'string' }, voice: { type: 'string' }, model: { type: 'string' },
      out: { type: 'string' }, 'base-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(e.message);
}
const { values, positionals } = args;
if (values.help) { console.log(usage); process.exit(0); }
if (positionals[0] === 'voice') await runVoice();
if (positionals[0] !== 'render' || positionals.length !== 3) fail('expected: render <page.html> <out.mp4> or voice <script.json>');
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
      model: values.model, baseUrl: values['base-url'],
      onLine: ({ id, index, total, skipped }) => console.error(`line ${index + 1}/${total}  ${id}  ${skipped ? 'unchanged' : 'spoken'}`),
    });
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
