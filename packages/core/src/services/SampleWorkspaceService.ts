/**
 * SampleWorkspaceService — loads the bundled "Meridian Outdoor — Revenue"
 * sample workspace into a team-less workspace (the empty-state primary on
 * /dashboard/teams, F1 slice 4).
 *
 * Deliberately thin: gating + sample-user setup here, then the SAME
 * pipeline every apply uses — loadWorkspace → applyWorkspace — so the
 * sample is just another workspace, not a parallel seeding path. The
 * apply is additive (upserts only); it never removes anything.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { applyWorkspace, loadWorkspace } from '@/libs/workspace';
import { teamSchema, userSchema } from '@/models/Schema';

/**
 * Where the bundled sample lives, repo-relative (loadWorkspace resolves
 * via fromRepoRoot). Negative fixtures for tests sit beside it under
 * templates/workspaces/fixtures/ — never reachable from the router.
 */
export const SAMPLE_WORKSPACE_PATH = 'packages/core/templates/workspaces/meridian-revenue';

/**
 * Sample humans the bundle references by email (display-only owners; no
 * password, so they can never sign in). Created idempotently before the
 * apply so `accountableUser:` resolution finds them.
 */
export const SAMPLE_USERS = [
  { name: 'Lili Chen', email: 'lili.chen@meridianoutdoor.example' },
] as const;

/** Thrown when the workspace already has teams — the seed is first-run only. */
export class SampleSeedBlockedError extends Error {
  constructor() {
    super('This workspace already has teams — the sample only loads into a workspace with none. Author more teams in your workspace YAML instead.');
    this.name = 'SampleSeedBlockedError';
  }
}

export type SeedSampleResult = {
  /** Workspace sha of the applied bundle (recorded as a workspace_version). */
  sha: string;
  /** What the bundle defines — created (or re-affirmed) by the apply. */
  teams: string[];
  agents: string[];
  counts: Awaited<ReturnType<typeof applyWorkspace>>['counts'];
  errors: Awaited<ReturnType<typeof applyWorkspace>>['errors'];
};

/**
 * Load + apply the sample bundle for one org. Server-enforced gating:
 * refuses (throws {@link SampleSeedBlockedError}) whenever the org
 * already has ANY team — the UI hiding the button is a courtesy, not
 * the enforcement.
 * @param opts - Seed options.
 * @param opts.orgId - Target org/project.
 * @param opts.workspaceOwnerEmail - Injected as the manifest's
 * `accountableUser` so the workspace-default owner is a real person in
 * the caller's account (the bundle file omits it on purpose).
 * @param opts.bundlePath - Test-only override (negative fixtures). The
 * router never passes this.
 */
export async function seedSampleWorkspace(opts: {
  orgId: string;
  workspaceOwnerEmail?: string | null;
  bundlePath?: string;
}): Promise<SeedSampleResult> {
  const [existingTeam] = await db
    .select({ slug: teamSchema.slug })
    .from(teamSchema)
    .where(eq(teamSchema.orgId, opts.orgId))
    .limit(1);
  if (existingTeam) {
    throw new SampleSeedBlockedError();
  }

  await ensureSampleUsers();

  const loaded = loadWorkspace(opts.bundlePath ?? SAMPLE_WORKSPACE_PATH);
  if (opts.workspaceOwnerEmail) {
    // The one parameterized field: the workspace-default owner. Injected
    // into the manifest BEFORE apply so resolution + provenance flow
    // through the normal applier path (acceptance #6: inherited owners
    // label as "workspace default").
    loaded.manifest = { ...loaded.manifest, accountableUser: opts.workspaceOwnerEmail };
  }

  const result = await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: 'teams-seed-sample' });

  return {
    sha: result.sha,
    teams: loaded.teams.map(t => t.slug),
    agents: loaded.agents.map(a => a.slug),
    counts: result.counts,
    errors: result.errors,
  };
}

/**
 * Idempotently create the bundle's sample humans (by email). No
 * passwordHash — they exist as FK targets + display names only.
 */
async function ensureSampleUsers(): Promise<void> {
  for (const sample of SAMPLE_USERS) {
    const [existing] = await db
      .select({ id: userSchema.id })
      .from(userSchema)
      .where(eq(userSchema.email, sample.email))
      .limit(1);
    if (!existing) {
      await db.insert(userSchema).values({
        id: `usr-sample-${randomUUID()}`,
        name: sample.name,
        email: sample.email,
      });
    }
  }
}
