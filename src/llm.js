// cuadro llm: one chat request to a language model, through one adapter per
// provider.
// chat({ provider, model, system, messages, baseUrl }) resolves to the
// reply's text. A message is { role: 'user' | 'assistant', text, images },
// where images (user messages only) is a list of PNG files as Buffers,
// sent before the text. Keys come only from environment variables and only
// ever go in a request header. Every adapter takes a baseUrl, so tests can
// point it at a fake server.
// Providers: anthropic, gemini, openai (also any OpenAI-compatible server).
// Depends on http.js. Leaves out streaming, tools, caching and every other
// kind of attachment.
import { OpenAIUrl, need, openaiKey, post } from './http.js';

/** Asks the named provider for a reply to messages; model defaults per provider. */
export async function chat({ provider, model, system, messages, baseUrl }) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`cuadro: unknown provider "${provider}" (use ${Object.keys(adapters).join(', ')})`);
  return adapter({ model: model ?? models[provider], system, messages, baseUrl });
}

/** The default model of each provider. */
export const models = {
  anthropic: 'claude-opus-5-5',
  gemini: 'gemini-4-hydrogen',
  openai: 'gpt-6.2-astra',
};

const adapters = { anthropic, gemini, openai };

/** The most a reply may hold, in tokens; a video.js is well under it. */
const MaxTokens = 16000;

/** How long to wait for one reply, in milliseconds: a model that thinks is slow. */
const Timeout = 600000;

/** Retries of a failed request: one, as a request that timed out may still have been billed. */
const Retries = 1;

// Anthropic Messages API, with server-side fallback to another model when
// the chosen one is overloaded. Sampling parameters and `thinking` are left
// out: this API version rejects the first, and the model thinks by itself.
// https://platform.claude.com/docs/en/api/messages
async function anthropic({ model, system, messages, baseUrl = 'https://api.anthropic.com' }) {
  const key = need('ANTHROPIC_API_KEY');
  const image = (png) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });
  const res = await post(`${baseUrl}/v1/messages`, {
    provider: 'anthropic',
    timeout: Timeout,
    retries: Retries,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MaxTokens,
      system,
      messages: messages.map(({ role, text, images = [] }) => ({ role, content: [...images.map(image), { type: 'text', text }] })),
      fallbacks: 'default',
      output_config: { effort: 'high' },
    }),
  });
  const json = await res.json();
  if (json.stop_reason === 'refusal') throw new Error(`anthropic: the model refused (${json.stop_details?.category ?? 'no category given'})`);
  if (json.stop_reason === 'max_tokens') throw new Error('anthropic: the reply was cut off at the token limit');
  return reply('anthropic', (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text));
}

// Gemini Interactions API, stateless (store: false): the whole conversation
// goes in `input` as user_input and model_output steps, and the reply is the
// last model_output step's text.
// https://aistudio.google.com/docs/text-generation
// https://aistudio.google.com/docs/image-understanding
async function gemini({ model, system, messages, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
  const key = need('GEMINI_API_KEY');
  const image = (png) => ({ type: 'image', data: png.toString('base64'), mime_type: 'image/png' });
  const step = ({ role, text, images = [] }) => role === 'user'
    ? { type: 'user_input', content: [...images.map(image), { type: 'text', text }] }
    : { type: 'model_output', content: [{ type: 'text', text }] };
  const res = await post(`${baseUrl}/interactions`, {
    provider: 'gemini',
    timeout: Timeout,
    retries: Retries,
    headers: { 'x-goog-api-key': key, 'api-revision': '2026-05-20', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      system_instruction: system,
      input: messages.map(step),
      store: false,
      generation_config: { max_output_tokens: MaxTokens },
    }),
  });
  const json = await res.json();
  const last = (json.steps ?? []).filter((s) => s.type === 'model_output').at(-1);
  return reply('gemini', (last?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text));
}

// OpenAI Chat Completions; OPENAI_BASE_URL (default
// https://api.openai.com/v1) points it at any compatible server, which may
// need no key, and gets OPENAI_COMPAT_API_KEY instead of OPENAI_API_KEY. The instructions go as a `system` message, which OpenAI
// still accepts and compatible servers understand (newer OpenAI docs call
// it `developer`). Images go as base64 data URLs.
// https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
// https://developers.openai.com/api/docs/guides/images-vision
async function openai({ model, system, messages, baseUrl = process.env.OPENAI_BASE_URL || OpenAIUrl }) {
  const key = openaiKey(baseUrl);
  const image = (png) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } });
  const message = ({ role, text, images = [] }) => images.length
    ? { role, content: [...images.map(image), { type: 'text', text }] }
    : { role, content: text };
  const res = await post(`${baseUrl}/chat/completions`, {
    provider: 'openai',
    timeout: Timeout,
    retries: Retries,
    headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages.map(message)] }),
  });
  const choice = (await res.json()).choices?.[0];
  if (choice?.message?.refusal) throw new Error(`openai: the model refused: ${choice.message.refusal}`);
  if (choice?.finish_reason === 'length') throw new Error('openai: the reply was cut off at the token limit');
  return reply('openai', [choice?.message?.content ?? '']);
}

/** The reply's text parts joined, or an error if there is no text. */
function reply(provider, parts) {
  const text = parts.join('');
  if (!text.trim()) throw new Error(`${provider}: the reply holds no text`);
  return text;
}
