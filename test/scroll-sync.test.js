import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollMap, interpolate } from '../src/scroll-sync.js';

describe('interpolate', () => {
  const points = [[0, 0], [100, 400], [200, 500]];

  test('maps linearly between points', () => {
    assert.equal(interpolate(points, 50), 200);
    assert.equal(interpolate(points, 100), 400);
    assert.equal(interpolate(points, 150), 450);
  });

  test('clamps outside the range', () => {
    assert.equal(interpolate(points, -10), 0);
    assert.equal(interpolate(points, 999), 500);
  });

  test('handles empty input and repeated x values', () => {
    assert.equal(interpolate([], 10), 0);
    assert.equal(interpolate([[5, 7]], 10), 7);
    assert.equal(interpolate([[0, 0], [10, 20], [10, 30]], 10), 20);
  });
});

describe('createScrollMap', () => {
  test('maps both ways between editor and preview', () => {
    const map = createScrollMap([[0, 0], [100, 300], [200, 400]]);
    assert.equal(map.toPreview(50), 150);
    assert.equal(map.toEditor(150), 50);
    assert.equal(map.toEditor(350), 150);
  });

  test('sorts the pairs and ignores invalid ones', () => {
    const map = createScrollMap([[200, 400], [Number.NaN, 5], [0, 0], [100, Number.POSITIVE_INFINITY], [100, 300]]);
    assert.equal(map.toPreview(150), 350);
  });

  test('drops pairs that would scroll backwards, so both directions stay monotonic', () => {
    const map = createScrollMap([[0, 0], [100, 500], [150, 200], [200, 600]]);
    let previous = -Infinity;
    for (let y = 0; y <= 220; y += 5) {
      const mapped = map.toPreview(y);
      assert.ok(mapped >= previous, `toPreview(${y})`);
      previous = mapped;
    }
    previous = -Infinity;
    for (let y = 0; y <= 650; y += 5) {
      const mapped = map.toEditor(y);
      assert.ok(mapped >= previous, `toEditor(${y})`);
      previous = mapped;
    }
  });

  test('without pairs everything maps to the top', () => {
    const map = createScrollMap([]);
    assert.equal(map.toPreview(300), 0);
    assert.equal(map.toEditor(300), 0);
  });
});
