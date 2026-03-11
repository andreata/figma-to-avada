// ─── Avada fraction snapping engine ───
// Maps raw width percentages to valid Avada column fractions.
// Uses a 4-level strategy: known compositions → greedy → exhaustive → fallback.

const SNAP_MAX_DISTANCE = 0.06; // 6% max distance for individual snap

/**
 * All valid Avada column fractions, sorted ascending.
 */
export const FRACTIONS_SORTED = [
  { key: '1_6', val: 1 / 6 },
  { key: '1_5', val: 1 / 5 },
  { key: '1_4', val: 1 / 4 },
  { key: '1_3', val: 1 / 3 },
  { key: '2_5', val: 2 / 5 },
  { key: '1_2', val: 1 / 2 },
  { key: '3_5', val: 3 / 5 },
  { key: '2_3', val: 2 / 3 },
  { key: '3_4', val: 3 / 4 },
  { key: '4_5', val: 4 / 5 },
  { key: '1_1', val: 1 },
];

/**
 * Quick lookup: fraction key → decimal value.
 */
export const FRACTION_VALUES = Object.fromEntries(
  FRACTIONS_SORTED.map((f) => [f.key, f.val])
);

/**
 * Pre-computed valid row compositions that sum to ~1.0.
 * Covers the most common Avada layouts from real-world usage.
 */
const KNOWN_COMPOSITIONS = {
  1: [['1_1']],
  2: [
    ['1_2', '1_2'],
    ['1_3', '2_3'],
    ['2_3', '1_3'],
    ['1_4', '3_4'],
    ['3_4', '1_4'],
    ['1_5', '4_5'],
    ['4_5', '1_5'],
    ['2_5', '3_5'],
    ['3_5', '2_5'],
    ['1_6', '5_6'], // 5_6 not in Avada — excluded
  ].filter((comp) => comp.every((k) => k in FRACTION_VALUES)),
  3: [
    ['1_3', '1_3', '1_3'],
    ['1_4', '1_4', '1_2'],
    ['1_4', '1_2', '1_4'],
    ['1_2', '1_4', '1_4'],
    ['1_5', '1_5', '3_5'],
    ['1_5', '3_5', '1_5'],
    ['3_5', '1_5', '1_5'],
    ['1_6', '1_6', '2_3'],
    ['1_6', '2_3', '1_6'],
    ['2_3', '1_6', '1_6'],
    ['1_5', '2_5', '2_5'],
    ['2_5', '1_5', '2_5'],
    ['2_5', '2_5', '1_5'],
  ],
  4: [
    ['1_4', '1_4', '1_4', '1_4'],
    ['1_5', '1_5', '1_5', '2_5'],
    ['1_5', '1_5', '2_5', '1_5'],
    ['1_5', '2_5', '1_5', '1_5'],
    ['2_5', '1_5', '1_5', '1_5'],
    ['1_6', '1_6', '1_6', '1_2'],
    ['1_6', '1_6', '1_2', '1_6'],
    ['1_6', '1_2', '1_6', '1_6'],
    ['1_2', '1_6', '1_6', '1_6'],
    ['1_6', '1_4', '1_4', '1_3'],
    ['1_5', '1_4', '1_4', '3_10'], // 3_10 not in Avada — filtered
  ].filter((comp) =>
    comp.every((k) => k in FRACTION_VALUES) &&
    Math.abs(comp.reduce((s, k) => s + FRACTION_VALUES[k], 0) - 1.0) < 0.01
  ),
  5: [
    ['1_5', '1_5', '1_5', '1_5', '1_5'],
    ['1_6', '1_6', '1_6', '1_6', '1_3'],
    ['1_6', '1_6', '1_6', '1_3', '1_6'],
    ['1_6', '1_6', '1_3', '1_6', '1_6'],
    ['1_6', '1_3', '1_6', '1_6', '1_6'],
    ['1_3', '1_6', '1_6', '1_6', '1_6'],
  ].filter((comp) =>
    comp.every((k) => k in FRACTION_VALUES) &&
    Math.abs(comp.reduce((s, k) => s + FRACTION_VALUES[k], 0) - 1.0) < 0.01
  ),
  6: [['1_6', '1_6', '1_6', '1_6', '1_6', '1_6']],
};

/**
 * Snap a single raw fraction to the nearest Avada fraction.
 * Returns { key, val, distance } or null if too far.
 */
export function snapSingle(rawFraction) {
  let bestKey = null;
  let bestVal = 0;
  let bestDist = Infinity;

  for (const { key, val } of FRACTIONS_SORTED) {
    const dist = Math.abs(rawFraction - val);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
      bestVal = val;
    }
  }

  if (bestDist > SNAP_MAX_DISTANCE) return null;
  return { key: bestKey, val: bestVal, distance: bestDist };
}

/**
 * Level 1: Try known compositions.
 * Returns array of fraction keys or null.
 */
