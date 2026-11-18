import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** A script with one code scene between two designed ones. */
const script = JSON.stringify({ theme: 'bold', scenes: [
  { type: 'title', props: { title: 'A *box*' }, say: 'A box.' },
  { code: 'scenes/box.js', say: 'It moves.' },
  { type: 'endCard', props: { line: 'Bye' }, say: 'Bye.' }] }, null, 2);

/** The code scene: a box moving across the frame. */
const box = `import { html } from 'cuadro';
import { scene } from 'cuadro/scenes';
export default ({ length }) => scene(length, (t) => html\`<b style=\${() => ({ position: 'absolute', left: t.frame() + 'px', width: '40px', height: '40px', background: 'var(--accent)' })}></b>\`);
`;

/** A code scene that throws as it loads. */
const broken = "throw new Error('boom at load');\n";

/** A reply holding script.json and the given code scenes, by path. */
const reply = (json, modules = {}) => said('Here:\n```json\n' + json + '\n```\n'
  + Object.entries(modules).map(([path, source]) => '```js ' + path + '\n' + source + '```\n').join(''));

/** The text of the last user message of request i to the fake server s. */
const lastText = (s, i) => JSON.parse(s.requests[i].body).messages.at(-1).content.at(-1).text;

/** A temporary output folder under the repo (served as the root), removed afterwards. */
async function folder(t) {
  const out = await mkdtemp(join('test', 'tmp-make-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  return out;
}

test('make: a schema error, a broken code scene, then a working script, then OK', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const bad = JSON.stringify({ scenes: [{ type: 'tiles', props: { items: 'a, b' } }] });
  const s = await fakeServer([reply(bad), reply(script, { 'scenes/box.js': broken }), reply(script, { 'scenes/box.js': box }), said('Looks good, OK')]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'a moving box', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });

  assert.equal(s.requests.length, 4);
  const { system } = JSON.parse(s.requests[0].body);
  assert.match(system, /"tiles": \{ title\?: string; items: Item\[\] \}/);
  assert.match(system, /items: 2 to 6 items/);
  assert.match(system, /- dark: background #0c0e14/);
  assert.match(system, /What a code scene gets/);
  assert.match(lastText(s, 1), /scenes\[0\].props.items: expected an array/);
  assert.match(lastText(s, 2), /boom at load/);
  const images = JSON.parse(s.requests[3].body).messages.at(-1).content.filter((c) => c.type === 'image');
  assert.equal(images.length, 5, 'one still per designed scene, three for the code scene');
  assert.equal(await readFile(result.file, 'utf8'), script + '\n');
  assert.equal(await readFile(join(out, 'scenes', 'box.js'), 'utf8'), box);
  const index = await readFile(result.page, 'utf8');
  assert.match(index, /"cuadro\/player":"\/src\/player.js"/);
  assert.match(index, /player\(\{ voice: null \}\)/);
  assert.deepEqual(steps.map((m) => m.replace(/ \(\/.*\)$/, '')), [
    'round 1: asking anthropic…', 'round 1: script.json: scenes[0].props.items: expected an array',
    'round 2: asking anthropic…', 'round 2: page error: boom at load', // the place follows, as ' (/path:1:7)'
    'round 3: asking anthropic…', 'round 3: ok, reviewing',
    'round 4: asking anthropic…', `done: ${result.file}`,
  ]);
  assert.equal(result.reviewed, true);
});

test('make: a code scene missing from the reply goes back; one named on its first line is found', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const named = said('```json\n' + script + '\n```\n```js\n// scenes/box.js\n' + box + '```');
  const s = await fakeServer([reply(script), named, said('OK')]);
  t.after(() => s.close());
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
  assert.match(lastText(s, 1), /scenes\[1\].code: the reply has no ```js scenes\/box.js block/);
  assert.equal(result.reviewed, true);
});

test('make: a reply without a json block is a clear error', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([said('Sure, here is my plan.')]);
  t.after(() => s.close());
  await assert.rejects(make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out }), /without a ```json block/);
});

