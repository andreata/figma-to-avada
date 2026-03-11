// ─── Sync WordPress Media IDs ───
// Standalone script: reads existing images.json, queries WP for real IDs, updates the file.
// Usage: npm run sync-ids

import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { createWpClient } from './wp-client.js';
import { parseSiteAndPage, getOutputPaths } from './utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

config({ path: join(PROJECT_ROOT, '.env') });

async function main() {
  const wpSiteUrl = process.env.WP_SITE_URL;
  const wpUser = process.env.WP_USER;
  const wpAppPassword = process.env.WP_APP_PASSWORD;
  const frameName = process.env.FIGMA_FRAME_NAME;

  if (!wpSiteUrl || !wpUser || !wpAppPassword) {
    console.error('Missing WP credentials in .env (WP_SITE_URL, WP_USER, WP_APP_PASSWORD)');
    process.exit(1);
  }
  if (!frameName) {
    console.error('Missing FIGMA_FRAME_NAME in .env');
    process.exit(1);
  }

  const { site, page } = parseSiteAndPage(frameName);
  const paths = getOutputPaths(PROJECT_ROOT, site, page);
  const imagesPath = join(paths.briefDir, 'images.json');

  if (!existsSync(imagesPath)) {
    console.error(`images.json not found at ${imagesPath}. Run npm start first.`);
    process.exit(1);
  }

  console.log(`Syncing WP media IDs for ${site}/${page}...\n`);

  const imagesMap = JSON.parse(await readFile(imagesPath, 'utf-8'));
  const wpClient = createWpClient(wpSiteUrl, wpUser, wpAppPassword);
  await wpClient.resolveMediaIds(imagesMap);

  await writeFile(imagesPath, JSON.stringify(imagesMap, null, 2), 'utf-8');
  console.log(`\nUpdated: ${imagesPath}`);
}

main().catch(err => {
  console.error('[Error]', err.message);
  process.exit(1);
});
