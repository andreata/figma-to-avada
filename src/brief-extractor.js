// ─── Page Brief Extractor ───
// Walks the raw Figma node tree for each section and produces a compact,
// AI-readable JSON with ALL visible nodes and their properties preserved.
// This replaces the lossy layout-detector + node-classifier pipeline.

import { figmaColorToHex, figmaColorToRgba } from './utils/geometry.js';

const MAX_DEPTH = 8;

/**
 * Extract a complete page brief from raw Figma section groups.
 *
 * @param {object} frame - The Figma frame node (website page)
 * @param {object[]} sectionGroups - Groups from section-grouper (with memberNodes)
 * @param {Map<string, string>} imageNameMap - hash → readable filename
 * @param {string} wpBaseUrl - WordPress base URL for images
 * @returns {object} Page brief with sections and image mapping
 */
export function extractPageBrief(frame, sectionGroups, imageNameMap, wpBaseUrl) {
  const frameBbox = frame.absoluteBoundingBox;
  const pageWidth = frameBbox ? frameBbox.width : 1440;

  const imageMapping = {};
  for (const [hash, name] of imageNameMap) {
    const filename = `${name}.webp`;
    imageMapping[hash] = {
      filename,
      wpUrl: wpBaseUrl ? `${wpBaseUrl.replace(/\/$/, '')}/${filename}` : filename,
    };
  }

  const sections = sectionGroups.map((group, index) =>
    extractSectionBrief(group, index, imageNameMap)
  );

  return {
    meta: {
      pageWidth,
      frameName: frame.name,
      frameId: frame.id,
      extractedAt: new Date().toISOString(),
    },
    images: imageMapping,
    sections,
  };
}

/**
 * Extract a brief for a single section from its grouper output.
 */
export function extractSectionBrief(group, index, imageNameMap) {
  const { containerNode, memberNodes, bounds, background, name } = group;

  // Collect all unique Figma nodes for this section.
  // The containerNode may overlap with memberNodes, so deduplicate.
  const seenIds = new Set();
  const nodeTree = [];

  for (const node of memberNodes) {
    if (seenIds.has(node.id)) continue;
    seenIds.add(node.id);

    const compact = walkNode(node, 0, imageNameMap);
    if (compact) nodeTree.push(compact);
  }

  // Enrich background with image filename if applicable
  let enrichedBg = background;
  if (background?.type === 'image' && background.imageHash && imageNameMap.has(background.imageHash)) {
    enrichedBg = {
      ...background,
      filename: `${imageNameMap.get(background.imageHash)}.webp`,
    };
  }

  return {
    index,
    name: name || `Section ${index + 1}`,
    bounds,
    background: enrichedBg,
    nodeCount: countNodes(nodeTree),
    nodeTree,
  };
}

/**
 * Recursively walk a Figma node and produce a compact descriptor.
 * Only includes properties that have non-default values.
 */
function walkNode(node, depth, imageNameMap) {
  if (!node) return null;
  if (node.visible === false) return null;

  const bbox = node.absoluteBoundingBox;
  if (!bbox) return null;

  const compact = {
    type: node.type,
    name: node.name || undefined,
    bounds: {
      x: Math.round(bbox.x),
      y: Math.round(bbox.y),
      width: Math.round(bbox.width),
      height: Math.round(bbox.height),
    },
  };

  // Text content
  if (node.type === 'TEXT') {
    compact.characters = node.characters || '';
    compact.style = extractTextStyle(node);
  }

  // Figma node ID (needed for SVG export of icons)
  if (node.id) {
    compact.nodeId = node.id;
  }

  // Instance/component reference
  if (node.type === 'INSTANCE' && node.componentId) {
    compact.componentId = node.componentId;
  }
  if (node.componentId && node.type !== 'INSTANCE') {
    compact.componentId = node.componentId;
  }

  // Fills (compact)
  const fills = compactFills(node.fills);
  if (fills.length > 0) compact.fills = fills;

  // Strokes (compact)
  const strokes = compactStrokes(node);
  if (strokes) compact.strokes = strokes;

  // Effects (compact)
  const effects = compactEffects(node.effects);
  if (effects.length > 0) compact.effects = effects;

  // Corner radius
  const radius = extractCornerRadius(node);
  if (radius !== 0 && radius !== null) compact.cornerRadius = radius;

  // Opacity
  if (node.opacity !== undefined && node.opacity !== null && node.opacity < 1) {
    compact.opacity = parseFloat(node.opacity.toFixed(3));
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    compact.blendMode = node.blendMode;
  }

  // Layout properties (auto-layout)
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    compact.layout = {
      mode: node.layoutMode,
      primaryAlign: node.primaryAxisAlignItems || 'MIN',
      counterAlign: node.counterAxisAlignItems || 'MIN',
      wrap: node.layoutWrap === 'WRAP' || undefined,
      gap: node.itemSpacing || undefined,
      padding: extractPaddingCompact(node),
    };
    // Clean up undefined fields
    Object.keys(compact.layout).forEach(k => compact.layout[k] === undefined && delete compact.layout[k]);
  }

  // Image reference (for the image mapping)
  const imageRef = findImageRef(node.fills);
  if (imageRef) {
    compact.imageRef = imageRef;
    if (imageNameMap.has(imageRef)) {
      compact.imageFilename = `${imageNameMap.get(imageRef)}.webp`;
    }
  }

  // Children (recursive, with depth limit)
  if (node.children && node.children.length > 0) {
    if (depth >= MAX_DEPTH) {
      compact.children = `${node.children.length} nested nodes (depth limit)`;
    } else {
      const childCompacts = node.children
        .map(child => walkNode(child, depth + 1, imageNameMap))
        .filter(Boolean);
      if (childCompacts.length > 0) {
        compact.children = childCompacts;
      }
    }
  }

  return compact;
}

