// ─── Extract spacing (padding, margin, gap) from Figma nodes ───

import { figmaColorToHex, figmaColorToRgba } from '../utils/geometry.js';

/**
 * Extract padding from a Figma auto-layout frame.
 * Returns { top, right, bottom, left } in px, all 0 if not auto-layout.
 */
export function extractPadding(node) {
  return {
    top: node.paddingTop || 0,
    right: node.paddingRight || 0,
    bottom: node.paddingBottom || 0,
    left: node.paddingLeft || 0,
  };
}

/**
 * Extract the item spacing (gap between children) from an auto-layout frame.
 * Returns 0 for non-auto-layout frames.
 */
export function extractItemSpacing(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE') return 0;
  return node.itemSpacing || 0;
}

/**
 * Extract the counter-axis spacing (for wrapping auto-layout).
 */
export function extractCounterAxisSpacing(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE') return 0;
  return node.counterAxisSpacing || 0;
}

/**
 * Extract background information from a Figma node's fills array.
 * Returns the first visible, non-transparent fill.
 */
export function extractBackground(node) {
  const fills = node.fills;
  if (!fills || !Array.isArray(fills)) return null;

  // Find first visible fill
  for (const fill of fills) {
    if (fill.visible === false) continue;
    if (fill.opacity === 0) continue;

    if (fill.type === 'SOLID') {
      const color = fill.color;
      const opacity = fill.opacity !== undefined ? fill.opacity : 1;
      if (opacity < 0.01) continue;

      return {
        type: 'solid',
        color: opacity < 1
          ? figmaColorToRgba({ ...color, a: opacity })
          : figmaColorToHex(color),
      };
    }

    if (fill.type === 'GRADIENT_LINEAR') {
      return {
        type: 'gradient-linear',
        angle: computeGradientAngle(fill.gradientHandlePositions),
        stops: (fill.gradientStops || []).map((stop) => ({
          position: Math.round(stop.position * 100),
          color: figmaColorToRgba(stop.color),
        })),
      };
    }

    if (fill.type === 'GRADIENT_RADIAL') {
      return {
        type: 'gradient-radial',
        stops: (fill.gradientStops || []).map((stop) => ({
          position: Math.round(stop.position * 100),
          color: figmaColorToRgba(stop.color),
        })),
      };
    }

    if (fill.type === 'IMAGE') {
      return {
        type: 'image',
        imageHash: fill.imageRef || null,
        scaleMode: fill.scaleMode || 'FILL',
      };
    }
  }

  return null;
}

/**
 * Extract border radius from a Figma node.
 * Returns a single number if uniform, or { tl, tr, br, bl } if mixed.
 */
export function extractBorderRadius(node) {
  // Check for individual corner radii
  if (node.rectangleCornerRadii && Array.isArray(node.rectangleCornerRadii)) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl === tr && tr === br && br === bl) return tl;
    return { tl, tr, br, bl };
  }

  return node.cornerRadius || 0;
}

/**
 * Extract flex alignment properties from a Figma auto-layout frame.
 */
export function extractFlexProps(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE') return null;

  return {
    direction: node.layoutMode, // HORIZONTAL | VERTICAL
    primaryAxisAlign: node.primaryAxisAlignItems || 'MIN',
    counterAxisAlign: node.counterAxisAlignItems || 'MIN',
    wrap: node.layoutWrap === 'WRAP',
  };
}

/**
 * Compute gradient angle from Figma handle positions.
 * Returns angle in degrees (CSS convention: 180 = top-to-bottom).
 */
function computeGradientAngle(handles) {
  if (!handles || handles.length < 2) return 180;

  const start = handles[0];
  const end = handles[1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Convert to CSS angle (0 = bottom-to-top, 90 = left-to-right)
  const radians = Math.atan2(dx, -dy);
  let degrees = (radians * 180) / Math.PI;
  degrees = ((degrees % 360) + 360) % 360;

  return Math.round(degrees);
}
