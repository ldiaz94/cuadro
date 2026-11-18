import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beats, playLength, Fade } from '../src/scenes.js';
import { theme, themes } from '../src/theme.js';
import { formats } from '../src/script.js';
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

/**
 * At every 10th frame of a video, what breaks the scenes' rules in each fully shown scene. Laid out
 * still (transforms off), nothing in a scene's flow may leave its padded box, which keeps clear of
 * the captions' band, nor its parent's box, nor hold a line too wide for it (inline boxes aside).
 */
async function problems(page) {
  return page.evaluate(async () => {
    const found = new Set();
    const stage = document.querySelector('.cq-stage').getBoundingClientRect();
    const still = Object.assign(document.createElement('style'), { textContent: '.cq-scene, .cq-scene *, .cq-scene *::after { transform: none !important; }' });
    /** Whether el or an ancestor inside scene is absolutely placed, out of the flow. */
    const placed = (el, scene) => {
      for (let e = el; e !== scene; e = e.parentElement) if (getComputedStyle(e).position === 'absolute') return true;
      return false;
    };
    /** What overflows in scene, laid out still. */
    const overflow = (scene, name) => {
      document.head.append(still);
      const r = scene.getBoundingClientRect();
      const pad = getComputedStyle(scene);
      const box = { left: r.left + parseFloat(pad.paddingLeft), right: r.right - parseFloat(pad.paddingRight), top: r.top + parseFloat(pad.paddingTop), bottom: r.bottom - parseFloat(pad.paddingBottom) };
      const past = (e, b) => e.left < b.left - 1 || e.right > b.right + 1 || e.top < b.top - 1 || e.bottom > b.bottom + 1;
      const inline = (el) => ['inline', 'contents'].includes(getComputedStyle(el).display);
      for (const el of scene.querySelectorAll('*')) {
        if (placed(el, scene) || inline(el)) continue;
        const e = el.getBoundingClientRect();
        if (e.width === 0 || e.height === 0) continue;
        const what = `${name}: ${el.tagName} ${el.getAttribute('class') ?? ''} "${el.textContent.trim().slice(0, 30)}"`;
        if (past(e, box)) found.add(`${what} leaves the scene's box`);
        if (el.parentElement !== scene && !inline(el.parentElement) && past(e, el.parentElement.getBoundingClientRect())) found.add(`${what} leaves its parent`);
        if (el.scrollWidth > el.clientWidth + 1) found.add(`${what} holds a line too wide for it`);
      }
      still.remove();
    };
    for (let n = 0; n < window.cuadro.durationInFrames; n += 10) {
      await window.cuadro.setFrame(n);
      for (const scene of document.querySelectorAll('.cq-scene')) {
        if (getComputedStyle(scene).opacity !== '1') continue;
        const name = scene.className;
        overflow(scene, name);
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

test('scenes: text of 28 px or more, inside the frame, filling 60% of its height and centred, in every format and theme', async () => {
  for (const props of Object.keys(formats).flatMap((format) => Object.keys(themes).map((theme) => ({ format, theme })))) {
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

test('scenes: German text, a third longer, fits every scene in both formats, above the captions', async () => {
  for (const format of Object.keys(formats)) {
    const b = await open(`/test/long/index.html?render&props=${encodeURIComponent(JSON.stringify({ format }))}`);
    try {
      await b.page.waitForFunction(() => window.cuadro);
      assert.deepEqual(await problems(b.page), [], format);
      assert.deepEqual(b.errors, []);
    } finally {
      await b.close();
    }
  }
});

test('steps move to each item as the narration says its title', async () => {
  const b = await open();
  try {
    const rows = await b.page.evaluate(async () => {
      const { composition } = await import('/src/index.js');
      const { steps, stage } = await import('/src/scenes.js');
      const { theme } = await import('/src/theme.js');
      const items = [{ title: 'Sign up free' }, { title: 'Video intro' }, { title: 'Meet mentors' }];
      const said = ['Sign', 'up', 'free,', 'record', 'a', 'video', 'intro,', 'and', 'meet', 'mentors.'].map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
      const c = composition({ width: 640, height: 360, fps: 30, durationInFrames: 180, view: stage(theme(), steps({ length: 180, items, words: said })) });
      const row = async (n) => {
        await c.setFrame(n);
        return Number(/translateY\(([\d.]+)%\)/.exec(document.querySelector('.cq-pill').style.transform)[1]) / 100;
      };
      // "video" is said at frame 75 and "meet" at 120; evenly, the moves would be at 56 and 112.
      return [await row(60), await row(85), await row(108), await row(130)];
    });
    assert.deepEqual(rows.map((r) => Math.round(r * 10) / 10), [0, 1, 1, 2]);
  } finally {
    await b.close();
  }
});