test('make: out must be a folder inside root, not root itself', async () => {
  for (const out of ['.', '..', '/tmp']) await assert.rejects(make({ prompt: 'x', provider: 'anthropic', out }), /must be a folder inside/);
});

test('make: after a script passed, a failed fix and then an API error leave the passed files', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const worse = script.replace('A *box*', 'A worse box');
  const s = await fakeServer([reply(script, { 'scenes/box.js': box }), reply(worse, { 'scenes/box.js': broken }), { status: 400, body: 'bad request' }]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });
  assert.equal(await readFile(result.file, 'utf8'), script + '\n');
  assert.equal(await readFile(join(out, 'scenes', 'box.js'), 'utf8'), box);
  assert.match(steps.at(-2), /^stopped: anthropic: HTTP 400/);
  assert.equal(result.reviewed, false);
});

test('make: a review that fails twice keeps the passed script, unreviewed', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([reply(script, { 'scenes/box.js': box }), said('', { stop_reason: 'max_tokens' }), said('', { stop_reason: 'max_tokens' })]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });
  assert.equal(s.requests.length, 3);
  assert.equal(result.reviewed, false);
  assert.match(steps.at(-1), /^not reviewed: .* passed the check/);
});

test('make: the page may read only its folder and the libraries, and nothing from the network', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const prying = `const status = (url) => fetch(url).then((r) => r.status, () => 'blocked');
const found = [await status('/package.json'), await status('https://example.com/'), await status('./index.html')];
throw new Error('fetched ' + found.join(' '));
`;
  const s = await fakeServer([reply(script, { 'scenes/box.js': prying }), reply(script, { 'scenes/box.js': box }), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
  assert.match(lastText(s, 1), /fetched 404 blocked 200/);
});

test('make: a frame that never finishes is a problem sent back, not a hang', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const stuck = box.replace("left: t.frame() + 'px'", "left: (t.frame() > 0 ? stall() : 0) + 'px'") + 'function stall() { for (;;); }\n';
  const s = await fakeServer([reply(script, { 'scenes/box.js': stuck }), reply(script, { 'scenes/box.js': box }), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, timeout: 1000 });
  assert.match(lastText(s, 1), /setFrame\(\d+\) took longer than 1 s/);
  assert.equal(await readFile(join(out, 'scenes', 'box.js'), 'utf8'), box);
});

test('make: narration speaks the say lines, and the stills follow their lengths', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const speech = await fakeServer([{ body: wav(Buffer.alloc(8000 * 3), 8000) }]); // 1.5 s a line
  t.after(() => speech.close());
  process.env.OPENAI_BASE_URL = speech.url;
  const s = await fakeServer([reply(script, { 'scenes/box.js': box }), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'a box, narrated', provider: 'anthropic', baseUrl: s.url, out, voiceProvider: 'openai' });

  assert.deepEqual(speech.requests.map((r) => JSON.parse(r.body).input), ['A box.', 'It moves.', 'Bye.']);
  const { lines } = JSON.parse(await readFile(join(out, 'voice', 'voice.json'), 'utf8'));
  assert.deepEqual(lines.map((l) => l.id), ['scene1', 'scene2', 'scene3']);
  // 45 frames a line: lengths 65, 65 and 90; stills 3/4 into the designed scenes, three in the code scene
  assert.match(lastText(s, 1), /at frames 49, 69, 89, 108, 174:/);
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /await player\(\);/);
});

test('make: a syntax error in a code scene names its file and line', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([reply(script, { 'scenes/box.js': 'const a = 1;\nvar var = 2;\n' }), reply(script, { 'scenes/box.js': box }), said('OK')]);
  t.after(() => s.close());
  await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
  assert.match(lastText(s, 1), /scenes\/box\.js:2:\d+/);
});