// ─── Compact property extractors ───

function extractTextStyle(node) {
  const style = node.style || {};
  const result = {};

  const fontSize = style.fontSize || node.fontSize;
  if (fontSize) result.fontSize = fontSize;

  const fontWeight = style.fontWeight || node.fontWeight;
  if (fontWeight && fontWeight !== 400) result.fontWeight = fontWeight;

  const fontFamily = style.fontFamily || node.fontFamily;
  if (fontFamily) result.fontFamily = fontFamily;

  const textAlign = (style.textAlignHorizontal || node.textAlignHorizontal || '').toUpperCase();
  if (textAlign && textAlign !== 'LEFT') result.textAlign = textAlign.toLowerCase();

  const lineHeightPx = style.lineHeightPx || node.lineHeightPx;
  if (lineHeightPx) result.lineHeightPx = Math.round(lineHeightPx * 100) / 100;

  const letterSpacing = style.letterSpacing || node.letterSpacing;
  if (letterSpacing && letterSpacing !== 0) result.letterSpacing = letterSpacing;

  // Text color from fills
  const color = extractTextColor(node);
  if (color) result.color = color;

  return Object.keys(result).length > 0 ? result : undefined;
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

function compactFills(fills) {
  if (!fills || !Array.isArray(fills)) return [];
  return fills
    .filter(f => f.visible !== false && f.opacity !== 0)
    .map(fill => {
      if (fill.type === 'SOLID') {
        const opacity = fill.opacity !== undefined ? fill.opacity : 1;
        return {
          type: 'SOLID',
          color: opacity < 1
            ? figmaColorToRgba({ ...fill.color, a: opacity })
            : figmaColorToHex(fill.color),
        };
      }
      if (fill.type === 'IMAGE') {
        return {
          type: 'IMAGE',
          imageRef: fill.imageRef || null,
          scaleMode: fill.scaleMode || 'FILL',
        };
      }
      if (fill.type?.startsWith('GRADIENT_')) {
        const stops = (fill.gradientStops || []).map(s => ({
          position: Math.round(s.position * 100),
          color: figmaColorToRgba(s.color),
        }));
        return { type: fill.type, stops };
      }
      return { type: fill.type };
    });
}

function compactStrokes(node) {
  const strokes = node.strokes;
  if (!strokes || !Array.isArray(strokes) || strokes.length === 0) return null;

  const visible = strokes.filter(s => s.visible !== false);
  if (visible.length === 0) return null;

  const strokeWeight = node.strokeWeight || node.individualStrokeWeights;
  if (!strokeWeight) return null;

  return {
    weight: strokeWeight,
    color: visible[0].color ? figmaColorToHex(visible[0].color) : null,
    align: node.strokeAlign || 'INSIDE',
  };
}

function compactEffects(effects) {
  if (!effects || !Array.isArray(effects)) return [];
  return effects
    .filter(e => e.visible !== false)
    .map(effect => {
      const compact = { type: effect.type };
      if (effect.color) compact.color = figmaColorToRgba(effect.color);
      if (effect.offset) compact.offset = { x: effect.offset.x, y: effect.offset.y };
      if (effect.radius) compact.radius = effect.radius;
      if (effect.spread) compact.spread = effect.spread;
      return compact;
    });
}

function extractCornerRadius(node) {
  if (node.rectangleCornerRadii && Array.isArray(node.rectangleCornerRadii)) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return 0;
    if (tl === tr && tr === br && br === bl) return tl;
    return { tl, tr, br, bl };
  }
  return node.cornerRadius || 0;
}

