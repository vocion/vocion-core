/**
 * THE WORKSPACE'S FRONT DOOR FOR WORK — the record type that turns an idea
 * into something the workspace builds.
 *
 * Chris, 2026-10-04, of three feature-idea cards a chat turn ended on: "I
 * should have a path to just push the idea into the software factory from
 * chat. This concept should be universal. Simple. Magical. Fast." So a card
 * in chat offers Build it whenever the workspace has a door to push it
 * through. Core names no type: a type declares itself the intake with
 * `x-intake: true` on its schema (the software-factory plugin's `request`),
 * and its `x-owner` is the agent the idea is handed to.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectTypeSchema } from '@/models/Schema';

export type WorkspaceIntake = {
  /** The intake type's slug, as the workspace stores it. */
  typeSlug: string;
  /** What a person calls one ("Request"). */
  label: string;
  /** The agent that files and builds one (`x-owner`), when the type names it. */
  ownerSlug: string | null;
};

/**
 * Pick the intake out of a workspace's types: the first whose schema says
 * `x-intake: true`. Pure, for its test.
 * @param types - The workspace's record types.
 */
export function intakeOf(types: Array<{ slug: string; label: string | null; schema: unknown }>): WorkspaceIntake | null {
  for (const t of types) {
    const schema = (t.schema ?? {}) as Record<string, unknown>;
    if (schema['x-intake'] !== true) {
      continue;
    }
    const owner = schema['x-owner'];
    return { typeSlug: t.slug, label: t.label?.trim() || t.slug, ownerSlug: typeof owner === 'string' && owner.trim() ? owner.trim() : null };
  }
  return null;
}

/**
 * The workspace's intake, or null when it has none — and then nothing offers
 * Build it.
 * @param orgId - The workspace.
 */
export async function workspaceIntake(orgId: string): Promise<WorkspaceIntake | null> {
  const types = await db
    .select({ slug: businessObjectTypeSchema.slug, label: businessObjectTypeSchema.label, schema: businessObjectTypeSchema.schema })
    .from(businessObjectTypeSchema)
    .where(eq(businessObjectTypeSchema.orgId, orgId));
  return intakeOf(types);
}
