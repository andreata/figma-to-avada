// ─── Figma REST API client with retry and rate limiting ───
// Uses node-fetch for Node 14 compatibility.

import fetch from 'node-fetch';

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Create a Figma API client.
 *
 * @param {string} token - Figma personal access token
 * @returns {object} Client with methods for Figma API
 */
export function createFigmaClient(token) {
  if (!token) {
    throw new Error('FIGMA_TOKEN is required');
  }

  const headers = {
    'X-Figma-Token': token,
  };

  /**
   * Fetch with retry, backoff, and rate limit handling.
   */
  async function fetchWithRetry(url, attempt = 1) {
    try {
      console.log(`  [Figma API] GET ${url.replace(FIGMA_API_BASE, '')} (attempt ${attempt})`);

      const response = await fetch(url, {
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      });

      // Rate limiting: fail fast if wait is too long
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '30', 10);
        if (retryAfter > 120) {
          const hours = Math.round(retryAfter / 3600);
          throw new Error(
            `Figma API rate limited for ~${hours}h.\n` +
            `  Soluzioni:\n` +
            `  1. Duplica il file in Figma (File → Duplicate) e aggiorna FIGMA_FILE_KEY nel .env\n` +
            `  2. Scarica il JSON manualmente e salvalo in output/cache/{fileKey}.json\n` +
            `     curl -H "X-Figma-Token: YOUR_TOKEN" "https://api.figma.com/v1/files/{fileKey}?geometry=paths" > output/cache/{fileKey}.json`
          );
        }
        console.log(`  [Figma API] Rate limited. Waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        return fetchWithRetry(url, attempt);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Figma API error ${response.status}: ${body.slice(0, 200)}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`  [Figma API] Error: ${error.message}. Retrying in ${backoff}ms...`);
        await sleep(backoff);
        return fetchWithRetry(url, attempt + 1);
      }

      throw error;
    }
  }

  return {
    /**
     * Fetch the full Figma file.
     *
     * @param {string} fileKey - Figma file key
     * @returns {object} The full file JSON
     */
    async getFile(fileKey) {
      console.log(`\n[Figma] Fetching file: ${fileKey}`);
      const url = `${FIGMA_API_BASE}/files/${fileKey}?geometry=paths`;
      const data = await fetchWithRetry(url);
      console.log(`[Figma] File fetched: "${data.name}" (version: ${data.version})`);
      return data;
    },

    /**
     * Fetch specific nodes from a file.
     *
     * @param {string} fileKey - Figma file key
     * @param {string[]} nodeIds - Array of node IDs
     * @returns {object} The nodes data
     */
    async getNodes(fileKey, nodeIds) {
      const ids = nodeIds.join(',');
      const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}&geometry=paths`;
      return fetchWithRetry(url);
    },

    /**
     * Fetch image exports for given node IDs.
     *
     * @param {string} fileKey - Figma file key
     * @param {string[]} nodeIds - Array of node IDs to export
     * @param {string} format - Image format (png, jpg, svg, pdf)
     * @param {number} scale - Scale factor
     * @returns {object} Map of nodeId → image URL
     */
    async getImages(fileKey, nodeIds, format = 'png', scale = 2) {
      const ids = nodeIds.join(',');
      const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`;
      const data = await fetchWithRetry(url);
      return data.images || {};
    },

    /**
     * Fetch image fill URLs for a file.
     * Returns a map of imageHash → temporary S3 download URL.
     *
     * @param {string} fileKey - Figma file key
     * @returns {object} Map of hash → URL
     */
    async getImageFills(fileKey) {
      console.log(`\n[Figma] Fetching image fills for: ${fileKey}`);
      const url = `${FIGMA_API_BASE}/files/${fileKey}/images`;
      const data = await fetchWithRetry(url);
      const images = data.meta?.images || {};
      console.log(`[Figma] Found ${Object.keys(images).length} image fills`);
      return images;
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
