import { ORPCError, os } from '@orpc/server';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';
import { guardAuth, guardRole } from './AuthGuards';

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
 * TODO(slice-4): wire this to a `workspace:apply` of the bundled sample
 * (additive, never destructive — same applier the drift banner uses). The
 * sample bundle itself lands in slice 4; until then this stub keeps the
 * button honest with a clear 501. Admin-gated now because the real thing
 * is an apply (same bar as `context.applyNow`).
 */
export const seedSample = os.handler(async () => {
  await guardRole('org:admin');
  throw new ORPCError('NOT_IMPLEMENTED', {
    message: 'The sample workspace isn\'t bundled in this build yet — it ships in the next update. Meanwhile you can author teams in your workspace YAML.',
  });
});
