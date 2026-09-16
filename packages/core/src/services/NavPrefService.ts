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

/** Replace the pin list (deduped, capped). Returns the stored prefs. */
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

/** Remember that a shell prompt (e.g. `invite-card`) was dismissed. */
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
