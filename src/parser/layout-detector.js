// ─── Layout Detector: the CORE of the parser ───
// Detects rows and columns from Figma node trees.
// Two paths: auto-layout (easy) and geometry-based heuristics (hard).

import {
  toSpatialItem,
  computeYTolerance,
  average,
  estimateGap,
  hasHorizontalArrangement,
  horizontalOverlap,
} from '../utils/geometry.js';
import { snapRowFractions, FRACTION_VALUES } from './fraction-snapper.js';
import { extractPadding, extractItemSpacing, extractFlexProps } from './spacing-extractor.js';
import { classifyNode, detectDynamic } from './node-classifier.js';

const MIN_COLUMN_WIDTH_RATIO = 0.05; // 5% of content width — smaller = decorative

/**
 * Detect rows within a section node.
 * This is the main entry point for layout detection.
 *
 * @param {object} sectionNode - The Figma node representing a section
 * @param {number} contentWidth - The available content width (section width minus padding)
 * @param {number} contentX - The X position where content starts
 * @returns {object[]} Array of detected rows
 */
export function detectRows(sectionNode, contentWidth, contentX) {
  const children = sectionNode.children;
  if (!children || children.length === 0) return [];

  const layoutMode = sectionNode.layoutMode || 'NONE';

  if (layoutMode === 'HORIZONTAL') {
    return detectRowsAutoLayoutH(children, contentWidth, contentX, sectionNode);
  }

  if (layoutMode === 'VERTICAL') {
    return detectRowsVertical(children, contentWidth, contentX, sectionNode);
  }

  // layoutMode === 'NONE' — geometry-based heuristics
  return detectRowsGeometry(children, contentWidth, contentX, sectionNode);
}

// ─── Path A: Auto Layout HORIZONTAL ───
// The entire frame IS a single row. Each child = a column.

function detectRowsAutoLayoutH(children, contentWidth, contentX, parent) {
  const { flowChildren, absoluteChildren } = separateAbsoluteChildren(children);

  if (flowChildren.length === 0) {
    // All children are absolute — treat as geometry
    return detectRowsGeometry(children, contentWidth, contentX, parent);
  }

  // Sort by X position (Figma children are z-ordered)
  const items = flowChildren
    .map(toSpatialItem)
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  if (items.length === 0) return [];

  const columns = buildColumns(items, contentWidth, contentX);
  const gap = extractItemSpacing(parent);

  return [makeRow(columns, gap, parent)];
}

// ─── Path A2: Auto Layout VERTICAL ───
// Each child is stacked vertically. Each child may itself be a row.

function detectRowsVertical(children, contentWidth, contentX, parent) {
  const { flowChildren } = separateAbsoluteChildren(children);
  const rows = [];

  for (const child of flowChildren) {
    if (!child.absoluteBoundingBox) continue;

    const childLayout = child.layoutMode || 'NONE';

    if (childLayout === 'HORIZONTAL' && child.children && child.children.length > 1) {
      // This child IS a row containing columns
      const childPadding = extractPadding(child);
      const childBbox = child.absoluteBoundingBox;
      const childContentWidth = childBbox.width - childPadding.left - childPadding.right;
      const childContentX = childBbox.x + childPadding.left;

      const subRows = detectRowsAutoLayoutH(
        child.children, childContentWidth, childContentX, child
      );
      rows.push(...subRows);
    } else {
      // Single element or vertical stack — wrap as single-column row
      rows.push(makeSingleColumnRow(child, contentWidth));
    }
  }

  return rows;
}

// ─── Path B: Geometry-Based Heuristics ───

