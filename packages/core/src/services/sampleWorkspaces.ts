/**
 * SAMPLE_WORKSPACES — the registry of bundled starter workspaces the
 * product may offer to seed (the empty-state primary on /dashboard/teams,
 * and `teams.seedSample`).
 *
 * A hand-maintained list on purpose, NOT a directory scan: the templates
 * directory also holds `fixtures/` (deliberately broken bundles used by
 * tests), so enumerating it at runtime would make every directory under
 * that path a shipped product surface. Adding a starter here is four
 * lines and a review.
 *
 * ORDER IS CONTRACT: the first entry is the default. Anything that seeds
 * without naming a slug gets `SAMPLE_WORKSPACES[0]`, which is why
 * `meridian-revenue` stays first — behaviour with no choice made is
 * identical to when this constant was a single path.
 *
 * This module is deliberately dependency-free (no db, no fs) so the
 * client-side empty state can import the list without pulling the
 * service's server-only imports into the browser bundle.
 */

export type SampleWorkspace = {
  /** Stable id used by the seed route; never renamed once shipped. */
  slug: string;
  /** Short human label for a picker. */
  label: string;
  /** One sentence: what shape of company this bundle demonstrates. */
  description: string;
  /** Repo-relative bundle path (loadWorkspace resolves via fromRepoRoot). */
  path: string;
};

export const SAMPLE_WORKSPACES: readonly SampleWorkspace[] = [
  {
    slug: 'meridian-revenue',
    label: 'Sample revenue workspace',
    description: 'Meridian Outdoor — four revenue teams under one workspace lead.',
    path: 'packages/core/templates/workspaces/meridian-revenue',
  },
  // Next row lands with the starter it names — see PR #225 (larkfield-support,
  // the human-in-the-loop shape). Kept out until that directory exists on main
  // so this registry never points at a path that isn't shipped.
] as const;

/** The entry used when the caller names no slug. */
export const DEFAULT_SAMPLE_WORKSPACE: SampleWorkspace = SAMPLE_WORKSPACES[0]!;

/**
 * Back-compat: the path this module used to export as a scalar. Still the
 * default bundle, so any caller that imported the old constant keeps
 * working unchanged.
 */
export const SAMPLE_WORKSPACE_PATH: string = DEFAULT_SAMPLE_WORKSPACE.path;

/** Thrown when a caller names a slug that is not in the registry. */
export class UnknownSampleWorkspaceError extends Error {
  constructor(slug: string) {
    super(`Unknown sample workspace "${slug}". Available: ${SAMPLE_WORKSPACES.map(w => w.slug).join(', ')}.`);
    this.name = 'UnknownSampleWorkspaceError';
  }
}

/**
 * Resolve a registry entry by slug. No slug (or an empty one) resolves to
 * the default; an unrecognised slug throws rather than silently seeding
 * something the caller did not ask for.
 * @param slug - Registry slug, or null/undefined for the default.
 */
export function resolveSampleWorkspace(slug?: string | null): SampleWorkspace {
  if (!slug) {
    return DEFAULT_SAMPLE_WORKSPACE;
  }
  const found = SAMPLE_WORKSPACES.find(w => w.slug === slug);
  if (!found) {
    throw new UnknownSampleWorkspaceError(slug);
  }
  return found;
}
