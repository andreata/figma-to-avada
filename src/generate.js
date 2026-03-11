// ─── Phase 3: layout.json → Avada Shortcode Markup (with images) ───
//
// Usage:
//   npm run generate
//   npm run generate -- --wp-url https://example.com/wp-content/uploads/2026/02/

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

import { generateShortcode } from './generator/shortcode-generator.js';
import { createFigmaClient } from './figma-client.js';
import { buildImageNameMap, downloadImages, replacePlaceholders } from './image-fetcher.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// WP_BASE_URL from .env, overridable with --wp-url CLI arg
function getWpUrl() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wp-url' && args[i + 1]) return args[i + 1];
  }
  return process.env.WP_BASE_URL || '';
}

async function main() {
  const wpUrl = getWpUrl();

  console.log('═══════════════════════════════════════');
  console.log('  AVADA GENERATORE — Phase 3: Shortcode');
  console.log('═══════════════════════════════════════\n');

  // Read layout.json
  const inputPath = join(PROJECT_ROOT, 'output', 'json', 'layout.json');
  let layout;
  try {
    layout = JSON.parse(await readFile(inputPath, 'utf-8'));
  } catch (err) {
    console.error(`[Error] Cannot read ${inputPath}: ${err.message}`);
    console.error('Run "npm start" first to generate layout.json.');
    process.exit(1);
  }

  console.log(`[Input] Layout: "${layout.meta.frameName}"`);
  console.log(`[Input] Page width: ${layout.meta.pageWidth}px`);
  console.log(`[Input] Sections: ${layout.sections.length}`);
  if (wpUrl) console.log(`[Input] WP base URL: ${wpUrl}`);

  // ─── Phase 2: Download images with meaningful names ───
  const nameMap = buildImageNameMap(layout);
  console.log(`\n[Images] Found ${nameMap.size} unique images in layout`);

  const imagesDir = join(PROJECT_ROOT, 'output', 'images');
  let hashToFile = new Map();

  if (nameMap.size > 0) {
    const token = process.env.FIGMA_TOKEN;
    const fileKey = process.env.FIGMA_FILE_KEY;

    if (!token || !fileKey) {
      console.log('[Images] FIGMA_TOKEN or FIGMA_FILE_KEY missing — skipping download');
    } else {
      const figmaClient = createFigmaClient(token);
      hashToFile = await downloadImages(figmaClient, fileKey, nameMap, imagesDir);
    }
  }

  // ─── Phase 3: Generate shortcode ───
  let shortcode = generateShortcode(layout);

  // Replace placeholders with real filenames/URLs
  if (hashToFile.size > 0) {
    shortcode = replacePlaceholders(shortcode, hashToFile, wpUrl);
  }

  // Count stats
  const containerCount = (shortcode.match(/\[fusion_builder_container/g) || []).length;
  const columnCount = (shortcode.match(/\[fusion_builder_column /g) || []).length;
  const elementCount = (shortcode.match(/\[fusion_(title|text|imageframe|button|separator)/g) || []).length;
  const remainingPlaceholders = (shortcode.match(/placeholder\.figma/g) || []).length;

  console.log(`\n[Generate] Containers: ${containerCount}`);
  console.log(`[Generate] Columns: ${columnCount}`);
  console.log(`[Generate] Elements: ${elementCount}`);
  console.log(`[Generate] Images resolved: ${hashToFile.size}/${nameMap.size}`);
  if (remainingPlaceholders > 0) {
    console.log(`[Generate] ⚠ Unresolved placeholders: ${remainingPlaceholders}`);
  }

  // Write output
  const outputDir = join(PROJECT_ROOT, 'output', 'shortcode');
  await mkdir(outputDir, { recursive: true });

  const outputPath = join(outputDir, 'page.txt');
  await writeFile(outputPath, shortcode, 'utf-8');

  console.log(`\n[Output] ${outputPath}`);
  console.log(`[Output] Size: ${(shortcode.length / 1024).toFixed(1)} KB`);

  if (hashToFile.size > 0) {
    console.log(`[Output] Images: ${imagesDir}/`);
    // Print image name mapping for reference
    console.log(`\n[Image mapping]`);
    for (const [hash, filename] of hashToFile) {
      console.log(`  ${filename}`);
    }
  }

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\n[Fatal Error]', err);
  process.exit(1);
});
