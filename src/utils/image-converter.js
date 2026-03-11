// ─── Image converter: PNG → WebP with size target ───
// Uses sharp for fast, high-quality WebP conversion with adaptive quality.

import sharp from 'sharp';

const MAX_SIZE_BYTES = 150 * 1024; // 150KB
const INITIAL_QUALITY = 80;
const MIN_QUALITY = 20;
const QUALITY_STEP = 10;

/**
 * Convert a PNG buffer to WebP, respecting a maximum file size.
 * Uses iterative quality reduction if the initial output exceeds maxSize.
 * As a last resort, resizes the image proportionally.
 *
 * @param {Buffer} pngBuffer - The source PNG image as a Buffer
 * @param {object} [options]
 * @param {number} [options.maxSize] - Max output size in bytes (default 150KB)
 * @param {number} [options.initialQuality] - Starting WebP quality (default 80)
 * @returns {Promise<{ buffer: Buffer, quality: number, resized: boolean }>}
 */
export async function convertToWebp(pngBuffer, options = {}) {
  const maxSize = options.maxSize || MAX_SIZE_BYTES;
  let quality = options.initialQuality || INITIAL_QUALITY;
  let resized = false;

  // First attempt
  let webpBuffer = await sharp(pngBuffer)
    .webp({ quality })
    .toBuffer();

  // Iteratively reduce quality until under the size limit
  while (webpBuffer.length > maxSize && quality > MIN_QUALITY) {
    quality -= QUALITY_STEP;
    webpBuffer = await sharp(pngBuffer)
      .webp({ quality })
      .toBuffer();
  }

  // If still over after minimum quality, resize progressively as last resort
  if (webpBuffer.length > maxSize) {
    const metadata = await sharp(pngBuffer).metadata();
    let currentWidth = metadata.width;
    resized = true;

    while (webpBuffer.length > maxSize && currentWidth > 100) {
      const scaleFactor = Math.sqrt(maxSize / webpBuffer.length) * 0.95; // 5% margin
      currentWidth = Math.round(currentWidth * scaleFactor);
      webpBuffer = await sharp(pngBuffer)
        .resize(currentWidth)
        .webp({ quality: MIN_QUALITY })
        .toBuffer();
    }
  }

  return { buffer: webpBuffer, quality, resized };
}
