import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listBusinessObjects } from '@/services/BusinessObjectService';

/**
 * lookup_objects — list business objects the agent has access to.
 *
 * Mirrors the legacy behavior: render each object's title, type, status,
 * inline metadata, summary, and linked documents.
 * @param ctx
 */
export function lookupObjectsTool(ctx: RuntimeContext) {
  const available = ctx.objectTypeSlugs.join(', ');
  return tool(
    async (args) => {
      const objects = await listBusinessObjects(ctx.orgId, args.type_slug);
      if (objects.length === 0) {
        return 'No business objects found for this type.';
      }
      return objects.map((obj) => {
        const meta = obj.metadata as Record<string, unknown>;
        const metaStr = Object.entries(meta)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : v}`)
          .join('\n   ');
        const docLinks = obj.documentLinks.map(l =>
          `  - [${l.sourceType}] ${l.semanticIdentifier ?? l.onyxDocumentId} (${l.role})${l.link ? ` — ${l.link}` : ''}`,
        ).join('\n');
        return [
          `**${obj.title}** (${obj.type.label}) — Status: ${obj.status}`,
          `   View: /dashboard/objects/${obj.id}`,
          metaStr ? `   ${metaStr}` : '',
          obj.summary ? `   Summary: ${obj.summary}` : '',
          docLinks ? `   Linked sources:\n${docLinks}` : '',
        ].filter(Boolean).join('\n');
      }).join('\n\n');
    },
    {
      name: 'lookup_objects',
      description: 'Look up structured business objects in CoreContext (discovery calls, deals, accounts) that link documents across multiple systems. Use AFTER search_onyx to check if there is additional structured context about a result.',
      schema: z.object({
        type_slug: z.string().optional().describe(`Object type to filter by${available ? ` (available: ${available})` : ''}`),
      }),
    },
  );
}
