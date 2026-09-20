/**
 * fetch_image — a real image from a URL, small enough to live in a document.
 *
 * The gap this closes, in one transcript: asked for a client's logo, an
 * agent called `fetch_url`, got the PNG back as garbled text (that tool is a
 * prose reader), concluded images were not something it could do, and drew a
 * text wordmark instead — on the cover of a proposal, beside the seller's
 * real mark (2026-09-19). Every part of the loop was working; there was
 * simply no tool that handled bytes.
 *
 * So this one does, and it is strict about it, because the output is pasted
 * straight into a client-facing document:
 *
 *   - the address must be public, on every redirect hop — never `file://`,
 *     localhost, or a private range;
 *   - the bytes must really be an image, by magic number, whatever the
 *     extension and the `Content-Type` claim;
 *   - the body is capped while it is read, the image is downscaled, and the
 *     data URI has a ceiling — a document is not a photo album;
 *   - anything else is refused in one sentence that says what to do next.
 *
 * The result is filed as an artifact AND, when the call names a room, onto
 * the room's `brand` — because the client's logo is a fact about the client,
 * not about one document, and the next proposal written from that room
 * should not fetch it again (`read_data_room` hands it over).
 *
 * No provider, no key, no spend: this is one HTTP GET.
 */

import type { RuntimeContext } from '../types';
import type { RoomImage } from '@/services/DataRoomService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { DEFAULT_MAX_EDGE, fetchImage, ImageFetchError } from '@/libs/tools/image/remote';
import { getDataRoom, updateDataRoom } from '@/services/DataRoomService';

/** `data:image/png;base64,…` → the extension to store it under. */
const EXT: Record<string, string> = { 'image/png': 'png', 'image/svg+xml': 'svg' };

export function fetchImageTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const slot = args.slot ?? 'logo';
      // Fetched once per room. A second call for the same URL hands back what
      // is already filed rather than spending another round trip — and, more
      // to the point, keeps one document's logo identical to the last one's.
      if (args.room_id && !args.refresh) {
        const room = await getDataRoom(ctx.orgId, args.room_id);
        const held = room?.meta.brand?.[slot];
        if (held && held.source === args.url) {
          return receipt(held, `Already on data room #${args.room_id} as the ${slot}, fetched ${held.fetchedAt.slice(0, 10)} — not fetched again.`);
        }
      }

      let got: Awaited<ReturnType<typeof fetchImage>>;
      try {
        got = await fetchImage(args.url, { maxEdge: args.max_width ?? DEFAULT_MAX_EDGE });
      } catch (err) {
        if (err instanceof ImageFetchError) {
          return `Did not fetch that image: ${err.message} Say the logo could not be retrieved — never draw a company's mark as styled text and present it as their logo.`;
        }
        return `Could not fetch ${args.url}: ${(err as Error).message ?? 'unknown error'}. Say so rather than substituting a drawn wordmark.`;
      }

      const saved = await saveArtifact({ orgId: ctx.orgId, data: got.bytes, ext: EXT[got.contentType] ?? 'png', contentType: got.contentType });
      const image: RoomImage = {
        dataUri: got.dataUri,
        width: got.width,
        height: got.height,
        bytes: got.bytes.byteLength,
        contentType: got.contentType,
        source: got.url,
        fetchedAt: new Date().toISOString(),
        url: saved.url,
      };

      let filed = `Stored as ${saved.url}.`;
      if (args.room_id) {
        const updated = await updateDataRoom(ctx.orgId, args.room_id, { brandImage: { slot, image } });
        filed = updated
          ? `Stored as ${saved.url} and filed on data room #${args.room_id} as the client's ${slot} — read_data_room hands it to every document written from that room.`
          : `Stored as ${saved.url}. There is no data room #${args.room_id}, so it was not filed on one.`;
      }
      return receipt(image, filed);
    },
    {
      name: 'fetch_image',
      description: 'Fetch a real image from a URL — a client\'s logo, a product shot — verify from its BYTES that it is an image, downscale it, and return it as a data URI ready to inline in a document, plus its dimensions. Use this whenever a document needs a picture of something that exists: fetch_url reads prose and returns an image as garbled text. Pass `room_id` to keep it on the data room as the client\'s logo, so every later document uses the same one instead of fetching again. It refuses anything that is not an image, anything too large, and any address that is not on the public internet. If it refuses, say the image could not be retrieved — never draw a company\'s mark as styled text and call it their logo.',
      schema: z.object({
        url: z.string().url().describe('Direct URL of the image file itself — not the page it appears on. brand_lookup returns one for a company\'s logo and favicon.'),
        room_id: z.number().int().positive().optional().describe('The data room this is the client\'s brand for. Files it there so it is reused, not refetched.'),
        slot: z.enum(['logo', 'mark']).optional().describe('`logo` is the full lockup for a cover (default); `mark` is the square symbol for the page strip.'),
        max_width: z.number().int().min(32).max(2048).optional().describe(`Longest edge after downscaling. Default ${DEFAULT_MAX_EDGE}px, which is right for a logo; go larger only for an image that fills a sheet.`),
        refresh: z.boolean().optional().describe('Fetch again even if the room already holds this URL.'),
      }),
    },
  );
}

/**
 * What the model gets back: the facts, then the data URI last, so the
 * dimensions are readable before 30 KB of base64.
 * @param image - The fetched image.
 * @param where - One line on what was stored and where.
 */
function receipt(image: RoomImage, where: string): string {
  const dims = image.width && image.height ? `${image.width}×${image.height}` : 'dimensions not declared (it is an SVG — it scales)';
  return [
    `Image fetched and verified: ${image.contentType}, ${dims}, ${Math.round(image.bytes / 1024)} KB, from ${image.source}.`,
    where,
    '',
    'Inline it exactly as below — copy the whole value, do not shorten or re-encode it:',
    `<img src="${image.dataUri}" alt="" />`,
  ].join('\n');
}
