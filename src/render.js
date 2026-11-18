// cuadro render: turns a composition page into an mp4.
// Serves the root directory, opens the page in headless Chromium with
// ?render (and ?props), then for each frame calls window.cuadro.setFrame(n),
// screenshots the stage as PNG (a fast lossless encoding, asked of Chromium over CDP) and pipes it to ffmpeg, which encodes H.264
// to a temporary file. A second ffmpeg pass mixes the audio clips the page
// recorded in window.cuadro.clips (see audio.js), plus the soundtrack
// given as `audio`, which plays from frame 0. It pads or cuts the mix to
// the video's length, encodes AAC, and muxes it with the video copied as
// it is. With no clips and no soundtrack the mp4 has no audio stream.
// Both ffmpeg runs are watched: one that stalls or runs past the video's end is killed and fails the render.
// The page's numbers are checked before they reach ffmpeg's filter graph.
// A page error, or a step in the page that takes over 30 s, fails it.
// With `workers` > 1 (default: up to 4) that many tabs of one Chromium each
// take the next frame number and screenshot it; a reorder buffer hands the
// frames to ffmpeg strictly in order, and holds back workers that get more
// than two frames each ahead, so memory stays bounded. Clips need every
// frame visited in order, so an extra tab walks the frames without
// screenshots and its clips are the ones mixed.
// still() renders only some frames: one is a PNG, several a contact sheet.
// Depends on playwright-core (through chromium.js), serve.js, and ffmpeg
// on the PATH. Leaves out other codecs and containers, transparency, and
// clips served from anywhere but the root.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { join, relative, resolve, sep } from 'node:path';
import { StepTimeout, launch, within } from './chromium.js';
import { serve } from './serve.js';

/** The rate the clips are resampled to before mixing, in samples a second. */
const SampleRate = 48000;

/** How long ffmpeg's output may stand still before it is killed, in seconds: well over a slow frame (StepTimeout), well under a hang. */
const StallSeconds = 60;

/** How far past the video's length ffmpeg's output may run before it is killed, in seconds. */
const OverrunSeconds = 1;

/** How many frames each worker may be ahead of the one ffmpeg is waiting for: bounds the frames held in memory. */
const AheadPerWorker = 2;

/** Renders page (a file under root) to out; onProgress(done, total) after each frame, in order. */
export async function render({ page, out, props, audio, root = '.', workers = defaultWorkers(), onProgress = () => {} }) {
  if (!Number.isInteger(workers) || workers < 1) throw new Error('cuadro: workers must be a whole number above 0');
  let encoder;
  try {
    await session({ page, root, props }, async ({ first, open, config, dir, origin }) => {
      const { fps, durationInFrames: total } = config;
      const duration = total / fps;
      const video = join(dir, 'video.mp4');
      encoder = ffmpeg([
        '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(duration), video,
      ], duration);
      const count = Math.min(workers, total);
      const queue = ordered(total, count * AheadPerWorker, async (png, done) => {
        await encoder.write(png);
        onProgress(done, total);
      });
      const tabs = [first, ...(await Promise.all(Array.from({ length: count - 1 }, open)))];
      // Clips are recorded as the frames advance, so only a tab that visits every frame in order sees them all.
      // With one worker that is the tab itself; otherwise an extra tab walks the frames without screenshots.
      const walker = count > 1 ? await open() : first;
      const walk = count > 1 ? visitAll(walker, total, queue) : null;
      // When one fails the rest stop and are waited for, so no step is left running in a closed browser.
      const jobs = [walk, ...tabs.map((tab) => work(tab, queue))];
      const results = await Promise.allSettled(jobs.map((job) => job?.catch((e) => { queue.stop(); throw e; })));
      const failure = results.find((r) => r.status === 'rejected');
      if (failure) throw failure.reason;
      await encoder.end();
      encoder = null;
      const clips = (await walker.tab.evaluate(() => window.cuadro.clips)).map((c) => ({ ...checked(c), file: fileOf(c.src, origin, root) }));
      if (audio) clips.push({ file: audio, from: 0, volume: 1 });
      await mix(video, clips, fps, duration, out);
    });
  } finally {
    encoder?.kill();
  }
}

/**
 * Renders the frames of page (default: one every `every` seconds, 2) to out, as PNG.
 * One frame is written as it is; several are tiled in a contact sheet, `columns` across.
 */
