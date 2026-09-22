import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userNavPrefSchema } from '@/models/Schema';

/**
 * Per-user sidebar preferences (pins + dismissed prompts). Tiny by design —
 * one row per (org, user), whole-list writes — so the sidebar can treat
 * localStorage as the fast path and this as the truth across devices.
 */

export type NavPrefs = { pins: string[]; dismissed: string[] };

const EMPTY: NavPrefs = { pins: [], dismissed: [] };
const MAX_PINS = 40;

export async function getNavPrefs(input: { orgId: string; userId: string }): Promise<NavPrefs> {
  const [row] = await db
    .select({ pins: userNavPrefSchema.pins, dismissed: userNavPrefSchema.dismissed })
    .from(userNavPrefSchema)
    .where(and(eq(userNavPrefSchema.orgId, input.orgId), eq(userNavPrefSchema.userId, input.userId)))
    .limit(1);
  return row ? { pins: row.pins ?? [], dismissed: row.dismissed ?? [] } : EMPTY;
}

/**
 * Replace the pin list (deduped, capped). Returns the stored prefs.
 * @param input
 * @param input.orgId
 * @param input.userId
 * @param input.pins
 */
export async function setNavPins(input: { orgId: string; userId: string; pins: string[] }): Promise<NavPrefs> {
  const pins = [...new Set(input.pins.map(p => p.trim()).filter(Boolean))].slice(0, MAX_PINS);
  const [row] = await db
    .insert(userNavPrefSchema)
    .values({ orgId: input.orgId, userId: input.userId, pins })
    .onConflictDoUpdate({
      target: [userNavPrefSchema.orgId, userNavPrefSchema.userId],
      set: { pins, updatedAt: new Date() },
    })
    .returning({ pins: userNavPrefSchema.pins, dismissed: userNavPrefSchema.dismissed });
  return { pins: row?.pins ?? pins, dismissed: row?.dismissed ?? [] };
}

/**
 * Remember that a shell prompt (e.g. `invite-card`) was dismissed.
 * @param input
 * @param input.orgId
 * @param input.userId
 * @param input.id
 */
export async function dismissNavPrompt(input: { orgId: string; userId: string; id: string }): Promise<NavPrefs> {
  const [row] = await db
    .insert(userNavPrefSchema)
    .values({ orgId: input.orgId, userId: input.userId, dismissed: [input.id] })
    .onConflictDoUpdate({
      target: [userNavPrefSchema.orgId, userNavPrefSchema.userId],
      set: {
        dismissed: sql`(select jsonb_agg(distinct x) from jsonb_array_elements(${userNavPrefSchema.dismissed} || ${JSON.stringify([input.id])}::jsonb) as t(x))`,
        updatedAt: new Date(),
      },
    })
    .returning({ pins: userNavPrefSchema.pins, dismissed: userNavPrefSchema.dismissed });
  return { pins: row?.pins ?? [], dismissed: row?.dismissed ?? [input.id] };
}

/**
 * When this person last opened this page, or null if they never have.
 *
 * Null is a real answer and callers must treat it as one: "since you last
 * looked" has no meaning for a first visit, and substituting a default window
 * without saying so tells a person their attention was remembered when it was
 * not.
 * @param input
 * @param input.orgId
 * @param input.userId
 * @param input.slug - The page slug.
 */
export async function getPageLastSeen(input: { orgId: string; userId: string; slug: string }): Promise<Date | null> {
  const [row] = await db
    .select({ pageSeen: userNavPrefSchema.pageSeen })
    .from(userNavPrefSchema)
    .where(and(eq(userNavPrefSchema.orgId, input.orgId), eq(userNavPrefSchema.userId, input.userId)))
    .limit(1);
  const raw = row?.pageSeen?.[input.slug];
  if (typeof raw !== 'string') {
    return null;
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Record that this person has now looked at this page, and return the stamp
 * they had BEFORE this visit - which is what the page renders against, so a
 * reload does not empty its own digest.
 * @param input
 * @param input.orgId
 * @param input.userId
 * @param input.slug - The page slug.
 * @param input.at - The moment of this visit.
 */
export async function markPageSeen(input: { orgId: string; userId: string; slug: string; at: Date }): Promise<Date | null> {
  const previous = await getPageLastSeen(input);
  const patch = JSON.stringify({ [input.slug]: input.at.toISOString() });
  await db
    .insert(userNavPrefSchema)
    .values({ orgId: input.orgId, userId: input.userId, pageSeen: { [input.slug]: input.at.toISOString() } })
    .onConflictDoUpdate({
      target: [userNavPrefSchema.orgId, userNavPrefSchema.userId],
      set: {
        pageSeen: sql`${userNavPrefSchema.pageSeen} || ${patch}::jsonb`,
        updatedAt: new Date(),
      },
    });
  return previous;
}
