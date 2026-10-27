import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/rng.js';

const take = (rng, count) => Array.from({ length: count }, () => rng());

test('the same seed gives the same sequence', () => {
  assert.deepEqual(take(createRng(123), 20), take(createRng(123), 20));
});

test('different seeds give different sequences', () => {
  assert.notDeepEqual(take(createRng(1), 5), take(createRng(2), 5));
});

test('values are in [0, 1) and spread evenly', () => {
  const values = take(createRng(2026), 20000);
  assert.ok(values.every((value) => value >= 0 && value < 1));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  const buckets = new Array(10).fill(0);
  for (const value of values) buckets[Math.floor(value * 10)] += 1;
  assert.ok(buckets.every((count) => count > 1800 && count < 2200), buckets.join(' '));
});

test('any number works as a seed', () => {
  for (const seed of [0, -1, 2 ** 40, 3.7]) {
    const value = createRng(seed)();
    assert.ok(value >= 0 && value < 1, String(seed));
  }
});