export async function still({ page, out, frames, every = 2, props, root = '.', columns }) {
  await session({ page, root, props }, async ({ first, config, dir }) => {
    const { fps, durationInFrames: total } = config;
    const gap = Math.max(1, Math.round(every * fps));
    const list = frames ?? Array.from({ length: Math.ceil(total / gap) }, (_, i) => i * gap);
    if (!list.length || !list.every((n) => Number.isInteger(n) && n >= 0 && n < total)) {
      throw new Error(`cuadro: frames must be whole numbers from 0 to ${total - 1}`);
    }
    const across = columns ?? Math.min(list.length, 4);
    if (!Number.isInteger(across) || across < 1) throw new Error('cuadro: columns must be a whole number above 0');
    for (const [i, n] of list.entries()) {
      await first.step(first.tab.evaluate((n) => window.cuadro.setFrame(n), n), `setFrame(${n})`);
      await writeFile(join(dir, `${i}.png`), await first.shot());
    }
    if (list.length === 1) return copyFile(join(dir, '0.png'), out);
    const rows = Math.ceil(list.length / across);
    await ffmpeg([
      '-loglevel', 'error', '-y', '-framerate', '1', '-start_number', '0', '-i', join(dir, '%d.png'),
      '-vf', `tile=${across}x${rows}`, '-frames:v', '1', out,
    ], list.length).end();
  });
}

/** The default number of workers: up to 4, and no more than the machine has CPUs for. */
function defaultWorkers() {
  return Math.min(4, availableParallelism());
}

/**
 * Serves root, launches Chromium and opens page in a first tab, then calls use with
 * { first, open, config, dir, origin }: first and every tab from open() are { tab, step, shot } at the
 * composition's size, config is its window.cuadro size, dir a scratch directory. Cleans everything up.
 */
async function session({ page, root, props }, use) {
  const path = relative(resolve(root), resolve(page));
  if (path.startsWith('..' + sep) || path === '..') throw new Error(`cuadro: ${page} is not under ${root}`);
  let server, browser, dir;
  try {
    server = await serve(root);
    browser = await launch();
    dir = await mkdtemp(join(tmpdir(), 'cuadro-'));
    const url = new URL(path.split(sep).join('/'), server.origin + '/');
    url.searchParams.set('render', '');
    if (props) url.searchParams.set('props', JSON.stringify(props));
    let config;
    const open = async () => {
      const tab = await browser.newPage();
      const step = guarded(tab);
      await step(tab.goto(url.href), 'loading the page');
      await step(tab.waitForFunction(() => window.cuadro), 'waiting for composition()');
      if (config) await tab.setViewportSize({ width: config.width, height: config.height });
      return { tab, step, shot: shooter(tab, await tab.context().newCDPSession(tab)) };
    };
    const first = await open();
    config = sized(await first.tab.evaluate(() => window.cuadro));
    await first.tab.setViewportSize({ width: config.width, height: config.height });
    await use({ first, open, config, dir, origin: server.origin });
  } finally {
    // Each is closed even if another fails; a failed close never hides the render's own error.
    await Promise.allSettled([browser?.close(), server?.close(), dir && rm(dir, { recursive: true, force: true })]);
  }
}

/**
 * A function that screenshots the tab's page as a PNG. It asks Chromium for a fast, lossless encoding:
 * Playwright's own screenshot compresses hard on one thread, which was most of a frame's time and
 * kept several tabs from going faster than one.
 */
function shooter(tab, cdp) {
  return async () => {
    const { width, height } = tab.viewportSize();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return Buffer.from(data, 'base64');
  };
}

/** One worker: takes the next frame number from queue, shows it, and hands the screenshot back, until none are left. */
async function work({ tab, step, shot }, queue) {
  for (let n = await queue.take(); n >= 0; n = await queue.take()) {
    await step(tab.evaluate((n) => window.cuadro.setFrame(n), n), `setFrame(${n})`);
    await queue.put(n, await shot());
  }
}

/** Shows every frame in order in a tab, taking no screenshots, so its clips are complete; stops early if queue was stopped. */
async function visitAll({ tab, step }, total, queue) {
  for (let n = 0; n < total && !queue.stopped(); n++) await step(tab.evaluate((n) => window.cuadro.setFrame(n), n), `setFrame(${n})`);
}

/**
 * Hands out frame numbers 0..total-1 to workers, and the finished frames to write() in order.
 * stop() makes take() return -1 from then on. take() waits while a worker would get more than `ahead` frames past the last one written; put()
 * returns once its frame, and all before it, are written. write(png, count) gets the count written so far.
 */
