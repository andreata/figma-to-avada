// ─── Pure geometry helpers for layout detection ───

const Y_TOLERANCE_FACTOR = 0.15;
const Y_TOLERANCE_MIN_PX = 5;
const Y_TOLERANCE_MAX_PX = 40;

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute the median of a numeric array.
 * Returns 0 for empty arrays.
 */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute the average of a numeric array.
 */
export function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Build a spatial record from a Figma node's absoluteBoundingBox.
 */
export function toSpatialItem(node) {
  const bbox = node.absoluteBoundingBox;
  if (!bbox) return null;
  return {
    figmaNode: node,
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    cx: bbox.x + bbox.width / 2,
    cy: bbox.y + bbox.height / 2,
    right: bbox.x + bbox.width,
    bottom: bbox.y + bbox.height,
  };
}

/**
 * Compute Y-alignment tolerance for row grouping.
 *
 * Uses two signals:
 * 1. Median height * factor — robust against outliers
 * 2. Otsu threshold on Y-center gaps — adapts to actual layout density
 *
 * Returns the minimum of both (more conservative).
 */
export function computeYTolerance(items) {
  if (items.length <= 1) return Y_TOLERANCE_MIN_PX;

  // Signal 1: height-based
  const heights = items.map((i) => i.height);
  const medianHeight = median(heights);
  const heightBased = medianHeight * Y_TOLERANCE_FACTOR;

  // Signal 2: gap-based (Otsu simplified)
  const sortedCy = items.map((i) => i.cy).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sortedCy.length; i++) {
    gaps.push(sortedCy[i] - sortedCy[i - 1]);
  }

  const gapBased = gaps.length > 0 ? otsuThreshold(gaps) : heightBased;

  return clamp(Math.min(heightBased, gapBased), Y_TOLERANCE_MIN_PX, Y_TOLERANCE_MAX_PX);
}

/**
 * Simplified Otsu threshold: find the gap value that best separates
 * "small gaps" (intra-row) from "large gaps" (inter-row).
 *
 * Maximizes inter-class variance between the two groups.
 */
export function otsuThreshold(gaps) {
  const sorted = [...gaps].sort((a, b) => a - b);

  if (sorted.length <= 1) {
    return sorted[0] * 1.5;
  }

  let bestThreshold = sorted[0];
  let bestVariance = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const threshold = (sorted[i] + sorted[i + 1]) / 2;

    const class0 = sorted.filter((g) => g <= threshold);
    const class1 = sorted.filter((g) => g > threshold);

    if (class0.length === 0 || class1.length === 0) continue;

    const mean0 = average(class0);
    const mean1 = average(class1);
    const w0 = class0.length / sorted.length;
    const w1 = class1.length / sorted.length;

    const variance = w0 * w1 * (mean0 - mean1) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

/**
 * Check if two bounding boxes overlap horizontally.
 * Returns the overlap amount in pixels (0 if no overlap).
 */
export function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
}

/**
 * Check if two items overlap vertically (their Y ranges intersect).
 */
export function verticalOverlap(a, b) {
  return !(a.bottom <= b.y || b.bottom <= a.y);
}

/**
 * Check if two items are side-by-side (Y overlap but X separate).
 */
export function areSideBySide(a, b) {
  const yOverlap = verticalOverlap(a, b);
  const xSeparate = a.right <= b.x || b.right <= a.x;
  return yOverlap && xSeparate;
}

/**
 * Check if any pair of children in the array are side-by-side.
 */
export function hasHorizontalArrangement(children) {
  const items = children.map(toSpatialItem).filter(Boolean);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (areSideBySide(items[i], items[j])) return true;
    }
  }
  return false;
}

/**
 * Estimate the median gap between horizontally arranged items.
 */
export function estimateGap(items) {
  if (items.length <= 1) return 0;

  const sorted = [...items].sort((a, b) => a.x - b.x);
  const gaps = [];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - sorted[i - 1].right;
    if (gap > 0) gaps.push(gap);
  }

  return gaps.length > 0 ? median(gaps) : 0;
}

/**
 * Compute the union bounding box of multiple spatial items or bboxes.
 * Accepts objects with { x, y, width, height } or { x, y, right, bottom }.
 */
export function computeBoundingBox(items) {
  if (!items || items.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const item of items) {
    const x = item.x;
    const y = item.y;
    const r = item.right !== undefined ? item.right : x + (item.width || 0);
    const b = item.bottom !== undefined ? item.bottom : y + (item.height || 0);

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (r > maxX) maxX = r;
    if (b > maxY) maxY = b;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Convert a Figma RGBA color {r, g, b, a} (0-1 range) to hex string.
 */
export function figmaColorToHex(color) {
  if (!color) return null;
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  return hex;
}

/**
 * Convert Figma RGBA to rgba() CSS string.
 */
export function figmaColorToRgba(color) {
  if (!color) return null;
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = color.a !== undefined ? color.a : 1;
  if (a === 1) return figmaColorToHex(color);
  return `rgba(${r},${g},${b},${parseFloat(a.toFixed(3))})`;
}