function extractPaddingCompact(node) {
  const t = node.paddingTop || 0;
  const r = node.paddingRight || 0;
  const b = node.paddingBottom || 0;
  const l = node.paddingLeft || 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  if (t === r && r === b && b === l) return t;
  return { top: t, right: r, bottom: b, left: l };
}

function findImageRef(fills) {
  if (!fills || !Array.isArray(fills)) return null;
  for (const fill of fills) {
    if (fill.visible === false) continue;
    if (fill.type === 'IMAGE' && fill.imageRef) return fill.imageRef;
  }
  return null;
}

// ─── Utilities ───

function countNodes(tree) {
  let count = 0;
  for (const node of tree) {
    count++;
    if (Array.isArray(node.children)) {
      count += countNodes(node.children);
    }
  }
  return count;
}

/**
 * Detect icon nodes in the brief.
 * An icon is an INSTANCE or GROUP node whose children are only VECTORs/GROUPs
 * (no TEXT, no IMAGE fills) — i.e. pure vector graphics.
 *
 * @param {object} pageBrief - The full page brief
 * @returns {Map<string, {nodeId: string, name: string, sectionIndex: number, width: number, height: number}>}
 *   Map keyed by nodeId for deduplication
 */
export function detectIconNodes(pageBrief) {
  const icons = new Map();

  for (const section of pageBrief.sections) {
    collectIconsFromTree(section.nodeTree, section.index, icons);
  }

  return icons;
}

function isVectorOnly(node) {
  if (!node.children || !Array.isArray(node.children)) return false;
  return node.children.every(child => {
    if (child.type === 'VECTOR') return true;
    if (child.type === 'GROUP' || child.type === 'FRAME') return isVectorOnly(child);
    return false;
  });
}

function collectIconsFromTree(nodes, sectionIndex, icons) {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    // An icon candidate: INSTANCE with vector-only children, or a GROUP that is vector-only
    const isIconCandidate =
      (node.type === 'INSTANCE' && node.children && isVectorOnly(node)) ||
      (node.type === 'GROUP' && node.name && isVectorOnly(node) && node.bounds &&
        node.bounds.width <= 120 && node.bounds.height <= 120);

    if (isIconCandidate && node.nodeId) {
      // Skip if already have this icon (same componentId = same icon)
      const key = node.componentId || node.nodeId;
      if (!icons.has(key)) {
        icons.set(key, {
          nodeId: node.nodeId,
          name: node.name,
          sectionIndex,
          width: node.bounds?.width || 70,
          height: node.bounds?.height || 70,
          componentId: node.componentId || null,
        });
      }
    }

    // Recurse into children (but NOT into icon nodes themselves)
    if (!isIconCandidate && Array.isArray(node.children)) {
      collectIconsFromTree(node.children, sectionIndex, icons);
    }
  }
}

/**
 * Update a page brief with SVG icon references.
 * Walks the node tree and adds svgFilename to icon nodes.
 *
 * @param {object} pageBrief - The page brief to update (mutated in place)
 * @param {Map<string, string>} iconFileMap - Map of componentId/nodeId → svg filename
 */
export function enrichBriefWithSvgIcons(pageBrief, iconFileMap) {
  for (const section of pageBrief.sections) {
    enrichTreeWithSvgIcons(section.nodeTree, iconFileMap);
  }
}

function enrichTreeWithSvgIcons(nodes, iconFileMap) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const key = node.componentId || node.nodeId;
    if (key && iconFileMap.has(key)) {
      node.svgFilename = iconFileMap.get(key);
    }
    if (Array.isArray(node.children)) {
      enrichTreeWithSvgIcons(node.children, iconFileMap);
    }
  }
}

/**
 * Collect all unique image hashes from a page brief.
 * Used to build the image download list.
 */
export function collectImageHashes(pageBrief) {
  const hashes = new Set();

  for (const section of pageBrief.sections) {
    // Section background
    if (section.background?.imageHash) {
      hashes.add(section.background.imageHash);
    }
    // Walk node tree
    collectHashesFromTree(section.nodeTree, hashes);
  }

  return hashes;
}

function collectHashesFromTree(nodes, hashes) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node.imageRef) hashes.add(node.imageRef);
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.imageRef) hashes.add(fill.imageRef);
      }
    }
    if (Array.isArray(node.children)) {
      collectHashesFromTree(node.children, hashes);
    }
  }
}
