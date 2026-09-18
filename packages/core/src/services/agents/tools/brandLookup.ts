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
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { lookupBrand } from '@/libs/tools/brand/firecrawlBrand';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';

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
        return JSON.stringify(profile);
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
      }),
    },
  );
}
