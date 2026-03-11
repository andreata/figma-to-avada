// ─── Avada Shortcode Generator — Orchestrator ───
// Transforms layout.json into Avada Fusion Builder shortcode markup.
// Output is Avada-parser-compatible: no HTML comments, no whitespace between structural tags.

import { renderContainers } from './shortcode-container.js';

/**
 * Generate complete Avada shortcode markup from a layout object.
 *
 * @param {object} layout - The layout.json structure { meta, sections }
 * @returns {string} Complete shortcode markup
 */
export function generateShortcode(layout) {
  const sections = layout.sections || [];
  const pageWidth = layout.meta?.pageWidth || 1512;
  const parts = [];

  for (const section of sections) {
    // Skip sections with no rows or only empty rows
    const nonEmptyRows = (section.rows || []).filter(
      (row) => row.columns && row.columns.length > 0
    );
    if (nonEmptyRows.length === 0) continue;

    const filteredSection = { ...section, rows: nonEmptyRows };
    parts.push(...renderContainers(filteredSection, pageWidth));
  }

  // Each container on its own line (Avada handles this fine)
  return parts.join('\n');
}

// ─── Shared utilities (exported for use by other generator modules) ───

/**
 * Build an attribute string from a key-value object.
 * Filters out null/undefined/empty values.
 * Escapes double quotes in values.
 */
export function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

/**
 * Format corner radius for Avada attributes.
 * Handles both number and {tl, tr, br, bl} formats.
 */
export function formatCornerRadius(cornerRadius) {
  if (!cornerRadius) return null;

  if (typeof cornerRadius === 'number') {
    return cornerRadius > 0 ? `${cornerRadius}px` : null;
  }

  if (typeof cornerRadius === 'object') {
    const { tl = 0, tr = 0, br = 0, bl = 0 } = cornerRadius;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
    if (tl === tr && tr === br && br === bl) return `${tl}px`;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }

  return null;
}

/**
 * Format padding object into Avada attribute key-values.
 * Only includes non-zero values.
 */
export function formatPadding(padding) {
  if (!padding) return {};
  const result = {};
  if (padding.top > 0) result.padding_top = `${Math.round(padding.top)}px`;
  if (padding.right > 0) result.padding_right = `${Math.round(padding.right)}px`;
  if (padding.bottom > 0) result.padding_bottom = `${Math.round(padding.bottom)}px`;
  if (padding.left > 0) result.padding_left = `${Math.round(padding.left)}px`;
  return result;
}

/**
 * Sanitize a string for use as a shortcode attribute value.
 * Removes characters that break Avada's parser.
 */
export function sanitizeAttrValue(value) {
  return value
    .replace(/"/g, "'")        // double quotes → single quotes
    .replace(/[\u201C\u201D]/g, "'")  // smart quotes → single quotes
    .replace(/[\u2018\u2019]/g, "'")  // smart single quotes
    .replace(/[\n\r]/g, ' ')   // newlines → spaces
    .trim();
}
