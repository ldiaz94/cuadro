import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './browser.js';

let b;
before(async () => {
  b = await open();
  // A frame signal and a stage; each test mounts views on it and steps the frame.
  await b.page.evaluate(async () => {
    const spark = await import('spark');
    const timeline = await import('/src/timeline.js');
    const [frame, setFrame] = spark.signal(0);
    Object.assign(window, { spark, timeline, frame, setFrame, log: [] });
  });
});
after(() => b?.close());

const at = (n) => b.page.evaluate((n) => { setFrame(n); return document.body.textContent; }, n);

test('sequence mounts in [from, from + duration) with a local frame', async () => {
  await b.page.evaluate(() => {
    document.body.textContent = '';
    setFrame(0);
    const { html, mount } = spark;
    window.unmount = mount(document.body, () => html`<p>${timeline.sequence(10, 5, (f) => html`<b>${() => `in ${f()}`}</b>`)(frame)}</p>`);
  });
  assert.equal(await at(9), '');
  assert.equal(await at(10), 'in 0');
  assert.equal(await at(14), 'in 4');
  assert.equal(await at(15), '');
  assert.equal(await at(12), 'in 2'); // scrubbing back in
  await b.page.evaluate(() => unmount());
});

test('sequence mounts once per entry and disposes the view on exit', async () => {
  const log = await b.page.evaluate(() => {
    document.body.textContent = '';
    setFrame(0);
    const { html, mount, effect, onCleanup } = spark;
    const log = [];
    const view = (f) => {
      log.push('mount');
      effect(() => { f(); onCleanup(() => log.push('cleanup')); });
      onCleanup(() => log.push('unmount'));
      return html`<i>${f}</i>`;
    };
    const unmount = mount(document.body, () => html`<p>${timeline.sequence(2, 3, view)(frame)}</p>`);
    const marks = () => log.join(',');
    const steps = [];
    for (const n of [1, 2, 3, 4, 5, 6]) { setFrame(n); steps.push(marks()); log.length = 0; }
    setFrame(3); // back in, then the whole tree goes away
    unmount();
    steps.push(marks());
    return steps;
  });
  assert.deepEqual(log, [
    '',
    'mount',
    'cleanup', // the inner effect reruns per frame; the view itself stays
    'cleanup',
    'cleanup,unmount',
    '',
    'mount,cleanup,unmount',
  ]);
});

test('series hands over at exact boundaries', async () => {
  await b.page.evaluate(() => {
    document.body.textContent = '';
    setFrame(0);
    const { html, mount } = spark;
    const clip = (name) => (f) => html`<b>${() => `${name}${f()}`}</b>`;
    window.unmount = mount(document.body, () => html`<p>${timeline.series([3, clip('a')], [2, clip('b')], [Infinity, clip('c')])(frame)}</p>`);
  });
  assert.equal(await at(0), 'a0');
  assert.equal(await at(2), 'a2');
  assert.equal(await at(3), 'b0');
  assert.equal(await at(4), 'b1');
  assert.equal(await at(5), 'c0');
  assert.equal(await at(500), 'c495');
  await b.page.evaluate(() => unmount());
});

test('nested sequences count from their own start', async () => {
  await b.page.evaluate(() => {
    document.body.textContent = '';
    setFrame(0);
    const { html, mount } = spark;
    const { sequence } = timeline;
    const inner = sequence(5, 10, (f) => html`<b>${() => `inner ${f()}`}</b>`);
    window.unmount = mount(document.body, () => html`<p>${sequence(100, 50, inner)(frame)}</p>`);
  });
  assert.equal(await at(104), '');
  assert.equal(await at(105), 'inner 0');
  assert.equal(await at(114), 'inner 9');
  assert.equal(await at(115), '');
  await b.page.evaluate(() => unmount());
  assert.deepEqual(b.errors, []);
});