test('make: the logo, brand colours, music, language and format are copied in and set over what the model writes', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const music = join(out, 'tune.wav');
  await writeFile(music, wav(Buffer.alloc(8000), 8000));
  const own = JSON.stringify({ ...JSON.parse(script), brand: { accent: '#000000', logo: 'mine.png' }, music: 'other.mp3' }, null, 2);
  const s = await fakeServer([reply(own, { 'scenes/box.js': box }), said('OK')]);
  t.after(() => s.close());
  const result = await make({
    prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, logo: 'test/dot.svg', brand: { accent: '#4d65ff', accent2: '#f7a072' }, music,
    language: 'pt-br', format: '9:16',
  });
  const written = JSON.parse(await readFile(result.file, 'utf8'));
  assert.deepEqual(written.brand, { accent: '#4d65ff', logo: 'logo.svg', accent2: '#f7a072' });
  assert.equal(written.music, 'music.wav');
  assert.equal(written.language, 'pt-BR');
  assert.equal(written.format, '9:16');
  assert.match(lastText(s, 0), /all the text on screen in Brazilian Portuguese \(pt-BR\)/);
  assert.match(s.requests[0].body, /720x1280 stage \(9:16, portrait/);
  assert.deepEqual(await readFile(join(out, 'logo.svg')), await readFile('test/dot.svg'));
  assert.deepEqual(await readFile(join(out, 'music.wav')), await readFile(music));
  assert.match(lastText(s, 0), /cuadro sets these fields itself, so keep them: .*"music":"music.wav".*The endCard shows the logo/);
  assert.equal(result.reviewed, true);
});

/** A review reply: numbered defects, then a corrected script and the box scene. */
const defects = (list, json = script) => said(list.map((d, i) => `${i + 1}. ${d}`).join('\n') + '\n```json\n' + json + '\n```\n```js scenes/box.js\n' + box + '```');

test('make: a review that repeats the last one\'s defects stops, unreviewed', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([
    reply(script, { 'scenes/box.js': box }),
    defects(['Scene 1: the title is too small.', 'Scene 3: the end card is empty.']),
    defects(['Scene 3: the end card looks empty.', 'Scene 1: title too small.']),
    said('OK'),
  ]);
  t.after(() => s.close());
  const steps = [];
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, onStep: (m) => steps.push(m) });
  assert.equal(s.requests.length, 3);
  assert.match(lastText(s, 1), /numbered list of the\ndefects/);
  assert.equal(steps.at(-2), 'round 3: the review lists the same defects as the last one; stopping');
  assert.equal(result.reviewed, false);
});

test('make: new defects every review run out the rounds, unreviewed', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([
    reply(script, { 'scenes/box.js': box }),
    defects(['Scene 1: the title is too small.']),
    defects(['Scene 2: the box leaves the frame.']),
    said('OK'),
  ]);
  t.after(() => s.close());
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out, rounds: 2 });
  assert.equal(s.requests.length, 3);
  assert.equal(result.reviewed, false);
});

test('make: a review that only ends with OK, or opens with OK and lists defects, is no approval', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  for (const verdict of ['1. Scene 1: the title is too small.\n\nEverything else looks OK.', 'OK, one defect:\n1. Scene 1: the title is too small.']) {
    const out = await folder(t);
    const s = await fakeServer([reply(script, { 'scenes/box.js': box }), said(verdict), said('OK')]);
    t.after(() => s.close());
    const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
    assert.equal(s.requests.length, 2, verdict);
    assert.equal(result.reviewed, false, verdict);
  }
});

test('make: a bold OK after defects approves', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'ka';
  const out = await folder(t);
  const s = await fakeServer([reply(script, { 'scenes/box.js': box }), defects(['Scene 1: the title is too small.']), said('**OK**')]);
  t.after(() => s.close());
  const result = await make({ prompt: 'x', provider: 'anthropic', baseUrl: s.url, out });
  assert.equal(s.requests.length, 3);
  assert.equal(result.reviewed, true);
});
