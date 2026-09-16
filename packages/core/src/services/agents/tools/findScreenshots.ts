/**
 * find_screenshots — the pictures this workspace already has.
 *
 * "Any screenshots to go with this?" should almost never be answered with a
 * flat no: a workspace that ships releases has hero images on its release
 * posts, generated graphics in its artifacts, and sometimes a registered
 * screenshot library. Nothing looked in all three, so the honest "no" was
 * wrong.
 *
 * The result says, per image, whether an outside service can fetch the URL.
 * That matters on a chat surface: Slack renders an image block by fetching the
 * URL ITSELF, so an artifact behind Vocion's authentication has to be uploaded
 * as bytes instead of linked.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { findScreenshots } from '@/services/ScreenshotService';

export function findScreenshotsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { screenshots, searched } = await findScreenshots({ orgId: ctx.orgId, query: args.query ?? '', limit: args.limit });
      if (screenshots.length === 0) {
        return JSON.stringify({
          screenshots: [],
          searched,
          note: `No image matched${args.query ? ` "${args.query}"` : ''}. Searched: ${searched.join(', ')}. Say which of those you looked in rather than only "none found", and offer to generate one with \`generate_image\` if a diagram would do.`,
        });
      }
      return JSON.stringify({
        screenshots,
        searched,
        note: 'Attach these rather than pasting their links: a link to an image does not unfurl in a private channel. `publiclyFetchable: false` means the image lives behind Vocion sign-in, so a chat surface can only show it by uploading the bytes.',
      });
    },
    {
      name: 'find_screenshots',
      description: 'Find images and screenshots this workspace already has — release-post hero images from its public site, image artifacts, and a registered screenshot library. Returns url, caption, what it shows, where it came from, and whether an outside service can fetch the URL. Call it before answering "do you have a screenshot of…" or "any screenshots to go with this", and before posting an announcement that would read better with a picture.',
      schema: z.object({
        query: z.string().optional().describe('What the image should show, e.g. "release notes 2.80" or "inbox". Empty returns the most recent.'),
        limit: z.number().int().min(1).max(20).optional().describe('How many to return (default 6).'),
      }),
    },
  );
}
