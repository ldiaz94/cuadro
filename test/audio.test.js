import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render } from '../src/render.js';
import { open } from './browser.js';

// The tones live under the repo root, so the render's server can serve them.
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(root, 'test', 'tmp-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** Writes a sine tone of `seconds` to dir/name and returns its URL path. */
const tone = (name, frequency, seconds) => {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, join(dir, name)]);
  return '/' + relative(root, join(dir, name));
};
const props = { a: tone('a.wav', 440, 0.3), b: tone('b.wav', 660, 1), c: tone('c.wav', 880, 1) };
const run = (out, audio) => render({ page: join(root, 'test/audio.html'), root, out: join(dir, out), props, audio });

/** The silent stretches of file's audio, as [start, end] in seconds rounded to 0.05. */
function silences(file) {
  const { stderr } = spawnSync('ffmpeg', ['-i', join(dir, file), '-map', '0:a', '-af', 'silencedetect=noise=-40dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' });
  const times = [...stderr.matchAll(/silence_(?:start|end): ([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 20) / 20);
  const pairs = [];
  for (let i = 0; i < times.length; i += 2) pairs.push(times.slice(i, i + 2));
  return pairs;
}
/** A checksum of file's decoded audio. */
const md5 = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, file), '-map', '0:a', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();

test('clips are heard from their frame until their sequence ends; an unreached one never', async () => {
  await run('clips.mp4');
  // a: 0.5 to 0.8 s (the file ends); b: 1.5 s, cut at 2.0 s; c: never.
  assert.deepEqual(silences('clips.mp4'), [[0, 0.5], [0.8, 1.5], [2, 3]]);
});

test('a soundtrack plays from frame 0 together with the clips', async () => {
  await run('both.mp4', join(dir, 'a.wav'));
  assert.deepEqual(silences('both.mp4'), [[0.3, 0.5], [0.8, 1.5], [2, 3]]);
});

test('the same input renders the same audio twice', async () => {
  await run('again1.mp4');
  await run('again2.mp4');
  assert.equal(md5('again1.mp4'), md5('again2.mp4'));
});

test('preview: a mounted clip is an <audio> element that seeks with the scrubber', async () => {
  // Our test server has no byte ranges, and Chromium seeks only in audio
  // served by ranges, so b is served here as one range covering the file.
  const b = await open(`/test/audio.html?props=${encodeURIComponent(JSON.stringify(props))}`, (page) =>
    page.route('**/b.wav', (route) => {
      const body = readFileSync(join(dir, 'b.wav'));
      const headers = { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes 0-${body.length - 1}/${body.length}` };
      return route.fulfill({ status: 206, headers, body });
    }));
  try {
    const { page } = b;
    const names = () => page.$$eval('audio', (els) => els.map((el) => el.src.split('/').pop()));
    const bAt = () => page.$eval('audio[src$="b.wav"]', (el) => el.currentTime);
    assert.deepEqual(await names(), []);
    await page.fill('input[type=range]', '17');
    assert.deepEqual(await names(), ['a.wav', 'b.wav']);
    await page.waitForFunction(() => document.querySelector('audio[src$="b.wav"]').readyState === 4);
    assert.equal(await bAt(), 0.2);
    await page.fill('input[type=range]', '18');
    assert.equal(await bAt(), 0.3);
    await page.fill('input[type=range]', '25'); // b's sequence has ended
    assert.deepEqual(await names(), ['a.wav']);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});
