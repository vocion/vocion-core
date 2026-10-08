/**
 * The limiter every sign-in, invite, reset, chat and API route goes through.
 * Shared policies count in PGlite (`rate_limit_hit`), local ones in memory;
 * both are exercised here through the same three calls.
 */
import type { RateLimitPolicy } from './policies';
import { eq, like } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { rateLimitHitSchema } = await import('@/models/Schema');
const { clear, describeWait, firstRefusal, hit, peek, resetMemoryRateLimits, tooManyRequests } = await import('./index');

const SHARED: RateLimitPolicy = { name: 'test-shared', limit: 3, windowSeconds: 60, shared: true };
const LOCAL: RateLimitPolicy = { name: 'test-local', limit: 3, windowSeconds: 60, shared: false };

// 10:00:15 inside a 60s window that ends at 10:01:00.
const NOW = new Date('2026-10-07T10:00:15.000Z');

beforeEach(async () => {
  resetMemoryRateLimits();
  await db.delete(rateLimitHitSchema);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ['shared (Postgres)', SHARED],
  ['local (memory)', LOCAL],
])('a %s limit', (_label, policy) => {
  it('allows `limit` attempts and refuses the next with the time left in the window', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await hit(policy, '198.51.100.4', NOW)).toEqual({ allowed: true });
    }

    expect(await hit(policy, '198.51.100.4', NOW)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('counts each subject on its own', async () => {
    for (let i = 0; i < 4; i++) {
      await hit(policy, 'one@northwind.example', NOW);
    }

    expect(await hit(policy, 'two@northwind.example', NOW)).toEqual({ allowed: true });
  });

  it('starts over in the next window', async () => {
    for (let i = 0; i < 4; i++) {
      await hit(policy, '198.51.100.4', NOW);
    }

    expect(await hit(policy, '198.51.100.4', new Date('2026-10-07T10:01:00.000Z'))).toEqual({ allowed: true });
  });

  it('peeks as a lockout: refuses once the count has reached the limit, and counts nothing', async () => {
    await hit(policy, 'sam@northwind.example', NOW);
    await hit(policy, 'sam@northwind.example', NOW);

    expect(await peek(policy, 'sam@northwind.example', NOW)).toEqual({ allowed: true });
    expect(await peek(policy, 'sam@northwind.example', NOW)).toEqual({ allowed: true });

    await hit(policy, 'sam@northwind.example', NOW);

    expect(await peek(policy, 'sam@northwind.example', NOW)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('forgets a subject on clear', async () => {
    for (let i = 0; i < 3; i++) {
      await hit(policy, 'sam@northwind.example', NOW);
    }
    await clear(policy, 'sam@northwind.example');

    expect(await peek(policy, 'sam@northwind.example', NOW)).toEqual({ allowed: true });
  });

  it('treats an email the same in any case', async () => {
    for (let i = 0; i < 3; i++) {
      await hit(policy, 'Sam@Northwind.example', NOW);
    }

    expect(await peek(policy, 'sam@northwind.example', NOW)).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });
});

describe('what the limiter never does', () => {
  it('limits nobody it cannot name: a missing subject is always allowed', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await hit(SHARED, null, NOW)).toEqual({ allowed: true });
    }
  });

  it('stops nothing when VOCION_RATE_LIMIT=off', async () => {
    vi.stubEnv('VOCION_RATE_LIMIT', 'off');
    for (let i = 0; i < 10; i++) {
      expect(await hit(LOCAL, '198.51.100.4', NOW)).toEqual({ allowed: true });
    }
  });

  it('allows the attempt when the store fails, rather than signing everyone out', async () => {
    const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('connection refused');
    });
    try {
      for (let i = 0; i < 5; i++) {
        expect(await hit(SHARED, '198.51.100.4', NOW)).toEqual({ allowed: true });
      }
    } finally {
      insert.mockRestore();
    }
  });

  it('keeps no email or address in the clear', async () => {
    await hit(SHARED, 'sam@northwind.example', NOW);
    const rows = await db.select().from(rateLimitHitSchema).where(like(rateLimitHitSchema.key, 'test-shared:%'));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).not.toContain('northwind');
    expect(rows[0]!.count).toBe(1);
  });

  it('sets each row to expire when its window ends', async () => {
    await hit(SHARED, '198.51.100.4', NOW);
    const [row] = await db.select().from(rateLimitHitSchema).where(eq(rateLimitHitSchema.windowStart, new Date('2026-10-07T10:00:00.000Z')));

    expect(row?.expiresAt.toISOString()).toBe('2026-10-07T10:01:00.000Z');
  });
});

describe('the 429', () => {
  it('carries Retry-After in seconds and says the wait in words', async () => {
    const response = tooManyRequests({ allowed: false, retryAfterSeconds: 240 });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('240');
    await expect(response.json()).resolves.toEqual({
      error: 'Too many attempts. Try again in 4 minutes.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 240,
    });
  });

  it('rounds a wait up, never promising less than the header', () => {
    expect(describeWait(1)).toBe('1 second');
    expect(describeWait(45)).toBe('45 seconds');
    expect(describeWait(61)).toBe('2 minutes');
    expect(describeWait(60)).toBe('1 minute');
  });

  it('picks the first refusal among several verdicts', () => {
    expect(firstRefusal({ allowed: true }, { allowed: false, retryAfterSeconds: 9 }, { allowed: false, retryAfterSeconds: 3 }))
      .toEqual({ allowed: false, retryAfterSeconds: 9 });
    expect(firstRefusal({ allowed: true }, { allowed: true })).toEqual({ allowed: true });
  });
});
