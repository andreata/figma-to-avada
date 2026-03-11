// ─── Classify Figma leaf nodes into semantic types ───

import { figmaColorToHex, figmaColorToRgba } from '../utils/geometry.js';
import { extractBackground, extractBorderRadius } from './spacing-extractor.js';

/**
 * Classify a Figma node into a semantic element type for layout.json.
 *
 * @param {object} node - Figma node
 * @returns {object} Classified element descriptor
 */
export function classifyNode(node) {
  if (!node || node.visible === false) return null;

  const bbox = node.absoluteBoundingBox;
  if (!bbox) return null;

  // TEXT node
  if (node.type === 'TEXT') {
    return classifyText(node, bbox);
  }

  // RECTANGLE or ELLIPSE with image fill
  if (hasImageFill(node)) {
    return classifyImage(node, bbox);
  }

  // Thin rectangle → separator
  if (isSeparator(node, bbox)) {
    return classifySeparator(node, bbox);
  }

  // Small frame/group with text + background → button
  if (isButton(node, bbox)) {
    return classifyButton(node, bbox);
  }

  // VECTOR / LINE → decorative, skip or classify as separator
  if (node.type === 'VECTOR' || node.type === 'LINE') {
    return classifyVector(node, bbox);
  }

  // FRAME or GROUP that contains children → return as container (caller handles)
  if (node.children && node.children.length > 0) {
    return { type: 'container', id: node.id, name: node.name, bounds: toBounds(bbox), figmaNode: node };
  }

  // RECTANGLE without image → decorative block (background shape)
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    return classifyShape(node, bbox);
  }

  // Fallback
  return { type: 'unknown', id: node.id, name: node.name, bounds: toBounds(bbox) };
}

// ─── Text classification ───

function classifyText(node, bbox) {
  const style = node.style || {};

  const fontSize = style.fontSize || node.fontSize || 16;
  const fontWeight = style.fontWeight || node.fontWeight || 400;
  const fontFamily = style.fontFamily || node.fontFamily || '';
  const textAlign = (style.textAlignHorizontal || node.textAlignHorizontal || 'LEFT').toLowerCase();
  const lineHeightPx = style.lineHeightPx || node.lineHeightPx || null;
  const letterSpacing = style.letterSpacing || node.letterSpacing || 0;

  // Infer HTML tag from font size
  const tag = inferTag(fontSize, fontWeight);

  // Extract text color from fills
  const color = extractTextColor(node);

  return {
    type: 'text',
    id: node.id,
    name: node.name,
    content: node.characters || '',
    tag,
    style: {
      fontSize,
      fontWeight,
      fontFamily,
      color,
      textAlign,
      lineHeightPx,
      letterSpacing,
    },
    bounds: toBounds(bbox),
  };
}

function inferTag(fontSize, fontWeight) {
  if (fontSize >= 32) return 'h1';
  if (fontSize >= 24) return 'h2';
  if (fontSize >= 20) return 'h3';
  if (fontSize >= 16) return 'p';
  return 'span';
}

function extractTextColor(node) {
  const fills = node.fills;
  if (!fills || !Array.isArray(fills)) return null;

  for (const fill of fills) {
    if (fill.visible === false) continue;
    if (fill.type === 'SOLID' && fill.color) {
      const opacity = fill.opacity !== undefined ? fill.opacity : 1;
      if (opacity < 1) {
        return figmaColorToRgba({ ...fill.color, a: opacity });
      }
      return figmaColorToHex(fill.color);
    }
  }
  return null;
}

// ─── Image classification ───

function hasImageFill(node) {
  const fills = node.fills;
  if (!fills || !Array.isArray(fills)) return false;
  return fills.some((f) => f.type === 'IMAGE' && f.visible !== false);
}

function classifyImage(node, bbox) {
  const imageFill = node.fills.find((f) => f.type === 'IMAGE' && f.visible !== false);

  return {
    type: 'image',
    id: node.id,
    name: node.name,
    figmaImageHash: imageFill.imageRef || null,
    scaleMode: imageFill.scaleMode || 'FILL',
    bounds: toBounds(bbox),
    cornerRadius: extractBorderRadius(node),
  };
}

// ─── Button classification ───

function isButton(node, bbox) {
  // Must be a FRAME, GROUP, INSTANCE, or COMPONENT
  if (!['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT'].includes(node.type)) return false;

  // Must be relatively small
  if (bbox.height > 80) return false;
  if (bbox.width > 500) return false;

  // Must have children
  const children = node.children;
  if (!children || children.length === 0) return false;

  // Must contain at least one text child with short text
  const textChild = findTextChild(children);
  if (!textChild) return false;
  if (textChild.characters && textChild.characters.length > 60) return false;

  // Should have background fill or border
  const hasBg = node.fills && node.fills.some((f) => f.visible !== false && f.type === 'SOLID' && f.opacity !== 0);
  const hasBorder = node.strokes && node.strokes.length > 0 && node.strokeWeight > 0;
  const hasRadius = (node.cornerRadius || 0) > 0;

  return hasBg || hasBorder || hasRadius;
}

function findTextChild(children) {
  for (const child of children) {
    if (child.type === 'TEXT') return child;
    if (child.children) {
      const found = findTextChild(child.children);
      if (found) return found;
    }
  }
  return null;
}

