#!/usr/bin/env node
// cuadro's command line: `cuadro render <page> <out.mp4> [options]`.
// Parses the arguments, calls render() and shows progress on stderr: one
// updating line on a terminal, about ten lines otherwise (for
// job logs).
// Depends on render.js. Leaves out every subcommand but render.
import { parseArgs } from 'node:util';
import { render } from '../src/render.js';

const usage = `usage: cuadro render <page.html> <out.mp4> [--props json] [--audio file] [--root dir]

  --props json   props merged over the composition's defaults
  --audio file   soundtrack, cut or padded to the video's length
  --root dir     directory served to the browser (default: .); the page must be under it`;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { props: { type: 'string' }, audio: { type: 'string' }, root: { type: 'string', default: '.' }, help: { type: 'boolean', short: 'h' } },
  });
} catch (e) {
  fail(e.message);
}
const { values, positionals } = args;
if (values.help) { console.log(usage); process.exit(0); }
if (positionals[0] !== 'render' || positionals.length !== 3) fail('expected: render <page.html> <out.mp4>');
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

/** Prints the message and usage, and exits 2. */
function fail(message) {
  console.error(`cuadro: ${message}\n${usage}`);
  process.exit(2);
}
