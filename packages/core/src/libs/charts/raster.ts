import type { ChartSpec } from './spec';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { REVIEW_WIDTH } from './review';
import { renderChartSvg } from './svg';

/**
 * The chart as a picture, for the model's review of what it drew
 * (`services/agents/toolResultImages.ts`). Laid out at a phone's width, then
 * rasterized at up to 2x so small labels stay legible, as WebP. One image per
 * chart, capped in bytes: past the cap it is redrawn at 1x, and past that it
 * is not sent (the text review still is).
 */

/** The largest picture a review sends, bytes of encoded image. */
export const REVIEW_IMAGE_MAX_BYTES = 150_000;

export type ChartImage = {
  mimeType: 'image/webp';
  /** The encoded image, base64. */
  data: string;
  bytes: number;
  /** Pixel size of the encoded image. */
  width: number;
  height: number;
};

/**
 * Rasterize a chart as it draws at `width` CSS px.
 * @param spec - A spec that passed `chartSpecSchema` and has no refusals.
 * @param opts - Options.
 * @param opts.width - The layout width, CSS px (a phone's by default).
 * @param opts.maxBytes - The size cap.
 * @returns The image, or null when it cannot be drawn within the cap.
 */
export async function rasterizeChart(spec: ChartSpec, opts: { width?: number; maxBytes?: number } = {}): Promise<ChartImage | null> {
  const width = opts.width ?? REVIEW_WIDTH;
  const maxBytes = opts.maxBytes ?? REVIEW_IMAGE_MAX_BYTES;
  const svg = renderChartSvg(spec, { width }, 'review');
  for (const scale of [2, 1]) {
    try {
      const { data, info } = await sharp(Buffer.from(svg), { density: 72 * scale })
        .flatten({ background: '#ffffff' })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength <= maxBytes) {
        return { mimeType: 'image/webp', data: data.toString('base64'), bytes: data.byteLength, width: info.width, height: info.height };
      }
    } catch {
      return null;
    }
  }
  return null;
}
