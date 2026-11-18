import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chat } from '../src/llm.js';
import { make } from '../src/make.js';
import { wav } from '../src/speech.js';
import { fakeServer } from './fake-server.js';

beforeEach(() => {
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_COMPAT_API_KEY', 'OPENAI_BASE_URL']) delete process.env[k];
});

/** A one-pixel PNG's worth of bytes; the adapters only base64 it. */
const png = Buffer.from('PNG');

/** A conversation whose last user message carries an image. */
const messages = [
  { role: 'user', text: 'Make a video' },
  { role: 'assistant', text: 'Here it is' },
  { role: 'user', text: 'Look', images: [png] },
];

/** Runs chat against a fake server that sends reply; returns the result and the one request. */
async function run(reply, args) {
  const s = await fakeServer([reply]);
  try {
    const out = await chat({ system: 'be brief', messages, ...args, baseUrl: s.url });
    return { out, req: s.requests[0], body: JSON.parse(s.requests[0].body) };
  } finally {
    await s.close();
  }
}

/** An Anthropic reply holding text, with a thinking block to ignore. */
const said = (text, extra = {}) => ({
  body: JSON.stringify({ content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text }], stop_reason: 'end_turn', ...extra }),
});

test('anthropic: URL, headers, body and reply', async () => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const { out, req, body } = await run(said('hi'), { provider: 'anthropic' });
  assert.equal(out, 'hi');
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'ka');
  assert.equal(req.headers['anthropic-version'], '2026-10-21');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.system, 'be brief');
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'high' });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.equal(k in body, false, k);
  assert.deepEqual(body.messages[1], { role: 'assistant', content: [{ type: 'text', text: 'Here it is' }] });
  assert.deepEqual(body.messages[2].content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    { type: 'text', text: 'Look' },
  ]);
});

test('anthropic: a refusal, a cut-off reply, and an error without the key', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-secret-key';
  await assert.rejects(run(said('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } }), { provider: 'anthropic' }), /refused \(cyber\)/);
  await assert.rejects(run(said('half', { stop_reason: 'max_tokens' }), { provider: 'anthropic' }), /cut off/);
  const e = await run({ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }, { provider: 'anthropic' }).catch((e) => e);
  assert.match(e.message, /anthropic: HTTP 401: invalid x-api-key/);
  assert.doesNotMatch(e.message, /sk-secret-key/);
});

test('gemini: stateless steps, inline image, last model output', async () => {
  process.env.GEMINI_API_KEY = 'kg';
  const reply = { steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'g' }, { type: 'text', text: 'o' }] }] };
  const { out, req, body } = await run({ body: JSON.stringify(reply) }, { provider: 'gemini' });
  assert.equal(out, 'go');
  assert.equal(req.url, '/interactions');
  assert.equal(req.headers['x-goog-api-key'], 'kg');
  assert.equal(body.model, 'gemini-4-hydrogen');
  assert.equal(body.system_instruction, 'be brief');
  assert.equal(body.store, false);
  assert.deepEqual(body.input[1], { type: 'model_output', content: [{ type: 'text', text: 'Here it is' }] });
  assert.deepEqual(body.input[2], {
    type: 'user_input',
    content: [{ type: 'image', data: png.toString('base64'), mime_type: 'image/png' }, { type: 'text', text: 'Look' }],
  });
});

test('gemini: a reply without a model_output step says its status and steps', async () => {
  process.env.GEMINI_API_KEY = 'kg';
  const reply = { status: 'incomplete', steps: [{ type: 'thought' }] };
  await assert.rejects(run({ body: JSON.stringify(reply) }, { provider: 'gemini' }), /no model_output step \(status incomplete; steps: thought\)/);
});

test('openai: system message, data URL image, refusal', async () => {
  process.env.OPENAI_API_KEY = 'k-openai'; // OpenAI's own key never goes to another host
  process.env.OPENAI_COMPAT_API_KEY = 'ko';
  const reply = (message, finish_reason = 'stop') => ({ body: JSON.stringify({ choices: [{ message, finish_reason }] }) });
  const { out, req, body } = await run(reply({ content: 'yo', refusal: null }), { provider: 'openai', model: 'local' });
  assert.equal(out, 'yo');
  assert.equal(req.url, '/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer ko');
  assert.equal(body.model, 'local');
  assert.deepEqual(body.messages.slice(0, 3), [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'Make a video' },
    { role: 'assistant', content: 'Here it is' },
  ]);
  assert.deepEqual(body.messages[3].content, [
    { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
    { type: 'text', text: 'Look' },
  ]);
  await assert.rejects(run(reply({ content: null, refusal: 'no' }), { provider: 'openai' }), /refused: no/);
  await assert.rejects(run(reply({ content: 'ha' }, 'length'), { provider: 'openai' }), /cut off/);
});

/** A video.js that throws as it loads. */
const broken = "import { composition } from 'cuadro';\nthrow new Error('boom at load');\n";

