/**
 * The deployment seed: who is on this installation and what they reach.
 *
 * Deployment-level rather than workspace-level, because people and groups span
 * workspaces. A workspace manifest says what a workspace IS; these say who may
 * open it.
 *
 *   deployment/groups.yaml   a group, and the workspaces it grants, at a role
 *   deployment/people.yaml   a person, and the groups they are in
 *
 * The rule that governs both, and the reason this is not modelled on
 * `workspace.yaml`: **the database is the truth and this file seeds it once.**
 * An apply creates what is absent and never updates or deletes what a person
 * has since changed. `enabled_surfaces` is replaced wholesale on every apply,
 * which is correct for workspace config and is how Personalization and
 * Discovery vanished from the revenue workspace on 2026-09-15. People are not
 * config; a membership someone edited in the interface must survive a deploy.
 *
 * The single exception is stated in `PeopleSeedService`: a grant the BACKFILL
 * created may be removed, because it is a machine-generated default rather
 * than anyone's decision.
 */

import { z } from 'zod';

/** Matches `WorkspaceRole` in `services/authz.ts`, which turns it into grants. */
export const SeedRoleSchema = z.enum(['owner', 'pm', 'specialist', 'client_reviewer']);

const SlugSchema = z.string().trim().min(1).max(64).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'a slug is lower-case words joined by single hyphens',
);

/** One workspace a group opens, and the role its members hold there. */
export const GroupGrantSchema = z.object({
  /** The `project.slug` of the workspace, e.g. `revenue`. */
  workspace: SlugSchema,
  role: SeedRoleSchema,
}).strict();

export const GroupSchema = z.object({
  slug: SlugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  /**
   * Empty is legal and means a group that grants nothing yet — a roster
   * someone will grant workspaces to later, which is a real intermediate state
   * and better than forcing a placeholder grant.
   */
  grants: z.array(GroupGrantSchema).default([]),
}).strict();

export const GroupsFileSchema = z.object({
  version: z.literal(1),
  groups: z.array(GroupSchema).default([]),
}).strict();

export const PersonSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /** Shown on the invite. Optional: the person sets their own name on signup. */
  name: z.string().trim().min(1).max(120).optional(),
  /**
   * Account-level role, when the seed means to assert one. Omitted means "not
   * this file's business" — the applier never CHANGES an account role, so
   * declaring one it disagrees with only produces a warning on every run.
   */
  role: z.enum(['admin', 'member']).optional(),
  /**
   * Whether an unknown email should be invited.
   *
   * Default false, because a seed whose job is access should not onboard
   * anyone by accident: a typo, or a person whose account is under a different
   * address, would otherwise mint an invite nobody asked for. Unknown and
   * `invite: false` is reported and skipped.
   */
  invite: z.boolean().default(false),
  groups: z.array(SlugSchema).default([]),
  /**
   * Whether this person's workspaces are exactly what their groups grant.
   *
   * `true` lets the apply remove a grant the BACKFILL created that no group of
   * theirs covers — which is the only way "Lili reaches RevOps and nothing
   * else" can be true on a deployment whose backfill gave everyone everything.
   * It still never removes a grant a person made.
   *
   * Default false, so listing someone can only ever widen what they reach.
   * Narrowing is opt-in per person, stated where a reader can see it.
   */
  exclusive: z.boolean().default(false),
}).strict();

export const PeopleFileSchema = z.object({
  version: z.literal(1),
  people: z.array(PersonSchema).default([]),
}).strict();

export type SeedRole = z.infer<typeof SeedRoleSchema>;
export type SeedGroup = z.infer<typeof GroupSchema>;
export type SeedPerson = z.infer<typeof PersonSchema>;
export type GroupsFile = z.infer<typeof GroupsFileSchema>;
export type PeopleFile = z.infer<typeof PeopleFileSchema>;
