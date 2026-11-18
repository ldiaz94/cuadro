import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cues, MaxChars } from '../src/captions.js';
import { srt } from '../src/render.js';

/** The words of text, one every 0.4 s, each said for 0.3 s. */
const said = (text, from = 0) => text.split(' ').map((t, i) => ({ text: t, start: from + i * 0.4, end: from + i * 0.4 + 0.3 }));

test('cues: cut after sentences, after commas past three words, at pauses, and long clauses in even parts', () => {
  const texts = (words) => cues(words).map((c) => c.text);
  assert.deepEqual(texts(said('Sign up free, record a short video intro, and meet volunteer mentors at big tech companies. Go.')),
    ['Sign up free,', 'record a short video intro,', 'and meet volunteer mentors', 'at big tech companies.', 'Go.']);
  assert.deepEqual(texts(said('Hi, you')), ['Hi, you'], 'a comma after one word does not cut');
  assert.deepEqual(texts([...said('one two'), ...said('three', 2)]), ['one two', 'three'], 'a pause cuts');
  assert.ok(cues(said('a '.repeat(60).trim())).every((c) => c.text.length <= MaxChars));
  assert.deepEqual(texts([{ text: '今日', start: 0, end: 0.2 }, { text: 'は', start: 0.2, end: 0.3 }, { text: 'OK', start: 0.4, end: 0.5 }]), ['今日は OK']);
});

test('cues: each stays up until the next, or a little after its last word', () => {
  const [a, b] = cues([...said('One two.'), ...said('Three.', 1)]);
  assert.deepEqual([a.start, a.end, b.start, b.end], [0, 1, 1, 1.9]);
});

test('srt: numbered cues with hh:mm:ss,mmm times', () => {
  assert.equal(srt([{ start: 0.5, end: 2, text: 'Hola,' }, { start: 3661.25, end: 3662, text: 'adiós.' }]),
    '1\n00:00:00,500 --> 00:00:02,000\nHola,\n\n2\n01:01:01,250 --> 01:01:02,000\nadiós.\n');
});
