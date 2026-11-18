import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voice } from '../src/voice.js';
import { wav } from '../src/speech.js';
import { fakeServer } from './fake-server.js';

/** Half a second of silence as a WAV file, 8 kHz. */
const half = wav(Buffer.alloc(8000), 8000);

/** A temp directory holding a script of the given lines. */
async function setup(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'cuadro-voice-'));
  const script = join(dir, 'script.json');
  await writeFile(script, JSON.stringify({ lines }));
  return { dir, script, out: join(dir, 'voice') };
}

test('writes the files and voice.json, caches, and regenerates only a changed line', async () => {
  const s = await fakeServer([{ body: half }]);
  const { script, out } = await setup([{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }]);
  const run = (events = []) => voice({ script, out, provider: 'openai', baseUrl: s.url, onLine: (e) => events.push(e.skipped) });

  const events = [];
  const first = await run(events);
  assert.equal(s.requests.length, 2);
  assert.deepEqual(events, [false, false]);
  assert.deepEqual(first.lines.map((l) => [l.id, l.file]), [['a', 'a.mp3'], ['b', 'b.mp3']]);
  for (const l of first.lines) assert.ok(Math.abs(l.seconds - 0.5) < 0.05, `seconds ${l.seconds}`);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'voice.json'), 'utf8')), first);
  assert.deepEqual(await readFile(join(out, 'a.mp3')), half);

  assert.deepEqual((await run()).lines, first.lines);
  assert.equal(s.requests.length, 2, 'second run makes no requests');

  await writeFile(script, JSON.stringify({ lines: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Changed' }] }));
  const third = await run();
  assert.equal(s.requests.length, 3);
  assert.equal(JSON.parse(s.requests[2].body).input, 'Changed');
  assert.equal(third.lines[0].hash, first.lines[0].hash);
  assert.notEqual(third.lines[1].hash, first.lines[1].hash);

  await s.close();
});

test('a change of voice regenerates every line', async () => {
  const s = await fakeServer([{ body: half }]);
  const { script, out } = await setup([{ id: 'a', text: 'One' }]);
  await voice({ script, out, provider: 'openai', baseUrl: s.url });
  await voice({ script, out, provider: 'openai', baseUrl: s.url, voice: 'nova' });
  assert.equal(s.requests.length, 2);
  await s.close();
});

test('bad scripts are rejected before any request', async () => {
  for (const [lines, message] of [
    [[{ id: 'a/b', text: 'x' }], /must be letters/],
    [[{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }], /used twice/],
    [[{ id: 'a', text: '' }], /no text/],
  ]) {
    const { script, out } = await setup(lines);
    await assert.rejects(voice({ script, out, provider: 'openai', baseUrl: 'http://127.0.0.1:1' }), message);
  }
});
