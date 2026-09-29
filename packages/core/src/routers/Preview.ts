import { os } from '@orpc/server';
import { z } from 'zod';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { resolvePreview } from '@/services/preview/registry';
import { guardAuth } from './AuthGuards';
// Importing the descriptors is what registers them. Once, on the server.
import '@/services/preview/descriptors';

/**
 * preview.get — what the side panel shows for one `RecordRef`.
 *
 * Read-only and org-scoped. The resolver reads mirrors, never the external
 * system, so a peek costs a query rather than someone else's rate limit.
 * Never 404s: a reference nothing can read comes back as an `unresolved` doc
 * carrying the raw reference, because "we do not hold this" is an answer and
 * an empty panel is not.
 */
export const getRoute = os
  .input(z.object({
    type: z.enum(RECORD_TYPES),
    id: z.string().min(1).max(400),
    label: z.string().max(200).optional(),
    href: z.string().max(400).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const href = input.href?.startsWith('/') && !input.href.startsWith('//') ? input.href : undefined;
    return resolvePreview({ type: input.type, id: input.id, label: input.label, href }, { orgId, userId: userId ?? null });
  });

/**
 * preview.status — where each thing a turn set moving stands, for the status
 * dots on the chips under an answer (`services/preview/followStatus`).
 * Read-only and org-scoped; a ref the org does not hold is left out.
 */
export const statusRoute = os
  .input(z.object({
    refs: z.array(z.object({ type: z.enum(['worker_run', 'object', 'ask', 'artifact', 'mission_run']), id: z.string().regex(/^\d{1,12}$/) })).max(24),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { followStatuses } = await import('@/services/preview/followStatus');
    return followStatuses(orgId, input.refs);
  });
