// cuadro render: turns a composition page into an mp4.
// Serves the root directory, opens the page in headless Chromium with
// ?render (and ?props), then for each frame calls window.cuadro.setFrame(n),
// screenshots the stage as PNG and pipes it to ffmpeg, which encodes H.264
// to a temporary file. A second ffmpeg pass mixes the audio clips the page
// recorded in window.cuadro.clips (see audio.js), plus the soundtrack
// given as `audio`, which plays from frame 0. It pads or cuts the mix to
// the video's length, encodes AAC, and muxes it with the video copied as
// it is. With no clips and no soundtrack the mp4 has no audio stream.
// Depends on playwright-core (through chromium.js), serve.js, and ffmpeg
// on the PATH. Leaves out parallel rendering, other codecs and containers,
// transparency, and clips served from anywhere but the root.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { launch } from './chromium.js';
import { serve } from './serve.js';

/** The rate the clips are resampled to before mixing, in samples a second. */
const SampleRate = 48000;

/** Renders page (a file under root) to out; onProgress(done, total) after each frame. */
export async function render({ page, out, props, audio, root = '.', onProgress = () => {} }) {
  const path = relative(resolve(root), resolve(page));
  if (path.startsWith('..' + sep) || path === '..') throw new Error(`cuadro: ${page} is not under ${root}`);
  const server = await serve(root);
  const browser = await launch();
  const dir = await mkdtemp(join(tmpdir(), 'cuadro-'));
  const video = join(dir, 'video.mp4');
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
    const duration = durationInFrames / fps;
    if (width % 2 || height % 2) throw new Error('cuadro: width and height must be even for H.264');
    await tab.setViewportSize({ width, height });

    encoder = ffmpeg([
      '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(duration), video,
    ]);
    for (let n = 0; n < durationInFrames; n++) {
      await step(tab.evaluate((n) => window.cuadro.setFrame(n), n));
      await encoder.write(await tab.screenshot({ clip: { x: 0, y: 0, width, height } }));
      onProgress(n + 1, durationInFrames);
    }
    await encoder.end();
    encoder = null;

    const clips = (await tab.evaluate(() => window.cuadro.clips)).map((c) => ({ ...c, file: fileOf(c.src, server.origin, root) }));
    if (audio) clips.push({ file: audio, from: 0, volume: 1 });
    await mix(video, clips, fps, duration, out);
  } finally {
    encoder?.kill();
    await browser.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Maps a clip's URL to its file under root; a clip from elsewhere is an error. */
function fileOf(src, origin, root) {
  const url = new URL(src);
  const base = resolve(root);
  const file = resolve(base, '.' + decodeURIComponent(url.pathname));
  if (url.origin !== origin || !file.startsWith(base + sep)) throw new Error(`cuadro: audio clip ${src} is not under ${root}`);
  return file;
}

/** Writes out: the video copied as it is, with the clips mixed under it (none: no audio). */
async function mix(video, clips, fps, duration, out) {
  if (!clips.length) return copyFile(video, out);
  const samples = (frames) => Math.round((frames * SampleRate) / fps);
  // Each clip: resample, cut at `until`, scale, then delay to `from`.
  const chains = clips.map(({ from, until, volume }, i) => {
    const cut = until === undefined ? '' : `atrim=end_sample=${samples(until - from)},`;
    return `[${i + 1}:a]aresample=${SampleRate},${cut}volume=${volume},adelay=${samples(from)}S:all=1[c${i}]`;
  });
  const inputs = clips.map((_, i) => `[c${i}]`).join('');
  const sum = `${inputs}amix=inputs=${clips.length}:normalize=0,apad[mix]`; // padded, then cut by -t
  await ffmpeg([
    '-loglevel', 'error', '-y', '-i', video,
    ...clips.flatMap((c) => ['-i', c.file]),
    '-filter_complex', [...chains, sum].join(';'),
    '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart',
    '-t', String(duration), out,
  ]).end();
}

/** Starts ffmpeg, reading frames (if any) on stdin; write() respects backpressure, end() waits for it. */
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
