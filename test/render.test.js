import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, render, still } from '../src/render.js';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'cuadro-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const run = (out, props, audio) => render({ page: join(root, 'test/fixture.html'), root, out: join(dir, out), props, audio });
const probe = (file, entries) =>
  execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', entries, '-of', 'csv=p=0', join(dir, file)], { encoding: 'utf8' }).trim();
// A checksum per decoded frame: equal lists mean the same pictures.
const frames = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, file), '-map', '0:v', '-f', 'framemd5', '-'], { encoding: 'utf8' })
  .split('\n').filter((l) => l && !l.startsWith('#'));

test('renders every frame at the composition size', async () => {
  const seen = [];
  await render({ page: join(root, 'test/fixture.html'), root, out: join(dir, 'a.mp4'), onProgress: (d, t) => seen.push(`${d}/${t}`) });
  assert.equal(probe('a.mp4', 'stream=width,height,nb_read_frames'), '64,48,12');
  assert.deepEqual(seen.at(-1), '12/12');
  assert.equal(seen.length, 12);
});

test('the same props render the same frames; other props differ', async () => {
  await run('b1.mp4', { color: 'teal' });
  await run('b2.mp4', { color: 'teal' });
  await run('c.mp4', { color: 'crimson' });
  const b1 = frames('b1.mp4');
  assert.equal(b1.length, 12);
  assert.deepEqual(frames('b2.mp4'), b1);
  assert.notDeepEqual(frames('c.mp4'), b1);
  assert.equal(new Set(b1.map((l) => l.split(',').at(-1))).size, 12, 'every frame should differ: the bar grows');
});

test('audio is muxed and fitted to the video length', async () => {
  const audio = join(dir, 'tone.wav'); // 0.4 s, shorter than the 1 s video: padded
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', audio]);
  await run('d.mp4', undefined, audio);
  const streams = probe('d.mp4', 'stream=codec_type').split('\n');
  assert.deepEqual(streams.sort(), ['audio', 'video']);
  const duration = Number(probe('d.mp4', 'format=duration'));
  assert.ok(Math.abs(duration - 1) < 0.1, `duration ${duration}`);
});

test('a page error or a broken image fails the render', async () => {
  await assert.rejects(run('e.mp4', { boom: true }), /page error: boom/);
  await assert.rejects(run('f.mp4', { image: '/test/missing.png' }), /image failed to load/);
});

test('a clip whose numbers are not numbers fails the render, and writes nothing', async () => {
  const out = join(dir, 'g.mp4');
  await assert.rejects(render({ page: join(root, 'test/bad-clip.html'), root, out }), /bad audio clip.*volume/);
  assert.equal(existsSync(out), false);
});

test('ffmpeg that runs past the video end, or stalls, is killed with an error', async () => {
  const endless = ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-']; // no -t: never ends
  await assert.rejects(ffmpeg(endless, 1).end(), /ran past the end/);
  const idle = ['-loglevel', 'error', '-listen_timeout', '-1', '-i', 'tcp://127.0.0.1:47123?listen=1', '-f', 'null', '-']; // waits for a peer that never comes
  await assert.rejects(ffmpeg(idle, 1, 500).end(), /no progress/);
});

// The grey of each frame of order.html, decoded: frame n is 6 * n.
const greys = (file) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, file), '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 });
  return [...raw];
};

test('with several workers the frames reach the video in order', async () => {
  const seen = [];
  await render({ page: join(root, 'test/order.html'), root, out: join(dir, 'w.mp4'), workers: 4, onProgress: (d) => seen.push(d) });
  const grey = greys('w.mp4');
  assert.equal(grey.length, 40);
  grey.forEach((g, n) => assert.ok(Math.abs(g - 6 * n) <= 6, `frame ${n} came out grey ${g}`));
  assert.deepEqual(seen, Array.from({ length: 40 }, (_, i) => i + 1));
});

test('still: one frame is a PNG at the composition size; several are a contact sheet', async () => {
  const size = (file) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(dir, file)], { encoding: 'utf8' }).trim();
  const page = join(root, 'test/order.html');
  await still({ page, root, out: join(dir, 's1.png'), frames: [20] });
  assert.equal(size('s1.png'), '64,48');
  assert.deepEqual([...execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, 's1.png'), '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])], [120]);
  await still({ page, root, out: join(dir, 's3.png'), frames: [0, 10, 39], columns: 2 });
  assert.equal(size('s3.png'), '128,96');
  await still({ page, root, out: join(dir, 's6.png'), frames: [0, 1, 2, 3, 4], columns: 4 }); // a last row of one: ffmpeg's clock runs to the 8th cell
  assert.equal(size('s6.png'), '256,96');
  await still({ page, root, out: join(dir, 's4.png'), every: 1 }); // 40 frames at 10 fps: 4 frames, in a row
  assert.equal(size('s4.png'), '256,48');
  await assert.rejects(still({ page, root, out: join(dir, 's5.png'), frames: [40] }), /frames must be whole numbers from 0 to 39/);
});
