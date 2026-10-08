/**
 * Where rate-limit counters live. Two implementations of one small interface:
 *
 * - `postgresRateLimitStore` — one upsert per hit on `rate_limit_hit` (0175).
 *   Every app instance reads the same number, and a lockout survives a restart,
 *   so it is the store for limits that guard a secret.
 * - `memoryRateLimitStore` — a Map in this process. Free, and per instance:
 *   right for throughput limits, where "N per minute per container" is the
 *   intent and a database write per chat turn would cost more than it saves.
 *
 * Counters are fixed windows: a key's count resets when its window ends.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { rateLimitHitSchema } from '@/models/Schema';

export type RateLimitStore = {
  /**
   * Add one to `key` in the window that starts at `windowStart`, and return
   * the count after adding.
   */
  hit: (key: string, windowStart: Date, expiresAt: Date) => Promise<number>;
  /** The count for `key` in that window, unchanged. Zero when there is none. */
  count: (key: string, windowStart: Date, now: Date) => Promise<number>;
  /** Forget `key` in every window — a successful sign-in clears its failures. */
  clear: (key: string) => Promise<void>;
};

/** Sweep expired rows on roughly one hit in this many. */
const SWEEP_ONE_IN = 200;

export function postgresRateLimitStore(): RateLimitStore {
  return {
    async hit(key, windowStart, expiresAt) {
      const [row] = await db
        .insert(rateLimitHitSchema)
        .values({ key, windowStart, count: 1, expiresAt })
        .onConflictDoUpdate({
          target: [rateLimitHitSchema.key, rateLimitHitSchema.windowStart],
          set: { count: sql`${rateLimitHitSchema.count} + 1` },
        })
        .returning({ count: rateLimitHitSchema.count });
      if (Math.random() * SWEEP_ONE_IN < 1) {
        // Rows whose window ended before this one began. Fire-and-forget: a
        // sweep that fails costs a few stale rows, never a request.
        void db.delete(rateLimitHitSchema).where(lt(rateLimitHitSchema.expiresAt, windowStart)).catch(() => {});
      }
      return row?.count ?? 1;
    },
    async count(key, windowStart) {
      const [row] = await db
        .select({ count: rateLimitHitSchema.count })
        .from(rateLimitHitSchema)
        .where(and(eq(rateLimitHitSchema.key, key), eq(rateLimitHitSchema.windowStart, windowStart)))
        .limit(1);
      return row?.count ?? 0;
    },
    async clear(key) {
      await db.delete(rateLimitHitSchema).where(eq(rateLimitHitSchema.key, key));
    },
  };
}

type MemoryEntry = { count: number; expiresAt: number };

/** Above this many live entries, a hit sweeps the expired ones first. */
const MEMORY_SWEEP_SIZE = 10_000;

export function memoryRateLimitStore(): RateLimitStore & { reset: () => void } {
  const entries = new Map<string, MemoryEntry>();
  const slot = (key: string, windowStart: Date) => `${key}|${windowStart.getTime()}`;
  const sweep = (now: number) => {
    for (const [k, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(k);
      }
    }
  };
  return {
    async hit(key, windowStart, expiresAt) {
      if (entries.size > MEMORY_SWEEP_SIZE) {
        sweep(Date.now());
      }
      const k = slot(key, windowStart);
      const entry = entries.get(k) ?? { count: 0, expiresAt: expiresAt.getTime() };
      entry.count += 1;
      entries.set(k, entry);
      return entry.count;
    },
    async count(key, windowStart, now) {
      const entry = entries.get(slot(key, windowStart));
      return entry && entry.expiresAt > now.getTime() ? entry.count : 0;
    },
    async clear(key) {
      const prefix = `${key}|`;
      for (const k of entries.keys()) {
        if (k.startsWith(prefix)) {
          entries.delete(k);
        }
      }
    },
    reset() {
      entries.clear();
    },
  };
}