function detectRowsGeometry(children, contentWidth, contentX, parent) {
  const visibleChildren = children.filter(
    (c) => c.visible !== false && c.absoluteBoundingBox
  );

  if (visibleChildren.length === 0) return [];

  // Build spatial items
  const items = visibleChildren
    .map(toSpatialItem)
    .filter(Boolean);

  if (items.length === 0) return [];

  // Filter out decorative elements (very small)
  const { significant, decorative } = filterDecorativeElements(items, contentWidth);

  if (significant.length === 0) {
    // Everything is decorative — wrap all in a single column
    return [makeSingleColumnRow(parent, contentWidth)];
  }

  // Sort by cy (vertical center), then x
  significant.sort((a, b) => a.cy - b.cy || a.x - b.x);

  // Compute Y tolerance
  const yTolerance = computeYTolerance(significant);

  // Group into horizontal bands (rows)
  const rowGroups = groupIntoRows(significant, yTolerance);

  // Build row objects
  const rows = [];

  for (const rowItems of rowGroups) {
    // Sort row items left-to-right
    rowItems.sort((a, b) => a.x - b.x);

    // Handle overlapping items in X
    const cleaned = mergeOverlapping(rowItems);

    if (cleaned.length === 1) {
      rows.push(makeSingleColumnRow(cleaned[0].figmaNode, contentWidth));
    } else {
      const columns = buildColumns(cleaned, contentWidth, contentX);
      const gap = estimateGap(cleaned);
      rows.push(makeRow(columns, gap, parent));
    }
  }

  return rows;
}

// ─── Row Grouping ───

/**
 * Group spatial items into rows based on Y-center proximity.
 * Uses running average for row reference Y to prevent drift.
 */
function groupIntoRows(items, yTolerance) {
  const rows = [];
  const used = new Set();

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;

    const rowItems = [items[i]];
    used.add(i);
    let refCy = items[i].cy;

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;

      const dist = Math.abs(items[j].cy - refCy);

      if (dist <= yTolerance) {
        rowItems.push(items[j]);
        used.add(j);
        // Update reference as running average
        refCy = average(rowItems.map((r) => r.cy));
      } else if (dist > yTolerance * 2) {
        // Definitely a new row — break early
        break;
      }
    }

    rows.push(rowItems);
  }

  return rows;
}

// ─── Column Building (Midpoint Territory) ───

/**
 * Build column descriptors using the midpoint-territory algorithm.
 * Guarantees raw fractions sum to exactly 1.0.
 */
function buildColumns(items, contentWidth, contentX) {
  if (items.length === 0) return [];

  if (items.length === 1) {
    const item = items[0];
    return [{
      id: item.figmaNode.id,
      name: item.figmaNode.name,
      figmaNode: item.figmaNode,
      bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
      rawFraction: 1,
      avadaFraction: '1_1',
    }];
  }

  const columns = [];
  const contentRight = contentX + contentWidth;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Left edge of this column's territory
    let leftEdge;
    if (i === 0) {
      leftEdge = contentX;
    } else {
      const prevRight = items[i - 1].right;
      leftEdge = (prevRight + item.x) / 2;
    }

    // Right edge of this column's territory
    let rightEdge;
    if (i === items.length - 1) {
      rightEdge = contentRight;
    } else {
      const thisRight = item.right;
      const nextLeft = items[i + 1].x;
      rightEdge = (thisRight + nextLeft) / 2;
    }

    const effectiveWidth = rightEdge - leftEdge;
    const rawFraction = effectiveWidth / contentWidth;

    columns.push({
      id: item.figmaNode.id,
      name: item.figmaNode.name,
      figmaNode: item.figmaNode,
      bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
      rawFraction,
      effectiveWidth,
    });
  }

  // Snap fractions
  const rawFractions = columns.map((c) => c.rawFraction);
  const { fractions, method } = snapRowFractions(rawFractions);

  for (let i = 0; i < columns.length; i++) {
    columns[i].avadaFraction = fractions[i];
    columns[i].snapMethod = method;
  }

  return columns;
}

// ─── Process Column Content (recursive) ───

/**
 * Process the content of a column recursively.
 * Detects inner rows (nesting) and classifies leaf elements.
 *
 * @param {object} figmaNode - The Figma node for this column
 * @param {number} depth - Current nesting depth (0 = top-level, 1 = inner)
 * @returns {object} Column content descriptor
 */