function ordered(total, ahead, write) {
  const ready = new Map();
  let next = 0, written = 0, stopped = false, writing = Promise.resolve(), waiting = [];
  const drain = async () => {
    while (ready.has(written)) {
      const png = ready.get(written);
      ready.delete(written);
      await write(png, ++written);
      waiting.splice(0).forEach((wake) => wake());
    }
  };
  return {
    async take() {
      while (!stopped && next < total && next - written >= ahead) await new Promise((wake) => waiting.push(wake));
      return !stopped && next < total ? next++ : -1;
    },
    stopped: () => stopped,
    stop() {
      stopped = true;
      waiting.splice(0).forEach((wake) => wake());
    },
    put(n, png) {
      ready.set(n, png);
      return (writing = writing.then(drain)); // drains run one at a time; a failed write fails every later put
    },
  };
}

/** A step runner for tab: a step fails on a page error, or after StepTimeout, instead of hanging. */
function guarded(tab) {
  const failed = new Promise((_, reject) => tab.on('pageerror', (e) => reject(new Error(`cuadro: page error: ${e.message}`))));
  failed.catch(() => {});
  return (promise, what) => Promise.race([within(promise, StepTimeout, what), failed]);
}

/** The page's window.cuadro, checked: whole sizes and length above 0, even sizes for H.264, a rate above 0. */
function sized(c) {
  if (![c.width, c.height, c.durationInFrames].every((n) => Number.isInteger(n) && n > 0) || !(Number.isFinite(c.fps) && c.fps > 0)) {
    throw new Error('cuadro: width, height and durationInFrames must be whole numbers above 0, and fps a number above 0');
  }
  if (c.width % 2 || c.height % 2) throw new Error('cuadro: width and height must be even for H.264');
  return c;
}

/** A clip from the page, whose numbers go into ffmpeg's filter graph: anything but plain numbers is an error. */
function checked(clip) {
  const { from, until, volume } = clip;
  const ok = Number.isInteger(from) && from >= 0
    && (until === undefined || (Number.isInteger(until) && until > from))
    && typeof volume === 'number' && Number.isFinite(volume) && volume >= 0;
  if (!ok) throw new Error(`cuadro: bad audio clip ${JSON.stringify(clip)}: from must be a whole number >= 0, until a later one, volume a number >= 0`);
  return { from, until, volume };
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
  const sum = `${inputs}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${duration}[mix]`; // padded to the video length; a bare apad never ends and hangs ffmpeg with -c:v copy
  await ffmpeg([
    '-loglevel', 'error', '-y', '-i', video,
    ...clips.flatMap((c) => ['-i', c.file]),
    '-filter_complex', [...chains, sum].join(';'),
    '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart',
    '-t', String(duration), out,
  ], duration).end();
}

/**
 * Starts ffmpeg, reading frames (if any) on stdin; write() respects backpressure, end() waits for it.
 * A watchdog on ffmpeg's -progress report kills it, and fails end() and write(), when its output
 * stops growing for stallMs, or passes duration (seconds) by more than OverrunSeconds.
 */
export function ffmpeg(args, duration, stallMs = StallSeconds * 1000) {
  const child = spawn('ffmpeg', ['-nostats', '-progress', 'pipe:3', ...args], { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  let abort, moved = Date.now(), reached = -1;
  const done = new Promise((ok, fail) => {
    abort = (message) => { child.kill(); fail(new Error(`cuadro: ${message}`)); };
    child.on('error', (e) => fail(new Error(`cuadro: cannot run ffmpeg: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`cuadro: ffmpeg failed (exit ${code}):\n${log}`))));
  });
  createInterface({ input: child.stdio[3] }).on('line', (line) => {
    const us = /^out_time_us=(\d+)$/.exec(line)?.[1]; // "N/A" or negative before the first packet
    if (us === undefined || us / 1e6 <= reached) return;
    reached = us / 1e6;
    moved = Date.now();
    if (reached > duration + OverrunSeconds) abort('ffmpeg ran past the end of the video');
  });
  const watch = setInterval(() => {
    if (Date.now() - moved > stallMs) abort(`ffmpeg made no progress for ${stallMs / 1000} s`);
  }, Math.min(1000, stallMs / 4));
  done.then(() => clearInterval(watch), () => clearInterval(watch));
  child.stdin.on('error', () => {}); // a dead ffmpeg is reported by `done`
  return {
    write: (png) => Promise.race([done, new Promise((ok) => (child.stdin.write(png) ? ok() : child.stdin.once('drain', ok)))]),
    end: () => { child.stdin.end(); return done; },
    kill: () => { done.catch(() => {}); child.kill('SIGKILL'); }, // after another failure: that one is reported; SIGTERM would wait for stdin
  };
}
