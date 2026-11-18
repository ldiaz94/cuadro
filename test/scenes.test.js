import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beats, playLength, Fade } from '../src/scenes.js';
import { theme } from '../src/theme.js';
import { open } from './browser.js';

test('beats tile the scene up to its fade-out, back to back, none too short', () => {
  for (const length of [45, 90, 101, 157, 600]) {
    for (let n = 1; (n + 1) * 15 + Fade <= length; n++) {
      const windows = beats(length, n);
      assert.equal(windows.length, n);
      assert.equal(windows[0].from, 0);
      assert.equal(windows.at(-1).to, length - Fade);
      windows.forEach((w, i) => {
        assert.ok(w.to - w.from >= 15, `beat ${i} of ${n} in ${length} frames is ${w.to - w.from} frames`);
        if (i > 0) assert.equal(w.from, windows[i - 1].to);
      });
    }
  }
  assert.throws(() => beats(50, 3), /at least 57 frames/);
  assert.throws(() => beats(90.5, 2), /not 90.5/);
  assert.throws(() => beats(90, 0), /beats/);
});

test('play overlaps scenes by Fade frames', () => {
  assert.equal(playLength([100, null], [50, null], [60, null]), 210 - 2 * Fade);
  assert.equal(playLength([100, null]), 100);
});

test('theme: a brand accent gets text that reads on it; bad names and colours fail', () => {
  assert.equal(theme('dark', { accent: '#ffe14a' })['--on-accent'], '#141414');
  assert.equal(theme('light', { accent: '#1d2b8f' })['--on-accent'], '#ffffff');
  assert.equal(theme('bold')['--accent'], '#ffe14a');
  assert.throws(() => theme('pastel'), /no theme named pastel/);
  assert.throws(() => theme('light', { accent: 'red' }), /#rrggbb/);
});

/** At every 10th frame of the demo, what breaks the scenes' rules in each fully shown scene. */
async function problems(page) {
  return page.evaluate(async () => {
    const found = new Set();
    const stage = document.querySelector('.cq-stage').getBoundingClientRect();
    for (let n = 0; n < window.cuadro.durationInFrames; n += 10) {
      await window.cuadro.setFrame(n);
      for (const scene of document.querySelectorAll('.cq-scene')) {
        if (getComputedStyle(scene).opacity !== '1') continue;
        const name = scene.className;
        let top = Infinity, bottom = -Infinity;
        for (const el of scene.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
          if (r.left < stage.left || r.right > stage.right || r.top < stage.top || r.bottom > stage.bottom) found.add(`${name}: ${el.tagName} ${el.className} leaves the frame`);
          const style = getComputedStyle(el);
          const text = [...el.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.data.trim());
          if (text && parseFloat(style.fontSize) < 28) found.add(`${name}: ${style.fontSize} text "${el.textContent.trim()}"`);
          if (style.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 1) found.add(`${name}: ${el.tagName} ${el.className} clips its content`);
        }
        if (bottom - top < 0.6 * stage.height) found.add(`${name}: content fills only ${Math.round((100 * (bottom - top)) / stage.height)}% of the height`);
        const off = (top + bottom) / 2 - (stage.top + stage.height / 2);
        if (Math.abs(off) > 0.1 * stage.height) found.add(`${name}: content is ${Math.round((100 * off) / stage.height)}% off centre`);
      }
    }
    return [...found];
  });
}

test('scenes: text of 28 px or more, inside the frame, filling 60% of its height and centred, in landscape and portrait', async () => {
  for (const props of [{ theme: 'light' }, { theme: 'bold', portrait: true }]) {
    const b = await open(`/demo/scenes.html?render&props=${encodeURIComponent(JSON.stringify(props))}`);
    try {
      await b.page.waitForFunction(() => window.cuadro);
      assert.deepEqual(await problems(b.page), [], JSON.stringify(props));
      assert.deepEqual(b.errors, []);
    } finally {
      await b.close();
    }
  }
});
