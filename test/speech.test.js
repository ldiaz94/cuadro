import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { speak } from '../src/speech.js';
import { fakeServer } from './fake-server.js';

beforeEach(() => {
  for (const k of ['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY']) delete process.env[k];
});

/** Runs speak against a fake server that sends reply; returns the result and the one request. */
async function run(reply, args) {
  const s = await fakeServer([reply]);
  try {
    const out = await speak({ ...args, text: 'Hello', baseUrl: s.url });
    return { out, req: s.requests[0], body: s.requests[0].body && JSON.parse(s.requests[0].body) };
  } finally {
    await s.close();
  }
}

test('elevenlabs', async () => {
  process.env.ELEVENLABS_API_KEY = 'k1';
  const { out, req, body } = await run({ body: 'MP3' }, { provider: 'elevenlabs', voice: 'v9' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/text-to-speech/v9');
  assert.equal(req.headers['xi-api-key'], 'k1');
  assert.deepEqual(body, { text: 'Hello', model_id: 'eleven_multilingual_v2' });
  assert.deepEqual([out.bytes.toString(), out.ext], ['MP3', 'mp3']);
});

test('openai, with and without a key', async () => {
  process.env.OPENAI_API_KEY = 'k2';
  let r = await run({ body: 'MP3' }, { provider: 'openai', model: 'tts-1' });
  assert.equal(r.req.url, '/audio/speech');
  assert.equal(r.req.headers.authorization, 'Bearer k2');
  assert.deepEqual(r.body, { model: 'tts-1', input: 'Hello', voice: 'alloy', response_format: 'mp3' });
  delete process.env.OPENAI_API_KEY;
  r = await run({ body: 'MP3' }, { provider: 'openai' });
  assert.equal(r.req.headers.authorization, undefined);
  assert.equal(r.out.ext, 'mp3');
});

test('gemini wraps PCM as a WAV file', async () => {
  process.env.GEMINI_API_KEY = 'k3';
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
  const reply = { body: JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcm.toString('base64') }] }] }) };
  const { out, req, body } = await run(reply, { provider: 'gemini' });
  assert.equal(req.url, '/interactions');
  assert.equal(req.headers['x-goog-api-key'], 'k3');
  assert.equal(body.model, 'gemini-3.8-flash-tts');
  assert.deepEqual(body.generation_config.speech_config, [{ voice: 'Kore' }]);
  const w = out.bytes;
  assert.equal(out.ext, 'wav');
  assert.equal(w.toString('latin1', 0, 4), 'RIFF');
  assert.equal(w.toString('latin1', 8, 16), 'WAVEfmt ');
  assert.equal(w.readUInt32LE(4), 36 + pcm.length);
  assert.equal(w.readUInt32LE(24), 24000);
  assert.equal(w.readUInt16LE(34), 16);
  assert.equal(w.readUInt32LE(40), pcm.length);
  assert.deepEqual(w.subarray(44), pcm);
});

test('qwen downloads the audio from the returned url', async () => {
  process.env.DASHSCOPE_API_KEY = 'k4';
  const file = await fakeServer([{ body: 'WAVDATA' }]);
  const reply = { body: JSON.stringify({ output: { audio: { url: `${file.url}/a.wav` } } }) };
  const { out, req, body } = await run(reply, { provider: 'qwen' });
  assert.equal(req.url, '/services/aigc/multimodal-generation/generation');
  assert.equal(req.headers.authorization, 'Bearer k4');
  assert.deepEqual(body, { model: 'qwen3-tts-flash', input: { text: 'Hello', voice: 'Cherry' } });
  assert.deepEqual([out.bytes.toString(), out.ext], ['WAVDATA', 'wav']);
  await file.close();
});

test('a missing key and an unknown provider are clear errors', async () => {
  for (const [provider, name] of [['elevenlabs', 'ELEVENLABS_API_KEY'], ['gemini', 'GEMINI_API_KEY'], ['qwen', 'DASHSCOPE_API_KEY']]) {
    await assert.rejects(speak({ provider, text: 'x' }), new RegExp(`set ${name}`));
  }
  await assert.rejects(speak({ provider: 'nope', text: 'x' }), /unknown provider "nope"/);
});
