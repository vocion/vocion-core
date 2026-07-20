import { ORPCError, os } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { SampleSeedBlockedError, seedSampleWorkspace } from '@/services/SampleWorkspaceService';
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
 * Load the bundled sample workspace ("Meridian Outdoor — Revenue") into a
 * team-less workspace — the empty-state primary action on /dashboard/teams.
 *
 * Admin-gated (it IS a workspace:apply — same bar as `context.applyNow`)
 * and server-enforced first-run only: any existing team rejects with
 * CONFLICT regardless of what the UI shows. Applies through the same
 * loadWorkspace → applyWorkspace pipeline as every other apply; the
 * caller's email is injected as the workspace-default owner so inherited
 * accountability shows a real person from this account.
 */
export const seedSample = os.handler(async () => {
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
    });
  } catch (err) {
    if (err instanceof SampleSeedBlockedError) {
      throw new ORPCError('CONFLICT', { message: err.message });
    }
    throw err;
  }
});
