import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { translate } from '../src/translate.js';
import { fakeServer } from './fake-server.js';

const script = {
  theme: 'bold', brand: { accent: '#4d65ff', logo: 'logo.svg' },
  scenes: [
    { type: 'steps', props: { title: 'How it *works*', items: [{ title: 'Sign up' }, { title: 'Meet', text: 'mentors' }] }, say: 'Sign up, then meet.' },
    { code: 'scenes/twin.js', props: { label: 'Twin', image: 'twin.png' }, say: 'Meet the twin.' },
    { type: 'endCard', props: { logo: 'logo.svg', line: 'Go', url: 'x.com' } },
  ],
};

/** An OpenAI-style reply holding text. */
const reply = (text) => ({ body: JSON.stringify({ choices: [{ message: { content: text } }] }) });

test('translate swaps only the words, sets the language, and writes script.<lang>.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuadro-translate-'));
  const file = join(dir, 'script.json');
  await writeFile(file, JSON.stringify(script));
  const spanish = ['Cómo *funciona*', 'Regístrate', 'Conoce', 'mentores', 'Regístrate y conoce.', 'Gemelo', 'Conoce al gemelo.', 'Vamos', 'x.com'];
  const s = await fakeServer([reply('Aquí está:\n```json\n' + JSON.stringify(spanish) + '\n```')]);
  const out = await translate({ script: file, to: 'ES', provider: 'openai', baseUrl: s.url });
  assert.equal(out, join(dir, 'script.es.json'));
  const sent = JSON.parse(s.requests[0].body).messages[1].content;
  assert.deepEqual(JSON.parse(sent.match(/```json\n([\s\S]*?)```/)[1]),
    ['How it *works*', 'Sign up', 'Meet', 'mentors', 'Sign up, then meet.', 'Twin', 'Meet the twin.', 'Go', 'x.com']);
  assert.match(sent, /into Spanish \(es\)/);
  const got = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(got.language, 'es');
  assert.deepEqual(got.brand, script.brand);
  assert.deepEqual(got.scenes[0].props.items[1], { title: 'Conoce', text: 'mentores' });
  assert.deepEqual(got.scenes[1], { code: 'scenes/twin.js', props: { label: 'Gemelo', image: 'twin.png' }, say: 'Conoce al gemelo.' });
  assert.equal(got.scenes[2].props.logo, 'logo.svg');
  await s.close();
});

test('translate fails on a reply of the wrong shape, and on a bad language', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cuadro-translate-'));
  const file = join(dir, 'script.json');
  await writeFile(file, JSON.stringify(script));
  const s = await fakeServer([reply('```json\n["uno"]\n```')]);
  await assert.rejects(translate({ script: file, to: 'es', provider: 'openai', baseUrl: s.url }), /must be 9 non-empty strings/);
  await assert.rejects(translate({ script: file, to: 'not a language', provider: 'openai', baseUrl: s.url }), RangeError);
  await s.close();
});
