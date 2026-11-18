import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openaiKey } from '../src/http.js';
import { speak } from '../src/speech.js';
import { fakeServer } from './fake-server.js';

beforeEach(() => {
  for (const k of ['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_COMPAT_API_KEY', 'OPENAI_BASE_URL', 'DASHSCOPE_API_KEY']) delete process.env[k];
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

test('elevenlabs: audio and word times from the character alignment, and the language', async () => {
  process.env.ELEVENLABS_API_KEY = 'k1';
  const alignment = { characters: [...'Hi, you.'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] };
  const reply = { body: JSON.stringify({ audio_base64: Buffer.from('MP3').toString('base64'), alignment }) };
  const { out, req, body } = await run(reply, { provider: 'elevenlabs', voice: 'v9', language: 'pt-BR' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/text-to-speech/v9/with-timestamps');
  assert.equal(req.headers['xi-api-key'], 'k1');
  assert.deepEqual(body, { text: 'Hello', model_id: 'eleven_multilingual_v2', language_code: 'pt' });
  assert.deepEqual([out.bytes.toString(), out.ext], ['MP3', 'mp3']);
  assert.deepEqual(out.words, [{ text: 'Hi,', start: 0, end: 0.3 }, { text: 'you.', start: 0.4, end: 0.8 }]);
});

test('openai: OPENAI_API_KEY only for OpenAI, OPENAI_COMPAT_API_KEY for any other host', async () => {
  process.env.OPENAI_API_KEY = 'k-openai';
  let r = await run({ body: 'MP3' }, { provider: 'openai', model: 'tts-1' });
  assert.equal(r.req.url, '/audio/speech');
  assert.equal(r.req.headers.authorization, undefined, 'OpenAI\'s key must not go to another host');
  assert.deepEqual(r.body, { model: 'tts-1', input: 'Hello', voice: 'alloy', response_format: 'mp3' });
  assert.equal(r.out.ext, 'mp3');
  process.env.OPENAI_COMPAT_API_KEY = 'k-compat';
  r = await run({ body: 'MP3' }, { provider: 'openai' });
  assert.equal(r.req.headers.authorization, 'Bearer k-compat');
  assert.equal(openaiKey('https://api.openai.com/v1'), 'k-openai');
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

test('qwen downloads the audio from the returned url, retrying a failure', async () => {
  process.env.DASHSCOPE_API_KEY = 'k4';
  const file = await fakeServer([{ status: 503 }, { body: 'WAVDATA' }]);
  const reply = { body: JSON.stringify({ output: { audio: { url: `${file.url}/a.wav` } } }) };
  const { out, req, body } = await run(reply, { provider: 'qwen' });
  assert.equal(req.url, '/services/aigc/multimodal-generation/generation');
  assert.equal(req.headers.authorization, 'Bearer k4');
  assert.deepEqual(body, { model: 'qwen3-tts-flash', input: { text: 'Hello', voice: 'Cherry' } });
  assert.deepEqual([out.bytes.toString(), out.ext], ['WAVDATA', 'wav']);
  assert.deepEqual(file.requests.map((r) => r.method), ['GET', 'GET']);
  await file.close();
});

test('qwen names a language it knows, and leaves the rest to Auto', async () => {
  process.env.DASHSCOPE_API_KEY = 'k4';
  const file = await fakeServer([{ body: 'WAVDATA' }]);
  const reply = { body: JSON.stringify({ output: { audio: { url: `${file.url}/a.wav` } } }) };
  assert.equal((await run(reply, { provider: 'qwen', language: 'es-MX' })).body.input.language_type, 'Spanish');
  assert.equal((await run(reply, { provider: 'qwen', language: 'nl' })).body.input.language_type, undefined);
  await file.close();
});

test('a missing key and an unknown provider are clear errors', async () => {
  for (const [provider, name] of [['elevenlabs', 'ELEVENLABS_API_KEY'], ['gemini', 'GEMINI_API_KEY'], ['qwen', 'DASHSCOPE_API_KEY']]) {
    await assert.rejects(speak({ provider, text: 'x' }), new RegExp(`set ${name}`));
  }
  await assert.rejects(speak({ provider: 'nope', text: 'x' }), /unknown provider "nope"/);
});
