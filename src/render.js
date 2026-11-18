// cuadro render: turns a composition page into an mp4.
// Serves the root directory, opens the page in headless Chromium with
// ?render (and ?props), then for each frame calls window.cuadro.setFrame(n),
// screenshots the stage as PNG and pipes it to ffmpeg, which encodes H.264
// (and AAC, if an audio file is given, cut or padded with silence to the
// video's length).
// Depends on playwright-core (through chromium.js), serve.js, and ffmpeg
// on the PATH. Leaves out parallel rendering, other codecs and containers,
// and transparency.
import { spawn } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { launch } from './chromium.js';
import { serve } from './serve.js';

/** Renders page (a file under root) to out; onProgress(done, total) after each frame. */
export async function render({ page, out, props, audio, root = '.', onProgress = () => {} }) {
  const path = relative(resolve(root), resolve(page));
  if (path.startsWith('..' + sep) || path === '..') throw new Error(`cuadro: ${page} is not under ${root}`);
  const server = await serve(root);
  const browser = await launch();
  let encoder;
  try {
    const tab = await browser.newPage();
    // A page error fails the render at the next step instead of hanging it.
    const failed = new Promise((_, reject) => tab.on('pageerror', (e) => reject(new Error(`cuadro: page error: ${e.message}`))));
    failed.catch(() => {});
    const step = (p) => Promise.race([p, failed]);

    const url = new URL(path.split(sep).join('/'), server.origin + '/');
    url.searchParams.set('render', '');
    if (props) url.searchParams.set('props', JSON.stringify(props));
    await step(tab.goto(url.href));
    await step(tab.waitForFunction(() => window.cuadro));
    const { width, height, fps, durationInFrames } = await tab.evaluate(() => window.cuadro);
    if (width % 2 || height % 2) throw new Error('cuadro: width and height must be even for H.264');
    await tab.setViewportSize({ width, height });

    encoder = ffmpeg([
      '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      ...(audio ? ['-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-af', 'apad'] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-t', String(durationInFrames / fps), out,
    ]);
    for (let n = 0; n < durationInFrames; n++) {
      await step(tab.evaluate((n) => window.cuadro.setFrame(n), n));
      await encoder.write(await tab.screenshot({ clip: { x: 0, y: 0, width, height } }));
      onProgress(n + 1, durationInFrames);
    }
    await encoder.end();
    encoder = null;
  } finally {
    encoder?.kill();
    await browser.close();
    await server.close();
  }
}

/** Starts ffmpeg reading frames on stdin; write() respects backpressure, end() waits for it. */
function ffmpeg(args) {
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  const done = new Promise((ok, fail) => {
    child.on('error', (e) => fail(new Error(`cuadro: cannot run ffmpeg: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`cuadro: ffmpeg failed (exit ${code}):\n${log}`))));
  });
  child.stdin.on('error', () => {}); // a dead ffmpeg is reported by `done`
  return {
    write: (png) => Promise.race([done, new Promise((ok) => (child.stdin.write(png) ? ok() : child.stdin.once('drain', ok)))]),
    end: () => { child.stdin.end(); return done; },
    kill: () => { done.catch(() => {}); child.kill(); }, // after another failure: that one is reported
  };
}
