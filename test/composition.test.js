import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './browser.js';

test('setFrame waits for a slow image', async () => {
  const b = await open('/test/fixture.html?render', (page) =>
    page.route('**/dot.svg', async (route) => { await new Promise((ok) => setTimeout(ok, 500)); await route.continue(); }));
  try {
    const img = await b.page.evaluate(async () => {
      await window.cuadro.setFrame(3);
      const img = document.querySelector('img');
      return { complete: img.complete, width: img.naturalWidth };
    });
    assert.deepEqual(img, { complete: true, width: 16 });
    await assert.rejects(b.page.evaluate(() => window.cuadro.setFrame(12)), /not a frame/);
    assert.equal(await b.page.$('input[type=range]'), null); // no preview bar when rendering
  } finally {
    await b.close();
  }
});

test('preview: keys step and play, the scrubber seeks', async () => {
  const b = await open('/test/fixture.html');
  try {
    const { page } = b;
    const label = () => page.textContent('span');
    assert.equal(await label(), '0 / 11 · 0.00s');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await label(), '2 / 11 · 0.17s');
    await page.keyboard.press('Shift+ArrowRight'); // a second, clamped to the last frame
    assert.equal(await label(), '11 / 11 · 0.92s');
    await page.fill('input[type=range]', '5');
    assert.equal(await label(), '5 / 11 · 0.42s');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('span').textContent.startsWith('11 '), null, { timeout: 3000 });
    assert.equal(await page.textContent('button'), 'play'); // stopped at the end
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});
