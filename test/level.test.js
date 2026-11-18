import { test } from 'node:test';
import assert from 'node:assert/strict';
import { level, word } from '../src/level.js';

test('level: 0 outside the line, edges smoothed with the nearest frame', () => {
  const levels = [1, 0, 0, 0, 1];
  assert.equal(level(levels, -1), 0);
  assert.equal(level(levels, 5), 0);
  assert.equal(level([], 0), 0);
  assert.ok(Math.abs(level(levels, 0) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(level(levels, 4) - 2 / 3) < 1e-9);
  assert.equal(level(levels, 2), 0);
  assert.ok(Math.abs(level(levels, 1) - 1 / 3) < 1e-9);
  assert.equal(level([0.5, 0.5, 0.5], 1), 0.5);
});

test('word: -1 before the first, then the last word started, held through pauses and after the end', () => {
  const words = [{ text: 'a', start: 0.5, end: 0.8 }, { text: 'b', start: 1.2, end: 1.5 }];
  assert.deepEqual([0, 14, 15, 30, 36, 90].map((f) => word(words, f, 30)), [-1, -1, 0, 0, 1, 1]);
  assert.equal(word([], 10, 30), -1);
});
