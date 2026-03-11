// ─── Avada column and inner-row renderers ───
// Output is single-line per column (no indentation) for Avada parser compatibility.

import { COLUMN_DEFAULTS, COLUMN_INNER_DEFAULTS } from './shortcode-defaults.js';
import { renderElement } from './shortcode-elements.js';
import { attrs, formatPadding } from './shortcode-generator.js';

/**
 * Render a column (outer or inner) as Avada shortcode.
 * Returns a single continuous string with no unnecessary whitespace.
 */
export function renderColumn(column, index, totalInRow, isInner) {
  const tag = isInner ? 'fusion_builder_column_inner' : 'fusion_builder_column';
  const defaults = isInner ? COLUMN_INNER_DEFAULTS : COLUMN_DEFAULTS;
  const fraction = column.avadaFraction || '1_1';

  const colAttrs = {
    ...defaults,
    type: fraction,
    layout: fraction,
    first: index === 0 ? 'true' : 'false',
    last: index === totalInRow - 1 ? 'true' : 'false',
    type_small: '1_1',
  };

  const padAttrs = formatPadding(column.padding);
  Object.assign(colAttrs, padAttrs);

  // Collect content parts
  const parts = [];

  // Sort children by Y position (top to bottom) for correct visual order
  const children = [...(column.children || [])].sort((a, b) => {
    const ay = a.bounds?.y ?? a.y ?? 0;
    const by = b.bounds?.y ?? b.y ?? 0;
    return ay - by;
  });

  for (const child of children) {
    const rendered = renderElement(child);
    if (rendered) parts.push(rendered);
  }

  // Render inner rows
  const innerRows = column.innerRows || [];
  for (const innerRow of innerRows) {
    const rendered = renderInnerRow(innerRow);
    if (rendered) parts.push(rendered);
  }

  // Skip column if nothing rendered (all children were shapes/icons/etc.)
  if (parts.length === 0) return null;

  const content = parts.join('');
  return `[${tag} ${attrs(colAttrs)}]${content}[/${tag}]`;
}

/**
 * Render an inner row (fusion_builder_row_inner) with its inner columns.
 */
function renderInnerRow(innerRow) {
  const columns = innerRow.columns || [];
  if (columns.length === 0) return null;

  const colParts = columns
    .map((col, i) => renderColumn(col, i, columns.length, true))
    .filter(Boolean);

  // Skip inner row if all columns were empty
  if (colParts.length === 0) return null;

  return `[fusion_builder_row_inner]${colParts.join('')}[/fusion_builder_row_inner]`;
}
