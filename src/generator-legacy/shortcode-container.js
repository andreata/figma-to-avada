// ─── Avada container (section) renderer ───
// Consecutive single-column (1_1) rows are merged into one container.
// Multi-column rows get their own container.
// Output: single continuous line per container (Avada parser requirement).

import { CONTAINER_DEFAULTS } from './shortcode-defaults.js';
import { renderColumn } from './shortcode-column.js';
import { attrs, sanitizeAttrValue } from './shortcode-generator.js';

const FULL_WIDTH_THRESHOLD = 0.80; // images > 80% of page width are "background-like"

/**
 * Render a section as one or more fusion_builder_container blocks.
 *
 * @param {object} section - Section from layout.json
 * @param {number} pageWidth - Page width in px (for image sizing)
 * @returns {string[]} Array of container shortcode strings
 */
export function renderContainers(section, pageWidth) {
  const containers = [];
  const groups = groupRows(section.rows || []);

  for (const group of groups) {
    if (group.type === 'merged_1_1') {
      const result = renderMergedContainer(section, group.rows, pageWidth);
      if (result) containers.push(result);
    } else {
      const result = renderSingleRowContainer(section, group.row, pageWidth);
      if (result) containers.push(result);
    }
  }

  return containers;
}

/**
 * Group consecutive 1_1 rows together; multi-column rows stay individual.
 */
function groupRows(rows) {
  const groups = [];
  let pending1_1 = [];

  for (const row of rows) {
    const nonEmptyCols = (row.columns || []).filter(col => !isEmptyColumn(col));
    if (nonEmptyCols.length === 0) continue;

    const isSingle1_1 = nonEmptyCols.length === 1 &&
      (nonEmptyCols[0].avadaFraction === '1_1' || nonEmptyCols.length === 1);

    if (isSingle1_1) {
      pending1_1.push(row);
    } else {
      if (pending1_1.length > 0) {
        groups.push({ type: 'merged_1_1', rows: pending1_1 });
        pending1_1 = [];
      }
      groups.push({ type: 'multi_col', row });
    }
  }

  if (pending1_1.length > 0) {
    groups.push({ type: 'merged_1_1', rows: pending1_1 });
  }

  return groups;
}

/**
 * Render multiple 1_1 rows merged into a single container.
 */
function renderMergedContainer(section, rows, pageWidth) {
  const allChildren = [];
  const allInnerRows = [];

  for (const row of rows) {
    const col = (row.columns || []).find(c => !isEmptyColumn(c));
    if (!col) continue;
    allChildren.push(...(col.children || []));
    allInnerRows.push(...(col.innerRows || []));
  }

  // Filter out background-like images (>80% page width in sections with bg)
  const filteredChildren = filterBgImages(allChildren, section, pageWidth);

  const mergedCol = {
    avadaFraction: '1_1',
    children: filteredChildren,
    innerRows: allInnerRows,
    padding: rows[0]?.columns?.[0]?.padding,
  };

  const rendered = renderColumn(mergedCol, 0, 1, false);
  if (!rendered) return null;

  const containerAttrs = buildContainerAttrs(section, rows[0]);
  return (
    `[fusion_builder_container ${attrs(containerAttrs)}]` +
    `[fusion_builder_row]` +
    rendered +
    `[/fusion_builder_row]` +
    `[/fusion_builder_container]`
  );
}

/**
 * Render a single multi-column row as its own container.
 */
function renderSingleRowContainer(section, row, pageWidth) {
  // Filter bg-like images from columns
  const columns = (row.columns || [])
    .map(col => ({
      ...col,
      children: filterBgImages(col.children || [], section, pageWidth),
    }))
    .filter(col => !isEmptyColumn(col));

  if (columns.length === 0) return null;

  const colParts = columns
    .map((col, i) => renderColumn(col, i, columns.length, false))
    .filter(Boolean);

  if (colParts.length === 0) return null;

  const containerAttrs = buildContainerAttrs(section, row);
  return (
    `[fusion_builder_container ${attrs(containerAttrs)}]` +
    `[fusion_builder_row]` +
    colParts.join('') +
    `[/fusion_builder_row]` +
    `[/fusion_builder_container]`
  );
}