export function processColumnContent(figmaNode, depth = 0) {
  const children = figmaNode.children;
  if (!children || children.length === 0) {
    return { children: [], innerRows: [] };
  }

  // Avada only supports 1 level of nesting
  if (depth >= 1) {
    // Flatten: classify all children as elements
    const elements = classifyChildren(children);
    return { children: elements, innerRows: [] };
  }

  // Check if the column's content has horizontal arrangement → inner rows needed
  const layoutMode = figmaNode.layoutMode || 'NONE';
  const bbox = figmaNode.absoluteBoundingBox;
  const padding = extractPadding(figmaNode);
  const colContentWidth = bbox ? bbox.width - padding.left - padding.right : 0;
  const colContentX = bbox ? bbox.x + padding.left : 0;

  // Check for horizontal auto-layout with multiple children
  if (layoutMode === 'HORIZONTAL' && children.length > 1) {
    return buildInnerRows(children, colContentWidth, colContentX, figmaNode, depth);
  }

  // For VERTICAL or NONE layout, check each child
  if (layoutMode === 'VERTICAL') {
    return processVerticalColumnContent(children, colContentWidth, colContentX, figmaNode, depth);
  }

  // NONE layout: check geometry for horizontal arrangement
  if (hasHorizontalArrangement(children)) {
    return buildInnerRowsGeometry(children, colContentWidth, colContentX, figmaNode, depth);
  }

  // Pure vertical content — classify each child
  const elements = classifyChildren(children);
  return { children: elements, innerRows: [] };
}

function processVerticalColumnContent(children, contentWidth, contentX, parent, depth) {
  const elements = [];
  const innerRows = [];

  for (const child of children) {
    if (!child.absoluteBoundingBox || child.visible === false) continue;

    const childLayout = child.layoutMode || 'NONE';

    if (childLayout === 'HORIZONTAL' && child.children && child.children.length > 1) {
      // This child is a horizontal row inside the column
      const result = buildInnerRows(
        child.children,
        child.absoluteBoundingBox.width - (child.paddingLeft || 0) - (child.paddingRight || 0),
        child.absoluteBoundingBox.x + (child.paddingLeft || 0),
        child,
        depth
      );
      innerRows.push(...result.innerRows);
    } else {
      const classified = classifyNode(child);
      if (classified) elements.push(classified);
    }
  }

  return { children: elements, innerRows };
}

function buildInnerRows(children, contentWidth, contentX, parent, depth) {
  const { flowChildren } = separateAbsoluteChildren(children);
  const items = flowChildren
    .map(toSpatialItem)
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  if (items.length <= 1) {
    const elements = classifyChildren(children);
    return { children: elements, innerRows: [] };
  }

  const columns = buildColumns(items, contentWidth, contentX);
  const gap = extractItemSpacing(parent);

  // Process each inner column's content
  const innerColumns = columns.map((col) => {
    const content = processColumnContent(col.figmaNode, depth + 1);
    return {
      ...col,
      children: content.children,
      innerRows: content.innerRows,
      padding: extractPadding(col.figmaNode),
    };
  });

  const innerRow = {
    type: 'inner_row',
    gap,
    columns: innerColumns,
  };

  return { children: [], innerRows: [innerRow] };
}

