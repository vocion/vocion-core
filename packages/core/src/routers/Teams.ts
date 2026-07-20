import { os } from '@orpc/server';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';
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
