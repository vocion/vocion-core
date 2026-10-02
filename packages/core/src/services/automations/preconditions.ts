/**
 * What must be true before an automation's run starts, by the `role` the
 * automation declares (#1028).
 *
 * A prompt that says "nothing configured: say so and stop" still costs a model
 * call every time the schedule fires. A role whose work depends on a setting
 * names that setting here, as code, so an unconfigured workspace pays nothing.
 * One entry per role; a role with no entry never waits on anything. Add a
 * role's precondition by adding it to `PRECONDITION_BY_ROLE`.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

/** Answers with the sentence that says what is missing, or null when the run may start. */
type Precondition = (orgId: string) => Promise<string | null>;

/**
 * Whether any source in the workspace has a non-empty `intakeStatuses`, the
 * setting that says which tracker statuses the factory picks up. One indexed
 * count over the org's sources, not a read per source.
 * @param orgId - The workspace.
 * @returns A sentence naming what is missing, or null when intake is configured.
 */
async function trackerIntakeConfigured(orgId: string): Promise<string | null> {
  const [found] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      sql`jsonb_typeof(${knowledgeSourceSchema.configJson}->'intakeStatuses') = 'array' and jsonb_array_length(${knowledgeSourceSchema.configJson}->'intakeStatuses') > 0`,
    ));
  return Number(found?.n ?? 0) > 0
    ? null
    : 'no tracker source in this workspace has intakeStatuses set, so there is nothing to pick up; setup saves them when a person says how to work the roadmap';
}

const PRECONDITION_BY_ROLE: Record<string, Precondition> = {
  'tracker-intake': trackerIntakeConfigured,
};

/**
 * Why an automation of this role must not run now.
 * @param orgId - The workspace.
 * @param role - The automation's declared `role`, when it has one.
 * @returns The reason as a sentence, or null when the run may start.
 */
export async function unmetPrecondition(orgId: string, role: string | undefined): Promise<string | null> {
  const check = role ? PRECONDITION_BY_ROLE[role] : undefined;
  return check ? check(orgId) : null;
}
