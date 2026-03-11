// ─── Normalizer: assembles the final layout.json and validates it ───

import { FRACTION_VALUES } from './parser/fraction-snapper.js';

/**
 * Build the final layout.json structure from parsed sections.
 *
 * @param {object} options
 * @param {string} options.fileKey - Figma file key
 * @param {string} options.pageName - Name of the Figma page (canvas)
 * @param {string} options.frameName - Name of the target frame
 * @param {number} options.pageWidth - Width of the page frame
 * @param {object[]} options.sections - Array of detected sections
 * @returns {object} The layout.json structure
 */
export function buildLayoutJson({ fileKey, pageName, frameName, pageWidth, sections }) {
  // Clean sections: remove internal figmaNode references (not serializable)
  const cleanSections = sections.map(cleanSection);

  const layout = {
    meta: {
      figmaFileKey: fileKey,
      pageName,
      frameName,
      pageWidth,
      extractedAt: new Date().toISOString(),
    },
    sections: cleanSections,
  };

  return layout;
}

/**
 * Validate the layout structure and return errors/warnings.
 */
export function validateLayout(layout) {
  const errors = [];
  const warnings = [];

  if (!layout.sections || layout.sections.length === 0) {
    warnings.push({ type: 'NO_SECTIONS', message: 'No sections detected in the page' });
    return { valid: true, errors, warnings };
  }

  for (let si = 0; si < layout.sections.length; si++) {
    const section = layout.sections[si];
    validateSection(section, si, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateSection(section, sectionIndex, errors, warnings) {
  const label = `Section[${sectionIndex}] "${section.name}"`;

  if (!section.rows || section.rows.length === 0) {
    warnings.push({
      type: 'EMPTY_SECTION',
      message: `${label}: no rows detected`,
    });
    return;
  }

  for (let ri = 0; ri < section.rows.length; ri++) {
    validateRow(section.rows[ri], `${label} → Row[${ri}]`, 'outer', errors, warnings);
  }
}

function validateRow(row, label, level, errors, warnings) {
  if (!row.columns || row.columns.length === 0) {
    errors.push({
      type: 'EMPTY_ROW',
      level,
      message: `${label}: row has no columns`,
    });
    return;
  }

  // Check fraction sum
  const fractions = row.columns.map((c) => c.avadaFraction);
  const fractionSum = fractions.reduce((sum, key) => sum + (FRACTION_VALUES[key] || 0), 0);

  if (Math.abs(fractionSum - 1.0) > 0.02) {
    warnings.push({
      type: 'FRACTION_SUM_MISMATCH',
      level,
      message: `${label}: fractions [${fractions.join(', ')}] sum to ${fractionSum.toFixed(4)}, expected ~1.0`,
    });
  }

  // Check max columns
  if (row.columns.length > 6) {
    warnings.push({
      type: 'TOO_MANY_COLUMNS',
      level,
      message: `${label}: has ${row.columns.length} columns (Avada supports max 6)`,
    });
  }

  // Recurse into inner rows
  for (let ci = 0; ci < row.columns.length; ci++) {
    const col = row.columns[ci];
    const colLabel = `${label} → Col[${ci}] "${col.name}"`;

    if (col.innerRows) {
      for (let iri = 0; iri < col.innerRows.length; iri++) {
        validateRow(
          col.innerRows[iri],
          `${colLabel} → InnerRow[${iri}]`,
          'inner',
          errors,
          warnings
        );

        // Check that inner rows don't have their own inner rows (max 1 level)
        const innerRow = col.innerRows[iri];
        if (innerRow.columns) {
          for (const innerCol of innerRow.columns) {
            if (innerCol.innerRows && innerCol.innerRows.length > 0) {
              errors.push({
                type: 'NESTING_TOO_DEEP',
                message: `${colLabel}: inner row contains nested inner rows (Avada supports only 1 level)`,
              });
            }
          }
        }
      }
    }
  }
}

// ─── Cleaning: remove non-serializable properties ───

function cleanSection(section) {
  return {
    id: section.id,
    name: section.name,
    type: section.type,
    bounds: section.bounds,
    isFullWidth: section.isFullWidth,
    background: section.background,
    borderRadius: section.borderRadius,
    padding: section.padding,
    isDynamic: section.isDynamic,
    dynamicHint: section.dynamicHint,
    rows: (section.rows || []).map(cleanRow),
  };
}

function cleanRow(row) {
  return {
    type: row.type,
    gap: row.gap,
    flex: row.flex || null,
    columns: (row.columns || []).map(cleanColumn),
  };
}

function cleanColumn(col) {
  return {
    id: col.id,
    name: col.name,
    type: col.type,
    avadaFraction: col.avadaFraction,
    rawWidthPercent: col.rawWidthPercent,
    bounds: col.bounds,
    padding: col.padding,
    children: (col.children || []).map(cleanElement),
    innerRows: (col.innerRows || []).map(cleanInnerRow),
  };
}

function cleanInnerRow(row) {
  return {
    type: row.type,
    gap: row.gap,
    columns: (row.columns || []).map(cleanInnerColumn),
  };
}

function cleanInnerColumn(col) {
  return {
    id: col.id,
    name: col.name,
    type: col.type || 'column_inner',
    avadaFraction: col.avadaFraction,
    rawWidthPercent: col.rawWidthPercent || (col.rawFraction ? Math.round(col.rawFraction * 10000) / 100 : null),
    bounds: col.bounds,
    padding: col.padding,
    children: (col.children || []).map(cleanElement),
    innerRows: (col.innerRows || []).map(cleanInnerRow),
  };
}

function cleanElement(el) {
  if (!el) return null;

  // Remove figmaNode reference
  const { figmaNode, ...rest } = el;

  // Recursively clean children if present
  if (rest.children) {
    rest.children = rest.children.map(cleanElement).filter(Boolean);
  }

  return rest;
}

/**
 * Print a summary of the layout to console.
 */
export function printLayoutSummary(layout, validation) {
  const s = layout.sections.length;
  let totalRows = 0;
  let totalCols = 0;
  let totalElements = 0;

  for (const section of layout.sections) {
    for (const row of section.rows || []) {
      totalRows++;
      for (const col of row.columns || []) {
        totalCols++;
        totalElements += (col.children || []).length;

        for (const innerRow of col.innerRows || []) {
          totalRows++;
          for (const innerCol of innerRow.columns || []) {
            totalCols++;
            totalElements += (innerCol.children || []).length;
          }
        }
      }
    }
  }

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║        LAYOUT ANALYSIS SUMMARY       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Page:     ${layout.meta.frameName.padEnd(24)} ║`);
  console.log(`║  Width:    ${String(layout.meta.pageWidth + 'px').padEnd(24)} ║`);
  console.log(`║  Sections: ${String(s).padEnd(24)} ║`);
  console.log(`║  Rows:     ${String(totalRows).padEnd(24)} ║`);
  console.log(`║  Columns:  ${String(totalCols).padEnd(24)} ║`);
  console.log(`║  Elements: ${String(totalElements).padEnd(24)} ║`);
  console.log('╠══════════════════════════════════════╣');

  if (validation.errors.length > 0) {
    console.log(`║  Errors:   ${String(validation.errors.length).padEnd(24)} ║`);
    for (const err of validation.errors) {
      console.log(`║  ✗ ${err.message.slice(0, 34).padEnd(34)}║`);
    }
  }

  if (validation.warnings.length > 0) {
    console.log(`║  Warnings: ${String(validation.warnings.length).padEnd(24)} ║`);
    for (const warn of validation.warnings) {
      console.log(`║  ! ${warn.message.slice(0, 34).padEnd(34)}║`);
    }
  }

  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    console.log('║  Status:   All valid                ║');
  }

  console.log('╚══════════════════════════════════════╝');

  // Print section details
  console.log('\nSections:');
  for (let i = 0; i < layout.sections.length; i++) {
    const sec = layout.sections[i];
    const rowCount = (sec.rows || []).length;
    const dynamic = sec.isDynamic ? ` [DYNAMIC: ${sec.dynamicHint}]` : '';
    console.log(`  ${i + 1}. "${sec.name}" — ${rowCount} row(s)${dynamic}`);

    for (const row of sec.rows || []) {
      const fracs = (row.columns || []).map((c) => c.avadaFraction).join(' + ');
      console.log(`     └─ [${fracs}]`);
    }
  }

  console.log('');
}
