import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

test('another API address regenerates every line', async () => {
  const one = await fakeServer([{ body: half }]);
  const two = await fakeServer([{ body: half }]);
  const { script, out } = await setup([{ id: 'a', text: 'One' }]);
  await voice({ script, out, provider: 'openai', baseUrl: one.url });
  await voice({ script, out, provider: 'openai', baseUrl: two.url });
  assert.equal(two.requests.length, 1);
  await one.close();
  await two.close();
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

/** A 1.2 s WAV: 0.5 s of silence, then 0.7 s of a 440 Hz tone (36 frames at 30 fps). */
async function silenceThenTone(dir) {
  const file = join(dir, 'tone.wav');
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.7:sample_rate=16000', '-af', 'adelay=500:all=1', file]);
  return readFile(file);
}

test('levels: ceil(seconds * fps) of them, silence ~0, a tone ~1, 2 decimals', async () => {
  const { dir, script, out } = await setup([{ id: 'a', text: 'One' }]);
  const s = await fakeServer([{ body: await silenceThenTone(dir) }]);
  const { lines: [line] } = await voice({ script, out, provider: 'openai', baseUrl: s.url });
  assert.equal(line.levels.length, Math.ceil(line.seconds * 30));
  assert.ok(line.levels.slice(0, 13).every((v) => v < 0.05), 'silence');
  assert.ok(line.levels.slice(17, 33).every((v) => v > 0.95), 'tone');
  assert.equal(Math.max(...line.levels), 1);
  assert.ok(line.levels.every((v) => v === Math.round(v * 100) / 100));

  const fast = await voice({ script, out, provider: 'openai', baseUrl: s.url, fps: 10 });
  assert.equal(fast.lines[0].levels.length, Math.ceil(line.seconds * 10));
  assert.equal(JSON.parse(await readFile(join(out, 'voice.json'), 'utf8')).fps, 10);
  assert.equal(s.requests.length, 1, 'a new fps does not speak again');
  await s.close();
});

test('levels: a silent line stays all zeros', async () => {
  const { script, out } = await setup([{ id: 'a', text: 'One' }]);
  const s = await fakeServer([{ body: half }]);
  const { lines: [line] } = await voice({ script, out, provider: 'openai', baseUrl: s.url });
  assert.deepEqual(line.levels, new Array(15).fill(0));
  await s.close();
});

test('a cached line without levels gains them with no request', async () => {
  const { dir, script, out } = await setup([{ id: 'a', text: 'One' }]);
  const s = await fakeServer([{ body: await silenceThenTone(dir) }]);
  await voice({ script, out, provider: 'openai', baseUrl: s.url });
  const path = join(out, 'voice.json');
  const old = JSON.parse(await readFile(path, 'utf8'));
  delete old.lines[0].levels;
  await writeFile(path, JSON.stringify(old));
  const again = await voice({ script, out, provider: 'openai', baseUrl: s.url });
  assert.equal(s.requests.length, 1);
  assert.equal(again.lines[0].levels.length, 36);
  await s.close();
});

test('a scene script speaks its say lines, and a bad one fails with its path', async () => {
  const s = await fakeServer([{ body: half }]);
  const { script, out } = await setup([]);
  await writeFile(script, JSON.stringify({ scenes: [
    { type: 'title', props: { title: 'Hi' }, say: 'Hello' }, { code: 'scenes/x.js' }, { type: 'endCard', props: { line: 'Bye' }, say: 'Bye' }] }));
  const { lines } = await voice({ script, out, provider: 'openai', baseUrl: s.url });
  assert.deepEqual(lines.map((l) => l.id), ['scene1', 'scene3']);
  assert.deepEqual(s.requests.map((r) => JSON.parse(r.body).input), ['Hello', 'Bye']);
  await writeFile(script, JSON.stringify({ scenes: [{ type: 'title', props: {} }] }));
  await assert.rejects(voice({ script, out, provider: 'openai', baseUrl: s.url }), /scenes\[0\].props.title: missing/);
  await s.close();
});

test('words: estimated from the levels, kept when cached, regained with no request', async () => {
  const { dir, script, out } = await setup([{ id: 'a', text: 'One, two.' }]);
  const s = await fakeServer([{ body: await silenceThenTone(dir) }]);
  const { lines: [line] } = await voice({ script, out, provider: 'openai', baseUrl: s.url });
  assert.equal(line.wordsFrom, 'estimate');
  assert.deepEqual(line.words.map((w) => w.text), ['One,', 'two.']);
  assert.ok(line.words[0].start >= 0.45 && line.words[1].end <= 1.25, JSON.stringify(line.words));
  const path = join(out, 'voice.json');
  const old = JSON.parse(await readFile(path, 'utf8'));
  delete old.lines[0].words;
  await writeFile(path, JSON.stringify(old));
  assert.deepEqual((await voice({ script, out, provider: 'openai', baseUrl: s.url })).lines[0].words, line.words);
  assert.equal(s.requests.length, 1);
  await s.close();
});

test('words: the provider\'s own times win, and the script\'s language goes to it and into the hash', async () => {
  process.env.ELEVENLABS_API_KEY = 'k';
  const alignment = { characters: [...'Hola'], character_start_times_seconds: [0.1, 0.2, 0.3, 0.4], character_end_times_seconds: [0.2, 0.3, 0.4, 0.45] };
  const s = await fakeServer([{ body: JSON.stringify({ audio_base64: half.toString('base64'), alignment }) }]);
  const { script, out } = await setup([{ id: 'a', text: 'Hola' }]);
  await writeFile(script, JSON.stringify({ language: 'es', lines: [{ id: 'a', text: 'Hola' }] }));
  const { lines: [line] } = await voice({ script, out, provider: 'elevenlabs', baseUrl: s.url });
  assert.deepEqual([line.wordsFrom, line.words], ['elevenlabs', [{ text: 'Hola', start: 0.1, end: 0.45 }]]);
  assert.equal(JSON.parse(s.requests[0].body).language_code, 'es');
  await writeFile(script, JSON.stringify({ language: 'es-MX', lines: [{ id: 'a', text: 'Hola' }] }));
  await voice({ script, out, provider: 'elevenlabs', baseUrl: s.url });
  assert.equal(s.requests.length, 2, 'another language speaks again');
  delete process.env.ELEVENLABS_API_KEY;
  await s.close();
});
