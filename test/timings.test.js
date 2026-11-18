import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, fromCharacters, split } from '../src/timings.js';

test('split keeps punctuation with its word, and splits languages without spaces', () => {
  assert.deepEqual(split('¿Qué tal? Ven — ya, "hoy".', 'es').map((w) => w.text), ['¿Qué', 'tal?', 'Ven —', 'ya,', '"hoy".']);
  assert.deepEqual(split('今日は天気です。', 'ja').map((w) => w.text), ['今日', 'は', '天気', 'です。']);
  assert.deepEqual(split("jointangent.com, you're", 'en').map((w) => w.text), ['jointangent.com,', "you're"]);
});

/** Loudness at 30 fps: 10 quiet frames, 30 loud, 9 quiet (a pause), 30 loud, 5 quiet. */
const twoPhrases = [...Array(10).fill(0), ...Array(30).fill(1), ...Array(9).fill(0), ...Array(30).fill(0.8), ...Array(5).fill(0)];

test('estimate puts the pause at the comma and spreads each phrase\'s words by length', () => {
  const words = estimate('Hello there, big world.', twoPhrases, 30);
  assert.deepEqual(words.map((w) => w.text), ['Hello', 'there,', 'big', 'world.']);
  assert.equal(words[0].start, 0.33, 'the leading quiet is skipped');
  assert.equal(words[1].end, 1.33, 'the first phrase ends where the voice stops');
  assert.equal(words[2].start, 1.63, 'the second starts where it comes back');
  assert.equal(words[3].end, 2.63);
  assert.ok(words[2].end - words[2].start < words[3].end - words[3].start, 'a shorter word takes less time');
});

test('estimate: a short dip is no pause, and silence spreads the words over the whole line', () => {
  const dip = [...Array(20).fill(1), 0, 0, ...Array(20).fill(1)];
  const words = estimate('a b', dip, 30);
  assert.deepEqual([words[0].start, words[1].end], [0, 1.4]);
  assert.deepEqual(estimate('one two', Array(30).fill(0), 30).map((w) => [w.start, w.end]), [[0, 0.5], [0.5, 1]]);
  assert.deepEqual(estimate('', twoPhrases, 30), []);
});

test('fromCharacters takes each word\'s first start and last end', () => {
  const alignment = { characters: [...'Hi, 天気'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] };
  assert.deepEqual(fromCharacters(alignment, 'ja'), [{ text: 'Hi,', start: 0, end: 0.3 }, { text: '天気', start: 0.4, end: 0.6 }]);
});
