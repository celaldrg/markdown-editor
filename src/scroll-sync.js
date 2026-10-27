/**
 * Synchronized scrolling between the editor and the preview. The UI measures
 * pairs of matching positions (the top of a source line in the editor and the
 * top of the element rendered from that line in the preview); this module
 * maps a scroll position from one pane to the other by linear interpolation.
 */

/**
 * Maps x through the piecewise linear function given by points sorted by x.
 * Values outside the range are clamped to the first or last point.
 * @param {Array<[number, number]>} points
 * @param {number} x
 * @returns {number}
 */
export function interpolate(points, x) {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 === x0 ? y1 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Builds a two-way scroll map from [editorY, previewY] pairs. Pairs are sorted
 * and pairs that would make the mapping go backwards are dropped, so both
 * directions are monotonic.
 * @param {Array<[number, number]>} pairs
 * @returns {{toPreview: (editorY: number) => number, toEditor: (previewY: number) => number}}
 */
export function createScrollMap(pairs) {
  const sorted = pairs
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const forward = [];
  for (const pair of sorted) {
    const last = forward[forward.length - 1];
    if (!last || pair[1] >= last[1]) forward.push(pair);
  }
  const backward = forward.map(([a, b]) => [b, a]);
  return {
    toPreview: (editorY) => interpolate(forward, editorY),
    toEditor: (previewY) => interpolate(backward, previewY),
  };
}
