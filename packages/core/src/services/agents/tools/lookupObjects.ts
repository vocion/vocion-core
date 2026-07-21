import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listBusinessObjects } from '@/services/BusinessObjectService';

// Metadata keys that are plumbing, not answer material — never surfaced to the
// model. They invite verbatim dumps: internal ids, deep-links, profile URLs.
const NOISE_KEY = /(?:^|_)(?:id|ids|url|urls|link|links|slug)$|linkedin/i;
const isUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v);

function compactValue(v: unknown): string {
  const s = Array.isArray(v) ? (v as unknown[]).join(', ') : String(v ?? '');
  return s.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * lookup_objects — list the structured business objects the agent can see.
 *
 * Returns a COMPACT, sanitized digest: human fields only, no internal ids, no
 * deep-links (/dashboard/objects/…), no profile URLs. It is DATA for the agent
 * to synthesize into a plain-language answer, never to paste back verbatim —
 * pasting the raw record is the exact anti-pattern that dumps ugly field lists
 * into chat. (An eval guard asserts responses never contain "/dashboard/objects/".)
 * @param ctx
 */
export function lookupObjectsTool(ctx: RuntimeContext) {
  const available = ctx.objectTypeSlugs.join(', ');
  return tool(
    async (args) => {
      const objects = await listBusinessObjects(ctx.orgId, args.type_slug);
      if (objects.length === 0) {
        return 'No records found for this type.';
      }
      const rows = objects.map((obj) => {
        const meta = (obj.metadata ?? {}) as Record<string, unknown>;
        const fields = Object.entries(meta)
          .filter(([k, v]) => v != null && !NOISE_KEY.test(k) && !isUrl(v))
          .slice(0, 8)
          .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${compactValue(v)}`)
          .join('; ');
        const summary = obj.summary ? ` — ${compactValue(obj.summary)}` : '';
        return `- ${obj.title} [${obj.status}]${fields ? ` · ${fields}` : ''}${summary}`;
      }).join('\n');
      return `${objects.length} record(s). This is DATA to SYNTHESIZE — do NOT paste these fields, ids, or links back to the user; name people and reasons in plain language.\n${rows}`;
    },
    {
      name: 'lookup_objects',
      description: 'Look up the structured business objects (follow-ups, events, deals, accounts) the agent tracks. Returns a compact, sanitized digest to SYNTHESIZE into a plain answer — never paste it back verbatim.',
      schema: z.object({
        type_slug: z.string().optional().describe(`Object type to filter by${available ? ` (available: ${available})` : ''}`),
      }),
    },
  );
}
