// ─── Path utilities for organized output ───
// Derives site/page slugs from FIGMA_FRAME_NAME and builds output directory paths.

import { join } from 'node:path';

/**
 * Parse FIGMA_FRAME_NAME into site and page slugs.
 * Pattern: "SITENAME - Page Description" → { site: "sitename", page: "page-description" }
 * If no " - " separator, entire name becomes site, page defaults to "index".
 *
 * @param {string} frameName - e.g. "DIMSPORT - Home Black"
 * @returns {{ site: string, page: string }}
 */
export function parseSiteAndPage(frameName) {
  const parts = frameName.split(' - ');
  const site = slugify(parts[0]);
  const page = parts.length > 1 ? slugify(parts.slice(1).join('-')) : 'index';
  return { site, page };
}

/**
 * Build all output directory paths for a given site/page.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} site - Site slug
 * @param {string} page - Page slug
 * @returns {{ pageRoot: string, briefDir: string, sectionsDir: string, imagesDir: string, shortcodeDir: string, cacheDir: string }}
 */
export function getOutputPaths(projectRoot, site, page) {
  const pageRoot = join(projectRoot, 'output', site, page);
  return {
    pageRoot,
    briefDir: join(pageRoot, 'brief'),
    sectionsDir: join(pageRoot, 'brief', 'sections'),
    imagesDir: join(pageRoot, 'images'),
    shortcodeDir: join(pageRoot, 'shortcode'),
    cacheDir: join(projectRoot, 'output', 'cache'),
  };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