function tryKnownCompositions(rawFractions) {
  const n = rawFractions.length;
  const compositions = KNOWN_COMPOSITIONS[n];
  if (!compositions) return null;

  let bestMatch = null;
  let bestError = Infinity;

  for (const comp of compositions) {
    let totalError = 0;
    for (let i = 0; i < n; i++) {
      totalError += Math.abs(rawFractions[i] - FRACTION_VALUES[comp[i]]);
    }

    if (totalError < bestError) {
      bestError = totalError;
      bestMatch = comp;
    }
  }

  // Accept if average error per column is below threshold
  if (bestMatch && bestError / n <= SNAP_MAX_DISTANCE) {
    return [...bestMatch];
  }

  return null;
}

/**
 * Level 2: Greedy snap with sum constraint.
 * Snaps each column individually, last column takes remainder.
 * Returns array of fraction keys or null.
 */
function greedyConstrainedSnap(rawFractions) {
  const n = rawFractions.length;
  const result = [];
  let remaining = 1.0;

  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      // Last column: snap whatever remains
      const snap = snapSingle(remaining);
      if (!snap) return null;
      result.push(snap.key);
    } else {
      const snap = snapSingle(rawFractions[i]);
      if (!snap) return null;
      result.push(snap.key);
      remaining -= snap.val;

      // Check if remaining is feasible for the rest
      const minNeeded = (n - i - 1) * FRACTIONS_SORTED[0].val;
      if (remaining < minNeeded - 0.01) return null;
    }
  }

  // Verify sum
  const total = result.reduce((s, k) => s + FRACTION_VALUES[k], 0);
  if (Math.abs(total - 1.0) > 0.01) return null;

  return result;
}

/**
 * Level 3: Exhaustive search with pruning (for n <= 6).
 * Finds the assignment that minimizes total error while summing to 1.0.
 * Returns array of fraction keys or null.
 */
function exhaustiveSearch(rawFractions) {
  const n = rawFractions.length;
  let bestAssignment = null;
  let bestError = Infinity;

  // Exclude 1_1 from inner search for multi-column rows (a single column
  // taking 100% in a multi-column row doesn't make sense).
  const candidates = n > 1
    ? FRACTIONS_SORTED.filter((f) => f.key !== '1_1')
    : FRACTIONS_SORTED;
  const maxVal = candidates[candidates.length - 1].val;

  function search(index, assignment, currentSum, currentError) {
    // Prune: already exceeds 1.0
    if (currentSum > 1.0 + 0.005) return;

    // Prune: error already worse than best
    if (currentError >= bestError) return;

    if (index === n) {
      if (Math.abs(currentSum - 1.0) <= 0.01) {
        if (currentError < bestError) {
          bestError = currentError;
          bestAssignment = [...assignment];
        }
      }
      return;
    }

    const remainingBudget = 1.0 - currentSum;
    const remainingSlots = n - index;

    for (const { key, val } of candidates) {
      // Prune: this fraction alone exceeds remaining budget
      if (val > remainingBudget + 0.005) continue;

      // Prune: remaining slots can't fill the rest after this
      const afterThis = remainingBudget - val;
      if (remainingSlots > 1 && afterThis > (remainingSlots - 1) * maxVal + 0.005) continue;

      const error = Math.abs(rawFractions[index] - val);

      // Prune: error bound exceeded
      if (currentError + error >= bestError) continue;

      assignment.push(key);
      search(index + 1, assignment, currentSum + val, currentError + error);
      assignment.pop();
    }
  }

  search(0, [], 0, 0);
  return bestAssignment;
}

/**
 * Level 4: Fallback — force equal distribution.
 * Returns array of fraction keys or null (if n > 6).
 */
function forceEqualDistribution(n) {
  const map = { 1: '1_1', 2: '1_2', 3: '1_3', 4: '1_4', 5: '1_5', 6: '1_6' };
  if (!(n in map)) return null;
  return Array(n).fill(map[n]);
}

/**
 * Main entry: snap an array of raw fractions to valid Avada fractions.
 *
 * @param {number[]} rawFractions - Array of raw width ratios (should sum to ~1.0)
 * @returns {{ fractions: string[], method: string }} Snapped fraction keys + which method was used
 */
export function snapRowFractions(rawFractions) {
  const n = rawFractions.length;

  // Single column: always 1_1
  if (n === 1) {
    return { fractions: ['1_1'], method: 'single' };
  }

  // Level 1: Known compositions
  const known = tryKnownCompositions(rawFractions);
  if (known) return { fractions: known, method: 'known' };

  // Level 2: Greedy
  const greedy = greedyConstrainedSnap(rawFractions);
  if (greedy) return { fractions: greedy, method: 'greedy' };

  // Level 3: Exhaustive (n <= 6)
  if (n <= 6) {
    const exhaustive = exhaustiveSearch(rawFractions);
    if (exhaustive) return { fractions: exhaustive, method: 'exhaustive' };
  }

  // Level 4: Fallback equal
  const equal = forceEqualDistribution(n);
  if (equal) return { fractions: equal, method: 'fallback-equal' };

  // Absolute fallback: shouldn't happen, but return 1_1 for each
  return {
    fractions: rawFractions.map(() => '1_1'),
    method: 'fallback-overflow',
  };
}