/** A small video.js whose box moves across the frame. */
const working = `import { composition, html } from 'cuadro';
composition({
  width: 64, height: 36, fps: 10, durationInFrames: 20,
  view: (frame) => html\`<div style="position:absolute;inset:0;background:#000">
    <b style=\${() => ({ position: 'absolute', top: '10px', width: '8px', height: '8px', background: '#fff', left: frame() * 2 + 'px' })}></b></div>\`,
});
`;

/** A temporary output folder under the repo (served as the root), removed afterwards. */
async function folder(t) {
  const out = await mkdtemp(join('test', 'tmp-make-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  return out;
}

test('make: a broken file, then a working one, then OK', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([said('```js\n' + broken + '```'), said('Fixed:\n```js\n' + working + '```'), said('Looks good, OK')]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'a moving box', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });

  assert.equal(s.requests.length, 3);
  const bodies = s.requests.map((r) => JSON.parse(r.body));
  assert.match(bodies[0].system, /export function composition/);
  assert.match(bodies[0].system, /## Learn it/);
  const second = bodies[1].messages.at(-1).content.at(-1).text;
  assert.match(second, /boom at load/);
  const third = bodies[2].messages.at(-1).content;
  assert.equal(third.filter((c) => c.type === 'image').length, 5);
  assert.equal(bodies[2].messages.length, 5);
  assert.equal(await readFile(result.file, 'utf8'), working);
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /"cuadro":"\/src\/index.js"/);
  assert.deepEqual(steps.map((m) => m.split(':')[0]), ['round 1', 'round 2', 'done']);
});

test('make: a reply without a js block is a clear error', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([said('Sure, here is my plan.')]);
  t.after(() => s.close());
  await assert.rejects(make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out }), /without a ```js block/);
});

test('make: out must be a folder inside root, not root itself', async () => {
  for (const out of ['.', '..', '/tmp']) await assert.rejects(make({ prompt: 'x', provider: 'anthropic', out }), /must be a folder inside/);
});

test('make: after a file passed, a failed fix and then an API error leave the passed file', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([said('```js\n' + working + '```'), said('```js\n' + broken + '```'), { status: 400, body: 'bad request' }]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });
  assert.equal(await readFile(result.file, 'utf8'), working);
  assert.match(steps.at(-2), /^stopped: anthropic: HTTP 400/);
});

test('make: a still video passes, with a note for the review', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const still = working.replace("frame() * 2 + 'px'", "'4px'");
  const s = await fakeServer([said('```js\n' + still + '```'), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'a title card', provider: 'anthropic', baseUrl: s.url, out });
  assert.match(JSON.parse(s.requests[1].body).messages.at(-1).content.at(-1).text, /Note: frames 0, 5, 10, 14, 19 are all identical/);
  assert.equal(await readFile(join(out, 'video.js'), 'utf8'), still);
});

test('make: the page may read only its folder and the libraries, and nothing from the network', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const prying = `const status = (url) => fetch(url).then((r) => r.status, () => 'blocked');
const found = [await status('/package.json'), await status('https://example.com/'), await status('./index.html')];
throw new Error('fetched ' + found.join(' '));
`;
  const s = await fakeServer([said('```js\n' + prying + '```'), said('```js\n' + working + '```'), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
  const problem = JSON.parse(s.requests[1].body).messages.at(-1).content.at(-1).text;
  assert.match(problem, /fetched 404 blocked 200/);
});

test('make: a frame that never finishes is a problem sent back, not a hang', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const stuck = working.replace("left: frame() * 2 + 'px'", "left: (frame() > 0 ? stall() : 0) + 'px'") + 'function stall() { for (;;); }\n';
  const s = await fakeServer([said('```js\n' + stuck + '```'), said('```js\n' + working + '```'), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, timeout: 1000 });
  const problem = JSON.parse(s.requests[1].body).messages.at(-1).content.at(-1).text;
  assert.match(problem, /setFrame\(5\) took longer than 1 s/);
  assert.equal(await readFile(join(out, 'video.js'), 'utf8'), working);
});

test('make: narration speaks the script and hands voice.json to the model', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const speech = await fakeServer([{ body: wav(Buffer.alloc(8000), 8000) }]);
  t.after(() => speech.close());
  process.env.OPENAI_BASE_URL = speech.url;
  const narrated = working.replace("import { composition, html } from 'cuadro';",
    "import { composition, audio, html } from 'cuadro';\nimport voice from './voice/voice.json' with { type: 'json' };\nvoid audio('voice/' + voice.lines[0].file);");
  const script = '```json\n{ "lines": [{ "id": "intro", "text": "Hello" }] }\n```';
  const s = await fakeServer([said(script), said('```js\n' + narrated + '```'), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'a box, narrated', provider: 'anthropic', baseUrl: s.url, out, voiceProvider: 'openai' });

  assert.equal(speech.requests.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'script.json'), 'utf8')).lines, [{ id: 'intro', text: 'Hello' }]);
  const request = JSON.parse(s.requests[1].body).messages.at(-1).content.at(-1).text;
  assert.match(request, /"id": "intro"/);
  assert.match(request, /"seconds": 0\.5/);
  assert.equal(await readFile(join(out, 'video.js'), 'utf8'), narrated);
});
