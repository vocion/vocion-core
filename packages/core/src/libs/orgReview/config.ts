/**
 * How a workspace runs its weekly org review — the shape `defaults.orgReview`
 * is authored in (workspace.yaml), stored in (`project.org_review`) and read
 * through. Pure: no database, so the schema, the applier, the schedule and the
 * review itself read one definition.
 *
 * Every key is optional and a missing one is the shipped default, so a
 * workspace that says nothing gets a review every Monday that names agents
 * idle for two weeks and rules nobody read or restated for two months, and
 * files at most five proposals. A personal workspace is off unless it opts in:
 * it is one person's assistant, not a team that needs managing.
 */

import { z } from 'zod';

/** Mondays, 14:00 UTC — the start of a working week in both US time zones and Europe. */
export const DEFAULT_ORG_REVIEW_CRON = '0 14 * * 1';

/** Days without a run before an agent is proposed for retirement. */
export const DEFAULT_IDLE_DAYS = 14;

/** Days without a read or a restatement before a rule is proposed for retirement. */
export const DEFAULT_STALE_RULE_DAYS = 60;

/**
 * Proposals one review may file. A review that files thirty cards is the queue
 * nobody reads ("700 items need attention is uselessly overwhelming",
 * 2026-09-24); the strongest few are filed and the rest wait for next week.
 */
export const DEFAULT_MAX_PROPOSALS = 5;

/** The authored block, as `WorkspaceManifestSchema.defaults.orgReview` parses it. */
export const OrgReviewConfigSchema = z.object({
  /** Whether the review runs at all. Default: on for a shared workspace, off for a personal one. */
  enabled: z.boolean().optional(),
  /** 5-field cron, UTC. Default `0 14 * * 1` (Mondays 14:00 UTC). */
  schedule: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/, 'schedule must be a 5-field cron').optional(),
  /** Days with no run before an agent is named idle. Default 14. */
  idleDays: z.number().int().min(1).max(365).optional(),
  /** Days with no read and no restatement before a rule is named stale. Default 60. */
  staleRuleDays: z.number().int().min(1).max(3650).optional(),
  /** Most proposals one review files. Default 5. */
  maxProposals: z.number().int().min(0).max(50).optional(),
}).strict();

export type OrgReviewConfig = z.infer<typeof OrgReviewConfigSchema>;

/** The config with every default filled in. */
export type ResolvedOrgReviewConfig = Required<OrgReviewConfig>;

/**
 * The config a workspace runs with: what it authored, the defaults for the rest.
 * @param stored - `project.org_review`, or null when the workspace said nothing.
 * @param kind - `project.kind`; a personal workspace is off unless it opted in.
 */
export function resolveOrgReviewConfig(stored: OrgReviewConfig | null | undefined, kind: 'shared' | 'personal' = 'shared'): ResolvedOrgReviewConfig {
  const parsed = OrgReviewConfigSchema.safeParse(stored ?? {});
  // A stored value that no longer parses (hand-edited, or written by an older
  // shape) reads as "said nothing" rather than failing the review.
  const c = parsed.success ? parsed.data : {};
  return {
    enabled: c.enabled ?? kind !== 'personal',
    schedule: c.schedule ?? DEFAULT_ORG_REVIEW_CRON,
    idleDays: c.idleDays ?? DEFAULT_IDLE_DAYS,
    staleRuleDays: c.staleRuleDays ?? DEFAULT_STALE_RULE_DAYS,
    maxProposals: c.maxProposals ?? DEFAULT_MAX_PROPOSALS,
  };
}
