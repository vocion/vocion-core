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
      // Return compact JSON, NOT prose. A live turn proved the model happily
      // echoes any human-readable tool output (and even a "synthesize"
      // instruction line) straight into chat. A raw JSON array is data the
      // model won't paste as an answer — it has to read + synthesize it.
      const rows = objects.map((obj) => {
        const meta = (obj.metadata ?? {}) as Record<string, unknown>;
        const rec: Record<string, unknown> = { title: obj.title, status: obj.status };
        for (const [k, v] of Object.entries(meta)) {
          if (v == null || NOISE_KEY.test(k) || isUrl(v)) {
            continue;
          }
          rec[k] = compactValue(v);
        }
        if (obj.summary) {
          rec.summary = compactValue(obj.summary);
        }
        return rec;
      });
      return JSON.stringify(rows);
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