/**
 * Filter out images that are basically full-width backgrounds.
 * Only if the section already has a background (image, gradient, or dark color).
 */
function filterBgImages(children, section, pageWidth) {
  const hasBg = section.background &&
    (section.background.type === 'image' || section.background.type === 'gradient-linear');

  if (!hasBg || !pageWidth) return children;

  return children.filter(child => {
    if (child.type !== 'image') return true;
    const w = child.bounds?.width || 0;
    return (w / pageWidth) < FULL_WIDTH_THRESHOLD;
  });
}

/**
 * Build container attributes with computed padding.
 */
function buildContainerAttrs(section, row) {
  const containerAttrs = { ...CONTAINER_DEFAULTS };

  containerAttrs.hundred_percent = 'yes';
  containerAttrs.admin_label = sanitizeAttrValue(section.name || '');

  mapBackground(section.background, containerAttrs);

  // Compute padding from section bounds vs content bounds
  const sectionPad = computeSectionPadding(section);
  if (sectionPad.top > 10) containerAttrs.padding_top = `${sectionPad.top}px`;
  if (sectionPad.bottom > 10) containerAttrs.padding_bottom = `${sectionPad.bottom}px`;

  if (row?.gap && row.gap > 0) {
    containerAttrs.flex_column_spacing = `${Math.round(row.gap)}px`;
  }

  return containerAttrs;
}

/**
 * Compute vertical padding from section bounds vs content element bounds.
 */
function computeSectionPadding(section) {
  const sb = section.bounds;
  if (!sb) return { top: 0, bottom: 0 };

  let minY = Infinity, maxY = -Infinity;

  for (const row of section.rows || []) {
    for (const col of row.columns || []) {
      for (const child of (col.children || [])) {
        const b = child.bounds;
        if (b) {
          minY = Math.min(minY, b.y);
          maxY = Math.max(maxY, b.y + (b.height || 0));
        }
      }
      for (const ir of (col.innerRows || [])) {
        for (const ic of (ir.columns || [])) {
          for (const child of (ic.children || [])) {
            const b = child.bounds;
            if (b) {
              minY = Math.min(minY, b.y);
              maxY = Math.max(maxY, b.y + (b.height || 0));
            }
          }
        }
      }
    }
  }

  if (minY === Infinity) return { top: 40, bottom: 40 }; // default

  return {
    top: Math.max(0, Math.round(minY - sb.y)),
    bottom: Math.max(0, Math.round((sb.y + sb.height) - maxY)),
  };
}

/**
 * Check if a column is empty.
 */
function isEmptyColumn(column) {
  const hasChildren = (column.children || []).length > 0;
  const hasInnerRows = (column.innerRows || []).some(
    ir => (ir.columns || []).some(c => (c.children || []).length > 0)
  );
  return !hasChildren && !hasInnerRows;
}

/**
 * Map layout.json background to Avada container attributes.
 */
function mapBackground(bg, containerAttrs) {
  if (!bg) return;

  switch (bg.type) {
    case 'solid':
      containerAttrs.background_color = bg.color;
      break;

    case 'gradient-linear': {
      containerAttrs.gradient_type = 'linear';
      containerAttrs.linear_angle = String(bg.angle || 180);
      const stops = bg.stops || [];
      if (stops.length >= 1) {
        containerAttrs.gradient_start_color = stops[0].color;
        containerAttrs.gradient_start_position = String(stops[0].position || 0);
      }
      if (stops.length >= 2) {
        containerAttrs.gradient_end_color = stops[1].color;
        containerAttrs.gradient_end_position = String(stops[1].position || 100);
      }
      break;
    }

    case 'image': {
      const hash = bg.imageHash || 'unknown';
      containerAttrs.background_image = `https://placeholder.figma/${hash}`;
      containerAttrs.background_position = 'center center';
      containerAttrs.background_repeat = 'no-repeat';
      containerAttrs.background_size = 'cover';
      break;
    }
  }
}