function buildInnerRowsGeometry(children, contentWidth, contentX, parent, depth) {
  const visibleChildren = children.filter(
    (c) => c.visible !== false && c.absoluteBoundingBox
  );

  const items = visibleChildren
    .map(toSpatialItem)
    .filter(Boolean);

  const { significant } = filterDecorativeElements(items, contentWidth);

  if (significant.length <= 1) {
    const elements = classifyChildren(children);
    return { children: elements, innerRows: [] };
  }

  significant.sort((a, b) => a.cy - b.cy || a.x - b.x);
  const yTolerance = computeYTolerance(significant);
  const rowGroups = groupIntoRows(significant, yTolerance);

  const allElements = [];
  const innerRows = [];

  for (const rowItems of rowGroups) {
    rowItems.sort((a, b) => a.x - b.x);
    const cleaned = mergeOverlapping(rowItems);

    if (cleaned.length === 1) {
      const classified = classifyNode(cleaned[0].figmaNode);
      if (classified) allElements.push(classified);
    } else {
      const columns = buildColumns(cleaned, contentWidth, contentX);
      const gap = estimateGap(cleaned);

      const innerColumns = columns.map((col) => {
        const content = processColumnContent(col.figmaNode, depth + 1);
        return {
          ...col,
          children: content.children,
          innerRows: content.innerRows,
          padding: extractPadding(col.figmaNode),
        };
      });

      innerRows.push({ type: 'inner_row', gap, columns: innerColumns });
    }
  }

  return { children: allElements, innerRows };
}

// ─── Helpers ───

/**
 * Separate auto-layout flow children from absolutely positioned children.
 */
function separateAbsoluteChildren(children) {
  const flowChildren = [];
  const absoluteChildren = [];

  for (const child of children) {
    if (child.layoutPositioning === 'ABSOLUTE') {
      absoluteChildren.push(child);
    } else {
      flowChildren.push(child);
    }
  }

  return { flowChildren, absoluteChildren };
}

/**
 * Filter out decorative elements (too small to be columns).
 */
function filterDecorativeElements(items, contentWidth) {
  const significant = [];
  const decorative = [];

  for (const item of items) {
    if (item.width < contentWidth * MIN_COLUMN_WIDTH_RATIO) {
      decorative.push(item);
    } else {
      significant.push(item);
    }
  }

  return { significant, decorative };
}

/**
 * Merge items that significantly overlap in X (they are layered, not side-by-side).
 * Keeps the front-most (last in original Figma order) or merges into one.
 */
function mergeOverlapping(items) {
  if (items.length <= 1) return items;

  const result = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const current = items[i];
    const prev = result[result.length - 1];

    const overlap = horizontalOverlap(prev, current);
    const minWidth = Math.min(prev.width, current.width);

    if (overlap > minWidth * 0.5) {
      // Significant overlap: keep the larger one (it's likely the container)
      if (current.width * current.height > prev.width * prev.height) {
        result[result.length - 1] = current;
      }
      // else keep prev
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Classify all children as leaf elements.
 */
function classifyChildren(children) {
  const results = [];
  for (const child of children) {
    if (child.visible === false) continue;
    const classified = classifyNode(child);
    if (classified) results.push(classified);
  }
  return results;
}

/**
 * Create a row with properly structured columns.
 */
function makeRow(columns, gap, parent) {
  return {
    type: 'row',
    gap: Math.round(gap),
    flex: extractFlexProps(parent),
    columns: columns.map((col, i) => ({
      id: col.id,
      name: col.name,
      type: 'column',
      avadaFraction: col.avadaFraction,
      rawWidthPercent: Math.round(col.rawFraction * 10000) / 100,
      bounds: col.bounds,
      padding: extractPadding(col.figmaNode),
      ...processColumnContent(col.figmaNode, 0),
    })),
  };
}

/**
 * Create a single-column (1_1) row wrapping a single element.
 */
function makeSingleColumnRow(figmaNode, contentWidth) {
  const bbox = figmaNode.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const content = figmaNode.children && figmaNode.children.length > 0
    ? processColumnContent(figmaNode, 0)
    : { children: [classifyNode(figmaNode)].filter(Boolean), innerRows: [] };

  return {
    type: 'row',
    gap: 0,
    flex: extractFlexProps(figmaNode),
    columns: [{
      id: figmaNode.id,
      name: figmaNode.name,
      type: 'column',
      avadaFraction: '1_1',
      rawWidthPercent: 100,
      bounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      padding: extractPadding(figmaNode),
      ...content,
    }],
  };
}
