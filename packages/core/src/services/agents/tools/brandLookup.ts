/**
 * brand_lookup — a company's own site, and the brand facts on it.
 *
 * Exists because a model asked "what does this company do, and what are their
 * colours" answers from memory, fluently, and cannot be checked. This reads the
 * company's own site instead, through Firecrawl's `branding` extractor, which
 * reads RENDERED CSS — so the colours are the ones actually painted rather than
 * ones inferred from prose. Every field carries the URL it came from (design
 * principle 10).
 *
 * The intended consumers are the surfaces that write TO a company — a proposal,
 * a landing page, personalised outreach — where a wrong domain or an invented
 * tagline is worse than a blank.
 */
import type { RuntimeContext } from '../types';
import type { BrandProfile } from '@/libs/tools/brand/firecrawlBrand';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { lookupBrand } from '@/libs/tools/brand/firecrawlBrand';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';

/** A stored image's extension by content type. */
const EXT: Record<string, string> = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Keep a brand profile on a client's project: the facts on its brand, and
 * the logo fetched and stored as its logo when it holds none from that URL.
 * Says what it kept, in words the model passes on.
 * @param ctx - The turn.
 * @param projectId - The project.
 * @param profile - What was read off the site.
 */
async function fileBrandOnProject(ctx: RuntimeContext, projectId: number, profile: BrandProfile): Promise<string> {
  const { getDataRoom, sameName, updateDataRoom } = await import('@/services/DataRoomService');
  const room = await getDataRoom(ctx.orgId, projectId);
  if (!room) {
    return `No project #${projectId}; nothing kept.`;
  }
  await updateDataRoom(ctx.orgId, projectId, {
    brandProfile: {
      source: profile.url,
      readAt: new Date().toISOString(),
      // The same name as the project's, cased another way ("MetaCTO" for "Metacto"), reads as the project spells it.
      ...(profile.name ? { name: sameName(profile.name, room.title) ? room.title : profile.name } : {}),
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.colors ? { colors: Object.fromEntries(Object.entries(profile.colors).filter(([, v]) => typeof v === 'string' && v)) as Record<string, string> } : {}),
      ...(profile.fonts ? { fonts: profile.fonts } : {}),
      ...(profile.colorScheme ? { colorScheme: profile.colorScheme } : {}),
    },
  });
  const kept = [`colours, fonts and name kept on project #${projectId}`];
  if (profile.logoUrl && room.meta.brand?.logo?.source !== profile.logoUrl) {
    try {
      const [{ fetchImage }, { saveArtifact }] = await Promise.all([import('@/libs/tools/image/remote'), import('@/libs/tools/artifacts/store')]);
      const got = await fetchImage(profile.logoUrl, {});
      const saved = await saveArtifact({ orgId: ctx.orgId, data: got.bytes, ext: EXT[got.contentType] ?? 'png', contentType: got.contentType });
      await updateDataRoom(ctx.orgId, projectId, { brandImage: { slot: 'logo', image: { dataUri: got.dataUri, width: got.width, height: got.height, bytes: got.bytes.byteLength, contentType: got.contentType, source: got.url, fetchedAt: new Date().toISOString(), url: saved.url } } });
      kept.push('the logo fetched and kept as its logo');
    } catch (err) {
      kept.push(`the logo could not be fetched (${(err as Error).message ?? 'unknown error'}); say so, never draw it as text`);
    }
  }
  return `${kept.join('; ')}. Its Brand & guidelines show them; link there from the wiki rather than copying them.`;
}

export function brandLookupTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        const profile = await lookupBrand(args.company, { orgId: ctx.orgId });
        if (!profile) {
          return `No site found for "${args.company}". Say so rather than guessing a domain — a plausible wrong one is worse than none.`;
        }
        // Returned as JSON: every consumer of this is going to compose with the
        // fields, and prose would make the model re-parse its own tool output.
        if (!args.project_id) {
          return JSON.stringify(profile);
        }
        const filed = await fileBrandOnProject(ctx, args.project_id, profile);
        return JSON.stringify({ ...profile, project: filed });
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError || err instanceof ToolProviderKeyUnavailableError) {
          return 'Brand lookup is unavailable for this run — no Firecrawl key is configured. Say the lookup could not run; do not substitute what you remember about the company.';
        }
        return `Brand lookup failed: ${(err as Error).message ?? 'unknown error'}. Do not substitute remembered facts.`;
      }
    },
    {
      name: 'brand_lookup',
      description: [
        'Find a company\'s OFFICIAL website and read its brand facts off it: brand name, description, logo and favicon, the colour roles (primary, secondary, accent, background, text, link), font families by role, the spacing scale, and Firecrawl\'s own confidence in the extraction.',
        'Use this before writing anything addressed TO a company — a proposal, a landing page, personalised outreach — instead of recalling what you know about them. Accepts a company name, a bare domain, or a sentence containing one.',
        'Returns JSON with a `url` every other field was read from, plus `alternates` when the first match may be wrong. Fields are omitted rather than guessed: an absent colour means the extractor did not find one. Never fill a gap from memory and never present a remembered domain as the official one.',
      ].join(' '),
      schema: z.object({
        company: z.string().min(2).describe('Company name, domain, or a sentence naming one — e.g. "Northwind Health", "northwindhealth.com"'),
        project_id: z.number().int().positive().optional().describe('The client\'s project: the colours, fonts and name are kept on its brand, and the logo fetched onto it, so its Brand & guidelines show them and every writer reads them from there.'),
      }),
    },
  );
}
