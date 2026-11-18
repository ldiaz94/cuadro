import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, lines, timing, types, Air, Hold } from '../src/script.js';
import * as scenes from '../src/scenes.js';
import { Fade } from '../src/scenes.js';
import { MusicVolume } from '../src/player.js';
import { open } from './browser.js';

/** A small valid script; each test breaks one thing in a copy. */
const good = () => ({
  theme: 'dark',
  brand: { accent: '#4d65ff', logo: 'logo.svg' },
  scenes: [
    { type: 'title', props: { title: 'Get *hired*' }, say: 'Get hired.' },
    { type: 'tiles', props: { items: [{ title: 'a' }, { title: 'b', text: 'c' }] }, say: 'Two things.' },
    { code: 'scenes/twin.js', say: 'Meet the twin.' },
    { type: 'endCard', props: { line: 'Free', url: 'x.com' } },
  ],
});

test('check: language, captions and font; letters the fonts lack fail unless a font is named', () => {
  const s = { ...good(), language: 'es', captions: true };
  s.scenes[0].say = '¿Qué? Señal, œuvre.';
  assert.equal(check(s), s);
  assert.throws(() => check({ ...good(), language: 'Spanish' }), /^Error: language: expected a BCP-47 language code/);
  assert.throws(() => check({ ...good(), captions: 'yes' }), /^Error: captions: expected true or false$/);
  const ja = good();
  ja.scenes[1].props.items[1].text = '天気';
  assert.throws(() => check(ja), /^Error: scenes\[1\].props.items\[1\].text: "天" is not in cuadro's fonts/);
  assert.equal(check({ ...ja, font: 'fonts/noto.woff2' }).font, 'fonts/noto.woff2');
  const code = good();
  code.scenes[2].props = { labels: ['Gemelo', '双子'] };
  assert.throws(() => check(code), /^Error: scenes\[2\].props.labels\[1\]: "双" is not in cuadro's fonts/, 'a code scene\'s props are text on screen too');
  const said = { ...good(), scenes: [{ type: 'title', props: { title: 'Hi' }, say: 'Привет' }] };
  assert.equal(check(said), said, 'a line that is not shown may be in any script');
  assert.throws(() => check({ ...said, captions: true }), /^Error: scenes\[0\].say: "П"/);
});

test('check: a good script passes, and each mistake names its path', () => {
  assert.deepEqual(check(good()), good());
  const broken = (change) => {
    const s = good();
    change(s);
    return () => check(s);
  };
  assert.throws(() => check([]), /^Error: script: expected an object$/);
  assert.throws(broken((s) => delete s.scenes), /^Error: scenes: missing$/);
  assert.throws(broken((s) => (s.scenes = [])), /^Error: scenes: expected at least 1 items$/);
  assert.throws(broken((s) => (s.theme = 'pastel')), /^Error: theme: expected one of light, bold, dark, not "pastel"$/);
  assert.throws(broken((s) => (s.brand.accent = 'blue')), /^Error: brand.accent: expected a #rrggbb colour$/);
  assert.throws(broken((s) => (s.scenes[1].props.items = {})), /^Error: scenes\[1\].props.items: expected an array$/);
  assert.throws(broken((s) => s.scenes[1].props.items.push(...Array(5).fill({ title: 'x' }))), /scenes\[1\].props.items: expected 2 to 6 items, not 7/);
  assert.throws(broken((s) => (s.scenes[1].props.items[1].title = ' ')), /^Error: scenes\[1\].props.items\[1\].title: expected a non-empty string$/);
  assert.throws(broken((s) => (s.scenes[0].type = 'chart')), /^Error: scenes\[0\].type: expected one of title, kinetic, stat, steps, tiles, app, quote, compare, endCard, not "chart"$/);
  assert.throws(broken((s) => (s.scenes[0].props.length = 90)), /^Error: scenes\[0\].props.length: unknown key; expected kicker, title, sub$/);
  assert.throws(broken((s) => delete s.scenes[3].props.line), /^Error: scenes\[3\].props.line: missing$/);
  assert.throws(broken((s) => (s.scenes[2].code = '../evil.js')), /^Error: scenes\[2\].code: expected a module path like "scenes\/name.js"$/);
  assert.throws(broken((s) => (s.scenes[2].type = 'title')), /^Error: scenes\[2\].type: unknown key; expected code, props, say$/);
  assert.throws(broken((s) => (s.scenes[0].say = 3)), /^Error: scenes\[0\].say: expected a non-empty string$/);
  assert.throws(broken((s) => (s.music = 3)), /^Error: music: expected a non-empty string$/);
  assert.throws(broken((s) => (s.format = '4:3')), /^Error: format: expected one of 16:9, 9:16, not "4:3"$/);
  assert.throws(broken((s) => (s.scenes[0] = { type: 'app', props: { image: 'a.png', rows: [{ title: 'a' }, { title: 'b' }] } })),
    /^Error: scenes\[0\].props: give image or rows, not both$/);
});

test('lines: one per say, with ids from the scene positions', () => {
  assert.deepEqual(lines(good()), { lines: [
    { id: 'scene1', text: 'Get hired.' }, { id: 'scene2', text: 'Two things.' }, { id: 'scene3', text: 'Meet the twin.' }] });
});

test('timing: lengths from voice.json plus air, defaults without a line, and never too short', () => {
  const voice = { fps: 30, lines: [{ id: 'scene1', seconds: 3.01 }, { id: 'scene2', seconds: 0.5 }, { id: 'scene3', seconds: 6 }] };
  assert.deepEqual(timing(good(), voice).map((s) => s.length), [
    91 + Air, // ceil(3.01 * 30) + air
    60, // 15 + air is under the 2-second floor
    180 + Air,
    4 * 30, // endCard has no line: its default
  ]);
  assert.equal(timing(good(), voice)[2].line, voice.lines[2]);
  // the last scene holds longer after its line; six tiles need 6 beats of 15 frames plus the fade
  const s = good();
  s.scenes[3].say = 'Free.';
  s.scenes[1].props.items = Array(6).fill({ title: 'x' });
  assert.deepEqual(timing(s, { lines: [{ id: 'scene4', seconds: 1 }, { id: 'scene2', seconds: 1 }] }).map((x) => x.length), [120, 6 * 15 + Fade, 180, 30 + Hold]);
  assert.deepEqual(timing(good()).map((x) => x.length), [120, 165, 180, 120]);
});

test('the schema matches the scenes: each type is a scene whose props in scenes.d.ts are the schema\'s, plus length and words', async () => {
  const dts = await readFile(new URL('../src/scenes.d.ts', import.meta.url), 'utf8');
  for (const [name, { props }] of Object.entries(types)) {
    assert.equal(typeof scenes[name], 'function', name);
    const shape = dts.match(new RegExp(`export function ${name}\\(props: \\{([\\s\\S]*?)\\}\\): View;`))[1];
    const keys = [...shape.matchAll(/(?:^\s*|[{;]\s*)(\w+)\??:/g)].map((m) => m[1]).filter((k) => !['value', 'prefix', 'suffix', 'label', 'words'].includes(k));
    assert.deepEqual(keys.sort(), ['length', ...Object.keys(props.props)].sort(), name);
  }
});

test('player: the demo script plays its scenes at their default lengths, with no errors', async () => {
  const b = await open('/demo/script/index.html?render');
  try {
    await b.page.waitForFunction(() => window.cuadro);
    const script = JSON.parse(await readFile(new URL('../demo/script/script.json', import.meta.url), 'utf8'));
    const lengths = timing(script).map((s) => s.length);
    assert.equal(await b.page.evaluate(() => window.cuadro.durationInFrames), scenes.playLength(...lengths.map((l) => [l, null])));
    await b.page.evaluate(async () => { for (let n = 0; n < window.cuadro.durationInFrames; n += 15) await window.cuadro.setFrame(n); });
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});

test('player: lengths and audio from voice.json, and a code scene gets its line\'s levels and its props', async (t) => {
  const dir = await mkdtemp(join('test', 'tmp-player-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scenes'));
  await mkdir(join(dir, 'voice'));
  const script = { music: 'music.wav', scenes: [
    { type: 'kinetic', props: { lines: ['One', 'Two'] }, say: 'One, two.' },
    { code: 'scenes/count.js', props: { unit: 'beats' }, say: 'Counting.' },
    { type: 'endCard', props: { line: 'Bye' }, say: 'Bye.' }] };
  const voice = { fps: 30, lines: [
    { id: 'scene1', file: 'scene1.wav', seconds: 1.5 },
    { id: 'scene2', file: 'scene2.wav', seconds: 2, levels: Array(60).fill(0.5) },
    { id: 'scene3', file: 'scene3.wav', seconds: 1 }] };
  await writeFile(join(dir, 'script.json'), JSON.stringify(script));
  await writeFile(join(dir, 'voice', 'voice.json'), JSON.stringify(voice));
  await writeFile(join(dir, 'scenes', 'count.js'), `import { html } from 'cuadro';
import { scene } from 'cuadro/scenes';
export default ({ length, levels, say, fps, props }) => scene(length, () => html\`<p id="got">\${[length, levels.length, say, fps, props.unit].join(' ')}</p>\`);
`);
  const html = await readFile(new URL('../demo/script/index.html', import.meta.url), 'utf8');
  await writeFile(join(dir, 'index.html'), html);
  const b = await open(`/${dir}/index.html?render`);
  try {
    await b.page.waitForFunction(() => window.cuadro);
    const [a, c, e] = [45 + Air, 60 + Air, 30 + Hold];
    assert.equal(await b.page.evaluate(() => window.cuadro.durationInFrames), a + c + e - 2 * Fade);
    const froms = [0, a - Fade, a + c - 2 * Fade];
    for (const n of froms) await b.page.evaluate((n) => window.cuadro.setFrame(n), n);
    await b.page.evaluate(() => window.cuadro.setFrame(80));
    assert.equal(await b.page.textContent('#got'), `${c} 60 Counting. 30 beats`);
    const clips = await b.page.evaluate(() => window.cuadro.clips.map((c) => [c.src.split('/').pop(), c.from, c.volume]));
    assert.deepEqual(clips, [['music.wav', 0, MusicVolume], ['scene1.wav', froms[0], 1], ['scene2.wav', froms[1], 1], ['scene3.wav', froms[2], 1]]);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});

test('player: captions show the phrase being said with its word lit, above nothing, and are listed for the .srt', async (t) => {
  const dir = await mkdtemp(join('test', 'tmp-captions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scenes'));
  await mkdir(join(dir, 'voice'));
  const words = (text) => text.split(' ').map((w, i) => ({ text: w, start: 0.2 + i * 0.4, end: 0.5 + i * 0.4 }));
  const script = { captions: true, language: 'es', scenes: [
    { type: 'steps', props: { items: [{ title: 'Uno' }, { title: 'Dos' }] }, say: 'Primero el uno, luego el dos.' },
    { code: 'scenes/said.js', say: 'Y fin.' }] };
  const voice = { fps: 30, lines: [
    { id: 'scene1', file: 'a.wav', seconds: 2.5, words: words('Primero el uno, luego el dos.') },
    { id: 'scene2', file: 'b.wav', seconds: 1, words: words('Y fin.') }] };
  await writeFile(join(dir, 'script.json'), JSON.stringify(script));
  await writeFile(join(dir, 'voice', 'voice.json'), JSON.stringify(voice));
  await writeFile(join(dir, 'scenes', 'said.js'), `import { html } from 'cuadro';
import { scene } from 'cuadro/scenes';
export default ({ length, words }) => scene(length, () => html\`<p id="got">\${words.map((w) => w.text).join('|')}</p>\`);
`);
  await writeFile(join(dir, 'index.html'), await readFile(new URL('../demo/script/index.html', import.meta.url), 'utf8'));
  const b = await open(`/${dir}/index.html?render`);
  try {
    await b.page.waitForFunction(() => window.cuadro);
    const shown = (n) => b.page.evaluate(async (n) => {
      await window.cuadro.setFrame(n);
      const p = document.querySelector('.cq-captions p');
      return p && [p.textContent, document.querySelector('.cq-said')?.textContent];
    }, n);
    assert.deepEqual(await shown(0), null);
    assert.deepEqual(await shown(33), ['Primero el uno,', 'uno,']); // 1.1 s
    assert.deepEqual(await shown(50), ['luego el dos.', 'luego']); // 1.67 s
    // The scenes keep above the captions' band.
    const gap = await b.page.evaluate(() => {
      const list = document.querySelector('.cq-list').getBoundingClientRect();
      return document.querySelector('.cq-stage').getBoundingClientRect().bottom - list.bottom;
    });
    assert.ok(gap >= 0.15 * 720, `the list ends ${gap}px above the bottom`);
    const second = 75 + Air - Fade; // where scene 2 starts
    assert.deepEqual(await shown(second + 20), ['Y fin.', 'fin.']);
    assert.equal(await b.page.textContent('#got'), 'Y|fin.');
    const listed = await b.page.evaluate(() => window.cuadro.captions);
    assert.deepEqual(listed.map((c) => c.text), ['Primero el uno,', 'luego el dos.', 'Y fin.']);
    assert.ok(Math.abs(listed[2].start - (second / 30 + 0.2)) < 1e-9);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});
