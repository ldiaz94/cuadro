// cuadro speech: text to spoken audio, through one adapter per provider.
// speak({ provider, text, voice, model, baseUrl }) resolves to
// { bytes, ext }: the audio file's contents and its extension. Keys come
// only from environment variables and only ever go in a request header.
// Every adapter takes a baseUrl, so tests can point it at a fake server.
// Providers: elevenlabs, gemini, openai (also any OpenAI-compatible server,
// such as a local Kokoro or Piper), qwen (Alibaba DashScope; its speech API
// is not OpenAI-compatible, so it has its own adapter).
// Depends on http.js. Leaves out streaming, other formats, multiple
// speakers and voice cloning.
import { post } from './http.js';

/** Speaks text with the named provider; voice and model default per provider. */
export async function speak({ provider, text, voice, model, baseUrl }) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`cuadro: unknown provider "${provider}" (use ${Object.keys(adapters).join(', ')})`);
  return adapter({ text, voice: voice ?? defaults[provider].voice, model: model ?? defaults[provider].model, baseUrl });
}

/** The default voice and model of each provider, which also go into the cache hash. */
export const defaults = {
  elevenlabs: { voice: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2' },
  gemini: { voice: 'Kore', model: 'gemini-3.8-flash-tts' },
  openai: { voice: 'alloy', model: 'gpt-4o-mini-tts' },
  qwen: { voice: 'Cherry', model: 'qwen3-tts-flash' },
};

const adapters = { elevenlabs, gemini, openai, qwen };

// ElevenLabs text-to-speech (mp3_44100_128 by default):
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert
async function elevenlabs({ text, voice, model, baseUrl = 'https://api.elevenlabs.io' }) {
  const key = need('ELEVENLABS_API_KEY');
  const res = await post(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    provider: 'elevenlabs',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
  });
  return { bytes: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

// Gemini speech generation, Interactions API: asks for raw 16-bit PCM
// (audio/l16, 24 kHz, mono) in base64, which is wrapped as a WAV file.
// https://aistudio.google.com/docs/speech-generation
async function gemini({ text, voice, model, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
  const key = need('GEMINI_API_KEY');
  const res = await post(`${baseUrl}/interactions`, {
    provider: 'gemini',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: GeminiRate },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  const json = await res.json();
  const parts = (json.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []);
  const audio = parts.filter((p) => p.type === 'audio' && p.data).at(-1);
  if (!audio) throw new Error('gemini: the response holds no audio');
  const bytes = Buffer.from(audio.data, 'base64');
  // A server that already sends a WAV file needs no wrapping.
  return { bytes: bytes.subarray(0, 4).toString() === 'RIFF' ? bytes : wav(bytes, GeminiRate), ext: 'wav' };
}

/** Sample rate asked of Gemini, in Hz. */
const GeminiRate = 24000;

// OpenAI text-to-speech (mp3 by default); OPENAI_BASE_URL (default
// https://api.openai.com/v1) points it at any compatible server, which may
// need no key:
// https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
async function openai({ text, voice, model, baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1' }) {
  const key = process.env.OPENAI_API_KEY;
  const res = await post(`${baseUrl}/audio/speech`, {
    provider: 'openai',
    headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
  });
  return { bytes: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

// Qwen3-TTS through DashScope (international endpoint; keys differ per
// region, so use baseUrl for Beijing). The reply holds a URL, valid for 24
// hours, from which the audio is downloaded; text is limited to 600 characters:
// https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
async function qwen({ text, voice, model, baseUrl = 'https://dashscope-intl.aliyuncs.com/api/v1' }) {
  const key = need('DASHSCOPE_API_KEY');
  const res = await post(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    provider: 'qwen',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: { text, voice } }),
  });
  const url = (await res.json()).output?.audio?.url;
  if (!url) throw new Error('qwen: the response holds no audio url');
  const file = await fetch(url);
  if (!file.ok) throw new Error(`qwen: downloading the audio failed: HTTP ${file.status}`);
  const ext = new URL(url).pathname.match(/\.(\w+)$/)?.[1] ?? 'wav';
  return { bytes: Buffer.from(await file.arrayBuffer()), ext };
}

/** The value of an environment variable, or an error naming it. */
function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`cuadro: set ${name} to use this provider`);
  return value;
}

/** Wraps 16-bit mono little-endian PCM as a WAV file at the given sample rate. */
export function wav(pcm, rate) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); // fmt chunk size
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); // bytes per second
  head.writeUInt16LE(2, 32); // bytes per sample frame
  head.writeUInt16LE(16, 34); // bits per sample
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
