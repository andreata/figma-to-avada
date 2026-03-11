// ─── Avada Generatore — Figma Fetch + Extract + Images ───
// Single entry point: fetches Figma data, extracts rich page brief, downloads images.
// Output: page brief (per-section JSON) + images + image mapping

import { config } from 'dotenv';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { createFigmaClient } from './figma-client.js';
import { findPage, findFrame, listPages, listFrames, getRawSectionGroups, getPageWidth } from './parser/section-detector.js';
import { extractPageBrief, detectIconNodes, enrichBriefWithSvgIcons } from './brief-extractor.js';
import { downloadImages, downloadSvgIcons } from './image-fetcher.js';
import { parseSiteAndPage, getOutputPaths } from './utils/paths.js';
import { createWpClient } from './wp-client.js';

// Resolve project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Load .env
config({ path: join(PROJECT_ROOT, '.env') });

// ─── Main ───

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  AVADA GENERATORE — Fetch + Brief + Images');
  console.log('═══════════════════════════════════════\n');

  // 1. Read config from .env
  const token = process.env.FIGMA_TOKEN;
  const fileKey = process.env.FIGMA_FILE_KEY;
  const pageName = process.env.FIGMA_PAGE_NAME;
  const frameName = process.env.FIGMA_FRAME_NAME;
  const wpBaseUrl = process.env.WP_BASE_URL || '';

  if (!token) exitWithError('Missing FIGMA_TOKEN in .env');
  if (!fileKey) exitWithError('Missing FIGMA_FILE_KEY in .env');
  if (!pageName) exitWithError('Missing FIGMA_PAGE_NAME in .env');
  if (!frameName) exitWithError('Missing FIGMA_FRAME_NAME in .env');

  // Derive site/page from frame name
  const { site, page: pageSite } = parseSiteAndPage(frameName);
  const paths = getOutputPaths(PROJECT_ROOT, site, pageSite);

  console.log(`Config:`);
  console.log(`  File Key:   ${fileKey}`);
  console.log(`  Page:       ${pageName}`);
  console.log(`  Frame:      ${frameName}`);
  console.log(`  Site slug:  ${site}`);
  console.log(`  Page slug:  ${pageSite}`);
  if (wpBaseUrl) console.log(`  WP URL:     ${wpBaseUrl}`);

  // Create all output directories upfront
  await Promise.all([
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.briefDir, { recursive: true }),
    mkdir(paths.sectionsDir, { recursive: true }),
    mkdir(paths.imagesDir, { recursive: true }),
    mkdir(paths.shortcodeDir, { recursive: true }),
  ]);

  // 2. Fetch Figma file (with local cache to avoid rate limits)
  const cacheDir = paths.cacheDir;
  const cachePath = join(cacheDir, `${fileKey}.json`);

  let fileData;

  if (existsSync(cachePath)) {
    console.log(`\n[Cache] Loading cached Figma file from ${cachePath}`);
    fileData = JSON.parse(await readFile(cachePath, 'utf-8'));
    console.log(`[Cache] Loaded: "${fileData.name}"`);
  } else {
    const client = createFigmaClient(token);
    try {
      fileData = await client.getFile(fileKey);
    } catch (err) {
      exitWithError(`Failed to fetch Figma file: ${err.message}`);
    }
    // Save to cache
    await writeFile(cachePath, JSON.stringify(fileData), 'utf-8');
    console.log(`[Cache] Saved to ${cachePath}`);
  }

  // 3. Find the target page (canvas)
  console.log('\n[Parser] Searching for page...');
  const page = findPage(fileData.document, pageName);

  if (!page) {
    const available = listPages(fileData.document);
    console.error(`\nPage "${pageName}" not found. Available pages:`);
    for (const p of available) {
      console.error(`  - "${p.name}"`);
    }
    process.exit(1);
  }

  console.log(`[Parser] Found page: "${page.name}" (id: ${page.id})`);

  // 4. Find the target frame (website page)
  console.log('[Parser] Searching for frame...');
  const frame = findFrame(page, frameName);

  if (!frame) {
    const available = listFrames(page);
    console.error(`\nFrame "${frameName}" not found. Available frames:`);
    for (const f of available) {
      console.error(`  - "${f.name}" (${f.width}x${f.height})`);
    }
    process.exit(1);
  }

  const pageWidth = getPageWidth(frame);
  console.log(`[Parser] Found frame: "${frame.name}" (${pageWidth}x${frame.absoluteBoundingBox?.height}px)`);

  // 5. Get raw section groups (preserving Figma node references)
  console.log('\n[Parser] Detecting sections...');
  const sectionGroups = getRawSectionGroups(frame);
  console.log(`[Parser] Found ${sectionGroups.length} section(s)`);

  // 6. Build image name map from section groups
  // We need to scan the raw Figma nodes for image fills
  const imageNameMap = buildImageNameMapFromGroups(sectionGroups);
  console.log(`[Images] Found ${imageNameMap.size} unique images`);

  // 7. Download images
  const imagesDir = paths.imagesDir;
  let hashToFile = new Map();

  if (imageNameMap.size > 0 && token && fileKey) {
    const figmaClient = createFigmaClient(token);
    hashToFile = await downloadImages(figmaClient, fileKey, imageNameMap, imagesDir);
  }

  // 8. Extract page brief
  console.log('\n[Brief] Extracting page brief...');
  const pageBrief = extractPageBrief(frame, sectionGroups, imageNameMap, wpBaseUrl);

  // 8b. Detect and download SVG icons
  console.log('\n[SVG Icons] Detecting icon nodes...');
  const iconNodes = detectIconNodes(pageBrief);
  console.log(`[SVG Icons] Found ${iconNodes.size} unique icon(s)`);

  let iconFileMap = new Map();
  if (iconNodes.size > 0 && token && fileKey) {
    try {
      const figmaClientForSvg = createFigmaClient(token);
      iconFileMap = await downloadSvgIcons(figmaClientForSvg, fileKey, iconNodes, imagesDir);

      // Enrich brief with SVG references
      enrichBriefWithSvgIcons(pageBrief, iconFileMap);

      // Add SVG icons to the images mapping
      for (const [key, filename] of iconFileMap) {
        const info = iconNodes.get(key);
        pageBrief.images[`svg:${key}`] = {
          filename,
          wpUrl: wpBaseUrl ? `${wpBaseUrl.replace(/\/$/, '')}/${filename}` : filename,
          type: 'svg-icon',
          name: info?.name || key,
        };
      }
    } catch (err) {
      console.warn(`\n[SVG Icons] Download failed (${err.message}) — continuing without SVG icons.`);
      console.warn(`[SVG Icons] Re-run npm start later to download them.\n`);
    }
  }

  // 9. Write output files
  const briefDir = paths.briefDir;
  const sectionsDir = paths.sectionsDir;

  // Write complete page brief
  const briefPath = join(briefDir, 'page-brief.json');
  await writeFile(briefPath, JSON.stringify(pageBrief, null, 2), 'utf-8');

  // Write individual section briefs
  for (const section of pageBrief.sections) {
    const idx = String(section.index + 1).padStart(2, '0');
    const slug = slugify(section.name);
    const sectionPath = join(sectionsDir, `${idx}-${slug}.json`);
    await writeFile(sectionPath, JSON.stringify(section, null, 2), 'utf-8');
  }

  // Write images mapping
  const imagesMapPath = join(briefDir, 'images.json');
  const imagesMap = {};
  for (const [hash, name] of imageNameMap) {
    const filename = `${name}.webp`;
    const downloaded = hashToFile.has(hash);
    imagesMap[hash] = {
      filename,
      wpUrl: wpBaseUrl ? `${wpBaseUrl.replace(/\/$/, '')}/${filename}` : filename,
      downloaded,
    };
  }
  // 9b. Resolve real WP media IDs (if credentials provided)
  const wpSiteUrl = process.env.WP_SITE_URL;
  const wpUser = process.env.WP_USER;
  const wpAppPassword = process.env.WP_APP_PASSWORD;

  if (wpSiteUrl && wpUser && wpAppPassword) {
    console.log('\n[WP] Resolving media IDs from WordPress...');
    const wpClient = createWpClient(wpSiteUrl, wpUser, wpAppPassword);
    await wpClient.resolveMediaIds(imagesMap);
  } else {
    console.log('\n[WP] Skipping media ID resolution (set WP_SITE_URL, WP_USER, WP_APP_PASSWORD in .env)');
  }

  await writeFile(imagesMapPath, JSON.stringify(imagesMap, null, 2), 'utf-8');

  // 10. Print summary
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║          EXTRACTION SUMMARY          ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Frame:      ${frame.name.slice(0, 24).padEnd(24)} ║`);
  console.log(`║  Width:      ${String(pageWidth + 'px').padEnd(24)} ║`);
  console.log(`║  Sections:   ${String(sectionGroups.length).padEnd(24)} ║`);
  console.log(`║  Images:     ${String(`${hashToFile.size}/${imageNameMap.size} downloaded`).padEnd(24)} ║`);

  let totalNodes = 0;
  for (const section of pageBrief.sections) {
    totalNodes += section.nodeCount;
  }
  console.log(`║  Nodes:      ${String(totalNodes).padEnd(24)} ║`);
  console.log('╚══════════════════════════════════════╝');

  console.log('\nSections:');
  for (const section of pageBrief.sections) {
    const idx = String(section.index + 1).padStart(2, '0');
    const bg = section.background ? ` [bg: ${section.background.type}]` : '';
    console.log(`  ${idx}. "${section.name}" — ${section.nodeCount} nodes${bg}`);
  }

  console.log(`\nOutput (${site}/${pageSite}):`);
  console.log(`  Brief:     ${briefDir}/`);
  console.log(`  Sections:  ${sectionsDir}/`);
  console.log(`  Images:    ${imagesDir}/`);
  console.log(`  Shortcode: ${paths.shortcodeDir}/`);

  const briefSize = JSON.stringify(pageBrief).length;
  console.log(`  Brief size: ${(briefSize / 1024).toFixed(1)} KB`);

  console.log('\nDone. Ask Claude to generate shortcodes from the brief.\n');
}

// ─── Helpers ───

/**
 * Build image name map by scanning raw Figma nodes in section groups.
 * Extracts all IMAGE fills from all nodes recursively.
 */
function buildImageNameMapFromGroups(sectionGroups) {
  const hashToName = new Map();
  const usedNames = new Set();

  function slugifyName(str) {
    return str
      .toLowerCase()
      .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u').replace(/[ñ]/g, 'n')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  function uniqueName(base) {
    let name = base;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${base}-${i}`;
      i++;
    }
    usedNames.add(name);
    return name;
  }

  for (let si = 0; si < sectionGroups.length; si++) {
    const group = sectionGroups[si];
    const sectionSlug = slugifyName(group.name || `sezione-${si + 1}`);

    // Background image from container
    if (group.background?.type === 'image' && group.background.imageHash) {
      const hash = group.background.imageHash;
      if (!hashToName.has(hash)) {
        hashToName.set(hash, uniqueName(`${sectionSlug}-bg`));
      }
    }

    // Walk all member nodes for image fills
    for (const node of group.memberNodes) {
      walkForImages(node, sectionSlug, hashToName, uniqueName);
    }
  }

  return hashToName;
}

function walkForImages(node, sectionSlug, hashToName, uniqueName) {
  if (!node) return;

  // Check node fills
  const fills = node.fills;
  if (fills && Array.isArray(fills)) {
    for (const fill of fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'IMAGE' && fill.imageRef) {
        if (!hashToName.has(fill.imageRef)) {
          hashToName.set(fill.imageRef, uniqueName(`${sectionSlug}-img`));
        }
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      walkForImages(child, sectionSlug, hashToName, uniqueName);
    }
  }
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

function exitWithError(message) {
  console.error(`\n[Error] ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n[Fatal Error]', err);
  process.exit(1);
});