function classifyButton(node, bbox) {
  const textChild = findTextChild(node.children);
  const textColor = textChild ? extractTextColor(textChild) : null;
  const textStyle = textChild?.style || {};
  const bg = extractBackground(node);

  return {
    type: 'button',
    id: node.id,
    name: node.name,
    text: textChild?.characters || '',
    style: {
      fontSize: textStyle.fontSize || textChild?.fontSize || 16,
      fontWeight: textStyle.fontWeight || textChild?.fontWeight || 600,
      color: textColor,
    },
    background: bg ? bg.color || null : null,
    cornerRadius: extractBorderRadius(node),
    bounds: toBounds(bbox),
  };
}

// ─── Separator classification ───

function isSeparator(node, bbox) {
  if (!['RECTANGLE', 'LINE', 'VECTOR'].includes(node.type)) return false;
  return bbox.height <= 5 && bbox.width > bbox.height * 10;
}

function classifySeparator(node, bbox) {
  const color = extractBackground(node);
  return {
    type: 'separator',
    id: node.id,
    name: node.name,
    bounds: toBounds(bbox),
    color: color ? color.color || null : null,
  };
}

// ─── Vector / line classification ───

function classifyVector(node, bbox) {
  if (isSeparator(node, bbox)) {
    return classifySeparator(node, bbox);
  }
  return {
    type: 'icon',
    id: node.id,
    name: node.name,
    bounds: toBounds(bbox),
  };
}

// ─── Shape classification ───

function classifyShape(node, bbox) {
  return {
    type: 'shape',
    id: node.id,
    name: node.name,
    bounds: toBounds(bbox),
    background: extractBackground(node),
    cornerRadius: extractBorderRadius(node),
  };
}

// ─── Dynamic section detection ───

/**
 * Check if a set of children represents a dynamic (repeated) pattern.
 * Returns { isDynamic: true, hint: '...' } or { isDynamic: false }.
 */
export function detectDynamic(children) {
  if (!children || children.length < 3) return { isDynamic: false, hint: null };

  // Check for repeated INSTANCE nodes with the same componentId
  const instances = children.filter((c) => c.type === 'INSTANCE' && c.componentId);
  if (instances.length >= 3) {
    const componentIds = instances.map((i) => i.componentId);
    const mostCommon = mode(componentIds);
    const count = componentIds.filter((id) => id === mostCommon).length;

    if (count >= 3) {
      return { isDynamic: true, hint: inferDynamicHint(instances[0], count) };
    }
  }

  // Check for structurally similar children
  if (children.length >= 3) {
    const signatures = children.map(structuralSignature);
    const mostCommonSig = mode(signatures);
    const matchCount = signatures.filter((s) => s === mostCommonSig).length;

    if (matchCount >= 3 && matchCount >= children.length * 0.6) {
      // Also check dimension similarity (within 10%)
      const matchingChildren = children.filter((_, i) => signatures[i] === mostCommonSig);
      if (areDimensionsSimilar(matchingChildren, 0.1)) {
        return { isDynamic: true, hint: inferDynamicHint(matchingChildren[0], matchCount) };
      }
    }
  }

  return { isDynamic: false, hint: null };
}

/**
 * Generate a structural signature for a node (type + child structure).
 */
function structuralSignature(node) {
  if (!node.children || node.children.length === 0) {
    return node.type;
  }
  const childTypes = node.children.map((c) => c.type).join(',');
  return `${node.type}[${childTypes}]`;
}

/**
 * Check if nodes have similar dimensions (within tolerance ratio).
 */
function areDimensionsSimilar(nodes, tolerance) {
  if (nodes.length <= 1) return true;

  const widths = nodes.map((n) => n.absoluteBoundingBox?.width || 0);
  const heights = nodes.map((n) => n.absoluteBoundingBox?.height || 0);

  const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
  const avgH = heights.reduce((a, b) => a + b, 0) / heights.length;

  return (
    widths.every((w) => Math.abs(w - avgW) / avgW <= tolerance) &&
    heights.every((h) => Math.abs(h - avgH) / avgH <= tolerance)
  );
}

/**
 * Infer what kind of dynamic content this might be.
 */
function inferDynamicHint(sampleNode, count) {
  const name = (sampleNode.name || '').toLowerCase();

  if (name.includes('product') || name.includes('prodott')) return 'product-grid';
  if (name.includes('card') || name.includes('post') || name.includes('blog') || name.includes('news')) return 'blog-grid';
  if (name.includes('slide') || name.includes('carousel')) return 'carousel';
  if (name.includes('testimonial') || name.includes('review')) return 'card-list';

  // Default based on count
  return count > 4 ? 'card-list' : 'blog-grid';
}

/**
 * Find the statistical mode of an array.
 */
function mode(arr) {
  const freq = {};
  let maxCount = 0;
  let maxVal = arr[0];

  for (const val of arr) {
    freq[val] = (freq[val] || 0) + 1;
    if (freq[val] > maxCount) {
      maxCount = freq[val];
      maxVal = val;
    }
  }

  return maxVal;
}

// ─── Helpers ───

function toBounds(bbox) {
  return {
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
  };
}
