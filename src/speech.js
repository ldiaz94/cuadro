// cuadro speech: text to spoken audio, through one adapter per provider.
// speak({ provider, text, voice, model, baseUrl, language }) resolves to
// { bytes, ext, words }: the audio file's contents, its extension, and
// when the provider gives them, the words' times (see timings.js; only
// ElevenLabs does). language, a BCP-47 code, goes to the providers that
// take one (ElevenLabs, Qwen); the others hear it in the text. Keys come
// only from environment variables and only ever go in a request header.
// Every adapter takes a baseUrl, so tests can point it at a fake server;
// address() says which one speak() uses.
// Providers: elevenlabs, gemini, openai (also any OpenAI-compatible server,
// such as a local Kokoro or Piper), qwen (Alibaba DashScope; its speech API
// is not OpenAI-compatible, so it has its own adapter).
// Depends on http.js and timings.js. Leaves out streaming, other formats, multiple
// speakers and voice cloning.
import { OpenAIUrl, get, need, openaiKey, post } from './http.js';
import { fromCharacters } from './timings.js';

/** Speaks text with the named provider; voice, model and baseUrl default per provider. */
export async function speak({ provider, text, voice, model, baseUrl, language }) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`cuadro: unknown provider "${provider}" (use ${Object.keys(adapters).join(', ')})`);
  const { voice: v, model: m } = defaults[provider];
  return adapter({ text, voice: voice ?? v, model: model ?? m, baseUrl: address(provider, baseUrl), language });
}

/** The default voice, model and API address of each provider, which also go into the cache hash. */
export const defaults = {
  elevenlabs: { voice: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2', baseUrl: 'https://api.elevenlabs.io' },
  gemini: { voice: 'Kore', model: 'gemini-3.8-flash-tts', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  openai: { voice: 'alloy', model: 'gpt-4o-mini-tts', baseUrl: OpenAIUrl },
  qwen: { voice: 'Cherry', model: 'qwen3-tts-flash', baseUrl: 'https://dashscope-intl.aliyuncs.com/api/v1' },
};

/** The API address speak() uses: baseUrl if given, else OPENAI_BASE_URL for openai, else the provider's default. */
export function address(provider, baseUrl) {
  return baseUrl || (provider === 'openai' && process.env.OPENAI_BASE_URL) || defaults[provider]?.baseUrl;
}

const adapters = { elevenlabs, gemini, openai, qwen };

// ElevenLabs text-to-speech with each character's time (mp3_44100_128 by
// default). language_code takes ISO 639-1, and models that cannot enforce a
// language (eleven_multilingual_v2) ignore it:
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
async function elevenlabs({ text, voice, model, baseUrl, language }) {
  const key = need('ELEVENLABS_API_KEY');
  const res = await post(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`, {
    provider: 'elevenlabs',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, ...(language && { language_code: primary(language) }) }),
  });
  const json = await res.json();
  if (!json.audio_base64) throw new Error('elevenlabs: the response holds no audio');
  return { bytes: Buffer.from(json.audio_base64, 'base64'), ext: 'mp3', words: json.alignment && fromCharacters(json.alignment, language) };
}

// Gemini speech generation, Interactions API: asks for raw 16-bit PCM
// (audio/l16, 24 kHz, mono) in base64, which is wrapped as a WAV file. It
// detects the language itself and gives no timings.
// https://aistudio.google.com/docs/speech-generation
async function gemini({ text, voice, model, baseUrl }) {
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

// OpenAI text-to-speech (mp3 by default; no language, no timings); OPENAI_BASE_URL (default
// https://api.openai.com/v1) points it at any compatible server, which may
// need no key, and gets OPENAI_COMPAT_API_KEY instead of OPENAI_API_KEY:
// https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
async function openai({ text, voice, model, baseUrl }) {
  const key = openaiKey(baseUrl);
  const res = await post(`${baseUrl}/audio/speech`, {
    provider: 'openai',
    headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
  });
  return { bytes: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

// Qwen3-TTS through DashScope (international endpoint; keys differ per
// region, so use baseUrl for Beijing). The reply holds a URL, valid for 24
// hours, from which the audio is downloaded; text is limited to 600 characters.
// language_type names one of QwenLanguages in English; others are left to Auto:
// https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api
async function qwen({ text, voice, model, baseUrl, language }) {
  const key = need('DASHSCOPE_API_KEY');
  const name = language && new Intl.DisplayNames(['en'], { type: 'language' }).of(primary(language));
  const res = await post(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    provider: 'qwen',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: { text, voice, ...(QwenLanguages.includes(name) && { language_type: name }) } }),
  });
  const url = (await res.json()).output?.audio?.url;
  if (!url) throw new Error('qwen: the response holds no audio url');
  const file = await get(url, { provider: 'qwen download' });
  const ext = new URL(url).pathname.match(/\.(\w+)$/)?.[1] ?? 'wav';
  return { bytes: Buffer.from(await file.arrayBuffer()), ext };
}

/** The languages Qwen3-TTS takes as language_type. */
const QwenLanguages = ['Chinese', 'English', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Portuguese', 'Russian', 'Spanish'];

/** The language subtag of a BCP-47 code: "pt" for "pt-BR". */
function primary(language) {
  return language.split('-')[0].toLowerCase();
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
