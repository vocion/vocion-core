/**
 * SampleWorkspaceService — loads one of the bundled starter workspaces
 * (see SAMPLE_WORKSPACES) into a team-less workspace: the empty-state
 * primary on /dashboard/teams, F1 slice 4. With no slug named it loads
 * the registry default, "Meridian Outdoor — Revenue".
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
import { resolveSampleWorkspace } from './sampleWorkspaces';

/**
 * The registry of bundled starters lives in ./sampleWorkspaces (a
 * dependency-free module so the client empty state can import it).
 * Re-exported here because that is where callers have always looked;
 * SAMPLE_WORKSPACE_PATH keeps its old meaning — the default bundle's
 * path. Negative fixtures for tests sit beside the starters under
 * templates/workspaces/fixtures/ and are NOT in the registry, so they
 * stay unreachable from the router.
 */
export {
  DEFAULT_SAMPLE_WORKSPACE,
  resolveSampleWorkspace,
  SAMPLE_WORKSPACE_PATH,
  SAMPLE_WORKSPACES,
  type SampleWorkspace,
  UnknownSampleWorkspaceError,
} from './sampleWorkspaces';

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
  /** Registry slug of the bundle that was applied. */
  slug: string;
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
 * @param opts.slug - Which registry entry to load. Omitted (the old
 * behaviour) resolves to SAMPLE_WORKSPACES[0]; an unknown slug throws
 * {@link UnknownSampleWorkspaceError}.
 * @param opts.bundlePath - Test-only override (negative fixtures). The
 * router never passes this; it wins over `slug` when both are given.
 */
export async function seedSampleWorkspace(opts: {
  orgId: string;
  workspaceOwnerEmail?: string | null;
  slug?: string | null;
  bundlePath?: string;
}): Promise<SeedSampleResult> {
  // Resolve BEFORE the db round trip so a bad slug fails fast and cheap.
  const sample = resolveSampleWorkspace(opts.slug);
  const [existingTeam] = await db
    .select({ slug: teamSchema.slug })
    .from(teamSchema)
    .where(eq(teamSchema.orgId, opts.orgId))
    .limit(1);
  if (existingTeam) {
    throw new SampleSeedBlockedError();
  }

  await ensureSampleUsers();

  const loaded = loadWorkspace(opts.bundlePath ?? sample.path);
  if (opts.workspaceOwnerEmail) {
    // The one parameterized field: the workspace-default owner. Injected
    // into the manifest BEFORE apply so resolution + provenance flow
    // through the normal applier path (acceptance #6: inherited owners
    // label as "workspace default").
    loaded.manifest = { ...loaded.manifest, accountableUser: opts.workspaceOwnerEmail };
  }

  const result = await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: 'teams-seed-sample' });

  return {
    slug: sample.slug,
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
