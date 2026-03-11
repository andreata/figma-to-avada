// ─── Image Fetcher — Phase 2 ───
// Downloads Figma image fills, renames them with meaningful names,
// and replaces placeholder URLs in shortcode output.

import fetch from 'node-fetch';
import { writeFile, mkdir, access, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { convertToWebp } from './utils/image-converter.js';

/**
 * Build a map of hash → human-readable filename by scanning the layout.
 * Uses section name + context (bg, img, element name) + dedup counter.
 *
 * @param {object} layout - The layout.json structure
 * @returns {Map<string, string>} Map of hash → { filename, hash }
 */
export function buildImageNameMap(layout) {
  const hashToName = new Map(); // hash → chosen name
  const usedNames = new Set();

  function slugify(str) {
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

  for (let si = 0; si < (layout.sections || []).length; si++) {
    const section = layout.sections[si];
    const sectionSlug = slugify(section.name || `sezione-${si + 1}`);

    // Background image
    if (section.background?.type === 'image' && section.background.imageHash) {
      const hash = section.background.imageHash;
      if (!hashToName.has(hash)) {
        hashToName.set(hash, uniqueName(`${sectionSlug}-bg`));
      }
    }

    // Element images
    let imgIndex = 0;
    for (const row of section.rows || []) {
      for (const col of row.columns || []) {
        scanChildren(col.children, section, sectionSlug, hashToName, uniqueName, () => ++imgIndex);
        for (const innerRow of col.innerRows || []) {
          for (const innerCol of innerRow.columns || []) {
            scanChildren(innerCol.children, section, sectionSlug, hashToName, uniqueName, () => ++imgIndex);
          }
        }
      }
    }
  }

  return hashToName;
}

function scanChildren(children, section, sectionSlug, hashToName, uniqueName, nextIndex) {
  for (const child of children || []) {
    if (child.type === 'image' && child.figmaImageHash) {
      const hash = child.figmaImageHash;
      if (!hashToName.has(hash)) {
        hashToName.set(hash, uniqueName(`${sectionSlug}-img`));
      }
    }
  }
}

/**
 * Download all images, save with human-readable names.
 *
 * @param {object} figmaClient - Figma API client
 * @param {string} fileKey - Figma file key
 * @param {Map<string, string>} nameMap - Map of hash → readable name
 * @param {string} outputDir - Directory to save images
 * @returns {Map<string, string>} Map of hash → final filename (with extension)
 */
export async function downloadImages(figmaClient, fileKey, nameMap, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const hashToFile = new Map();
  const toDownload = [];

  // Check cache — look for .webp first, then legacy .png
  for (const [hash, name] of nameMap) {
    const webpFile = `${name}.webp`;
    const pngFile = `${name}.png`;
    try {
      await access(join(outputDir, webpFile));
      hashToFile.set(hash, webpFile);
      console.log(`  [Cache] ${webpFile}`);
    } catch {
      try {
        await access(join(outputDir, pngFile));
        hashToFile.set(hash, pngFile);
        console.log(`  [Cache] ${pngFile} (legacy)`);
      } catch {
        toDownload.push(hash);
      }
    }
  }

  if (toDownload.length === 0) {
    console.log(`[Images] All ${nameMap.size} images already cached`);
    return hashToFile;
  }

  console.log(`[Images] ${hashToFile.size} cached, ${toDownload.length} to download`);

  // Fetch image fill URLs from Figma API
  const fillUrls = await figmaClient.getImageFills(fileKey);

  let downloaded = 0;
  let failed = 0;

  for (const hash of toDownload) {
    const url = fillUrls[hash];
    const name = nameMap.get(hash);
    const filename = `${name}.webp`;

    if (!url) {
      console.log(`  [Skip] ${filename} — no URL from Figma`);
      failed++;
      continue;
    }

    try {
      const pngBuffer = await downloadBuffer(url);
      const { buffer: webpBuffer, quality, resized } = await convertToWebp(pngBuffer);
      const localPath = join(outputDir, filename);
      await writeFile(localPath, webpBuffer);
      hashToFile.set(hash, filename);
      downloaded++;
      const sizeKB = (webpBuffer.length / 1024).toFixed(0);
      const savings = ((1 - webpBuffer.length / pngBuffer.length) * 100).toFixed(0);
      const extra = resized ? ' (resized)' : '';
      console.log(`  [OK] ${filename} (${sizeKB}KB, q${quality}, -${savings}%${extra})`);
    } catch (err) {
      console.log(`  [Fail] ${filename} — ${err.message}`);
      failed++;
    }
  }

  console.log(`[Images] Downloaded: ${downloaded}, Failed: ${failed}, Total: ${hashToFile.size}/${nameMap.size}`);
  return hashToFile;
}

/**
 * Download a URL and return the raw Buffer.
 */
async function downloadBuffer(url) {
  const response = await fetch(url, { timeout: 30000 });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.buffer();
}

/**
 * Download a single file from URL to local path.
 */
async function downloadFile(url, localPath) {
  const buffer = await downloadBuffer(url);
  await writeFile(localPath, buffer);
}

/**
 * Download SVG icons from Figma by exporting node IDs as SVG format.
 *
 * @param {object} figmaClient - Figma API client
 * @param {string} fileKey - Figma file key
 * @param {Map<string, object>} iconNodes - Map of key → {nodeId, name, ...} from detectIconNodes
 * @param {string} outputDir - Directory to save SVGs
 * @returns {Map<string, string>} Map of key (componentId/nodeId) → svg filename
 */
export async function downloadSvgIcons(figmaClient, fileKey, iconNodes, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const iconFileMap = new Map();
  const toDownload = [];
  const usedNames = new Set();

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

  // Check cache and prepare download list
  for (const [key, info] of iconNodes) {
    const svgName = uniqueName(`icon-${slugify(info.name)}`);
    const filename = `${svgName}.svg`;
    const localPath = join(outputDir, filename);

    try {
      await access(localPath);
      iconFileMap.set(key, filename);
      console.log(`  [Cache] ${filename}`);
    } catch {
      toDownload.push({ key, nodeId: info.nodeId, filename, localPath });
    }
  }

  if (toDownload.length === 0) {
    console.log(`[SVG Icons] All ${iconNodes.size} icons already cached`);
    return iconFileMap;
  }

  console.log(`[SVG Icons] ${iconFileMap.size} cached, ${toDownload.length} to download`);

  // Call Figma API to get SVG export URLs (batch all node IDs)
  const nodeIds = toDownload.map(d => d.nodeId);
  const svgUrls = await figmaClient.getImages(fileKey, nodeIds, 'svg', 1);

  let downloaded = 0;
  let failed = 0;

  for (const item of toDownload) {
    const url = svgUrls[item.nodeId];
    if (!url) {
      console.log(`  [Skip] ${item.filename} — no SVG URL from Figma`);
      failed++;
      continue;
    }

    try {
      await downloadFile(url, item.localPath);
      iconFileMap.set(item.key, item.filename);
      downloaded++;
      console.log(`  [OK] ${item.filename}`);
    } catch (err) {
      console.log(`  [Fail] ${item.filename} — ${err.message}`);
      failed++;
    }
  }

  console.log(`[SVG Icons] Downloaded: ${downloaded}, Failed: ${failed}, Total: ${iconFileMap.size}/${iconNodes.size}`);
  return iconFileMap;
}

/**
 * Replace placeholder URLs in shortcode text with final image URLs.
 *
 * @param {string} shortcode - The generated shortcode markup
 * @param {Map<string, string>} hashToFile - Map of hash → filename
 * @param {string} wpBaseUrl - WordPress base URL (e.g. "https://site.com/wp-content/uploads/2026/02/")
 * @returns {string} Shortcode with real image URLs
 */
export function replacePlaceholders(shortcode, hashToFile, wpBaseUrl = '') {
  let result = shortcode;
  for (const [hash, filename] of hashToFile) {
    const placeholder = `https://placeholder.figma/${hash}`;
    const replacement = wpBaseUrl
      ? `${wpBaseUrl.replace(/\/$/, '')}/${filename}`
      : filename;
    result = result.split(placeholder).join(replacement);
  }
  return result;
}
