// ─── WordPress REST API Client ───
// Queries WP media library to resolve real attachment IDs for uploaded images.

import fetch from 'node-fetch';

/**
 * Create a WordPress REST API client.
 * @param {string} siteUrl - WordPress site URL (e.g. "https://example.com")
 * @param {string} user - WordPress username
 * @param {string} appPassword - WordPress Application Password
 */
export function createWpClient(siteUrl, user, appPassword) {
  const baseUrl = siteUrl.replace(/\/+$/, '');
  const apiBase = `${baseUrl}/wp-json/wp/v2`;
  const auth = 'Basic ' + Buffer.from(`${user}:${appPassword}`).toString('base64');

  async function apiGet(endpoint, params = {}) {
    const url = new URL(`${apiBase}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: auth },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WP API ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json();
  }

  /**
   * Search media library for a file by filename.
   * Returns the media object if found, null otherwise.
   */
  async function findMediaByFilename(filename) {
    // Strip extension for search (WP search is fuzzy)
    const searchTerm = filename.replace(/\.[^.]+$/, '');

    const results = await apiGet('/media', {
      search: searchTerm,
      per_page: '20',
      media_type: 'image',
    });

    if (!results || results.length === 0) return null;

    // Find exact match by source_url containing the filename
    // WP may add -scaled, so check both with and without
    const baseFilename = filename.replace('-scaled', '');
    const match = results.find(m => {
      const srcUrl = m.source_url || '';
      return srcUrl.includes(filename) || srcUrl.includes(baseFilename);
    });

    return match || null;
  }

  /**
   * Resolve real WP media IDs for all images in the images map.
   * @param {Object} imagesMap - Current images.json content (hash → {filename, wpUrl, ...})
   * @returns {Object} Updated images map with wpMediaId added where found
   */
  async function resolveMediaIds(imagesMap) {
    const entries = Object.entries(imagesMap);
    console.log(`[WP] Resolving media IDs for ${entries.length} image(s)...`);

    let found = 0;
    let notFound = 0;

    for (const [hash, info] of entries) {
      if (!info.filename) continue;

      // Check with -scaled suffix (WP adds it for large images)
      const scaledFilename = info.filename.replace(/\.(\w+)$/, '-scaled.$1');

      try {
        let media = await findMediaByFilename(info.filename);
        if (!media) {
          media = await findMediaByFilename(scaledFilename);
        }

        if (media) {
          info.wpMediaId = media.id;
          info.wpUrl = media.source_url;
          found++;
          console.log(`  ✓ ${info.filename} → ID ${media.id}`);
        } else {
          notFound++;
          console.log(`  ✗ ${info.filename} — not found in media library`);
        }
      } catch (err) {
        console.warn(`  ! ${info.filename} — error: ${err.message}`);
      }
    }

    console.log(`[WP] Resolved: ${found} found, ${notFound} not found`);
    return imagesMap;
  }

  return { findMediaByFilename, resolveMediaIds };
}
