import { ORPCError, os } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { SampleSeedBlockedError, seedSampleWorkspace, UnknownSampleWorkspaceError } from '@/services/SampleWorkspaceService';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Teams of AGENTS (the F1 org chart) — not the humans in the account
 * (those are routers/Members.ts). One read route: everything the
 * org-chart page needs in a single call — the workspace-lead band plus
 * each team with its lead, members, and ONE resolved accountable human
 * whose `source` ('team' | 'workspace') lets the UI label explicit vs
 * inherited ownership.
 */
export const list = os.handler(async () => {
  const { orgId } = await guardAuth();
  const [workspace, teams] = await Promise.all([getWorkspaceLead(orgId), listTeams(orgId)]);
  return { workspace, teams };
});

/**
 * Load one of the bundled starter workspaces into a team-less workspace —
 * the empty-state primary action on /dashboard/teams.
 *
 * `slug` is optional and names an entry in SAMPLE_WORKSPACES; omitting it
 * loads the registry default ("Meridian Outdoor — Revenue"), so an older
 * caller that sends no input behaves exactly as before. An unknown slug is
 * a BAD_REQUEST, never a silent fallback.
 *
 * Admin-gated (it IS a workspace:apply — same bar as `context.applyNow`)
 * and server-enforced first-run only: any existing team rejects with
 * CONFLICT regardless of what the UI shows. Applies through the same
 * loadWorkspace → applyWorkspace pipeline as every other apply; the
 * caller's email is injected as the workspace-default owner so inherited
 * accountability shows a real person from this account.
 */
export const seedSample = os
  .input(z.object({ slug: z.string().min(1).optional() }).optional())
  .handler(async ({ input }) => {
    const ctx = await guardAuth();
    if (!ctx.has({ role: 'org:admin' })) {
      throw ApiError.forbidden();
    }
    const [me] = await db
      .select({ email: userSchema.email })
      .from(userSchema)
      .where(eq(userSchema.id, ctx.userId))
      .limit(1);

    try {
      return await seedSampleWorkspace({
        orgId: ctx.orgId,
        workspaceOwnerEmail: me?.email ?? null,
        slug: input?.slug,
      });
    } catch (err) {
      if (err instanceof SampleSeedBlockedError) {
        throw new ORPCError('CONFLICT', { message: err.message });
      }
      if (err instanceof UnknownSampleWorkspaceError) {
        throw new ORPCError('BAD_REQUEST', { message: err.message });
      }
      throw err;
    }
  });
