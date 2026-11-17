import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, spring, bezier, ease, easeInOut, linear } from '../src/animate.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('interpolate hits stops exactly and is linear between them', () => {
  assert.equal(interpolate(0, [0, 10], [100, 200]), 100);
  assert.equal(interpolate(10, [0, 10], [100, 200]), 200);
  assert.equal(interpolate(2.5, [0, 10], [100, 200]), 125);
  assert.equal(interpolate(5, [0, 10], [1, 0]), 0.5); // falling output
});

test('interpolate clamps by default, extends on request, per side', () => {
  assert.equal(interpolate(-5, [0, 10], [0, 1]), 0);
  assert.equal(interpolate(15, [0, 10], [0, 1]), 1);
  assert.equal(interpolate(15, [0, 10], [0, 1], { extrapolate: 'extend' }), 1.5);
  assert.equal(interpolate(-5, [0, 10], [0, 1], { extrapolate: 'extend' }), -0.5);
  const e = { extrapolate: { left: 'clamp', right: 'extend' } };
  assert.equal(interpolate(-5, [0, 10], [0, 1], e), 0);
  assert.equal(interpolate(20, [0, 10], [0, 1], e), 2);
});

test('interpolate picks the right segment, including at inner stops', () => {
  const at = (x) => interpolate(x, [0, 10, 20, 40], [0, 1, 0, 4]);
  assert.equal(at(5), 0.5);
  assert.equal(at(10), 1);
  assert.equal(at(15), 0.5);
  assert.equal(at(20), 0);
  assert.equal(at(30), 2);
  assert.equal(interpolate(50, [0, 10, 20], [0, 1, 3], { extrapolate: 'extend' }), 9); // last segment's slope
  assert.equal(interpolate(-10, [0, 10, 20], [0, 1, 3], { extrapolate: 'extend' }), -1); // first segment's slope
});

test('interpolate eases each segment, not the whole range', () => {
  const sq = (t) => t * t;
  assert.equal(interpolate(5, [0, 10, 20], [0, 1, 2], { easing: sq }), 0.25);
  assert.equal(interpolate(15, [0, 10, 20], [0, 1, 2], { easing: sq }), 1.25);
});

test('interpolate rejects bad ranges', () => {
  assert.throws(() => interpolate(0, [0], [0]));
  assert.throws(() => interpolate(0, [0, 1], [0, 1, 2]));
  assert.throws(() => interpolate(0, [0, 0], [0, 1]));
  assert.throws(() => interpolate(0, [1, 0], [0, 1]));
});

test('spring starts at from, settles at to', () => {
  for (const config of [{}, { damping: 20 }, { damping: 40 }, { mass: 3, stiffness: 50, damping: 5 }]) {
    assert.equal(spring({ frame: 0, fps: 30, config }), 0);
    assert.equal(spring({ frame: -4, fps: 30, config }), 0);
    near(spring({ frame: 30 * 20, fps: 30, config }), 1, 1e-4);
  }
  near(spring({ frame: 600, fps: 30, from: 50, to: -10 }), -10, 1e-4);
});

test('spring overshoots only when underdamped', () => {
  const peak = (config) => Math.max(...Array.from({ length: 300 }, (_, f) => spring({ frame: f, fps: 30, config })));
  assert.ok(peak({}) > 1.1); // damping 10: zeta 0.5
  assert.ok(peak({ damping: 20 }) <= 1); // critical
  assert.ok(peak({ damping: 40 }) <= 1); // over
});

test('spring is continuous across the damping regimes', () => {
  // near zeta = 1 the three formulas must agree, or a tiny config change jumps
  const at = (damping) => spring({ frame: 10, fps: 30, config: { damping } });
  near(at(20 - 1e-6), at(20), 1e-5);
  near(at(20 + 1e-6), at(20), 1e-5);
});

test('bezier matches CSS endpoints and known points', () => {
  for (const f of [ease, easeInOut, linear]) {
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
  }
  near(easeInOut(0.5), 0.5);
  near(bezier(0, 0, 1, 1)(0.3), 0.3);
  near(ease(0.5), 0.8024033877399112, 1e-6); // CSS ease at the midpoint
  assert.throws(() => bezier(-0.1, 0, 1, 1));
});
