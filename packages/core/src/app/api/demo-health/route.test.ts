import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The boot check is unauthenticated, so it says nothing about the
 * installation: on a host serving several companies, a user count or the
 * process's working directory is a fact about all of them.
 */

vi.mock('@/libs/DB', () => ({ db: { execute: vi.fn(async () => ({ rows: [{ n: 1 }] })) } }));

const { GET } = await import('./route');

const priorSeed = process.env.VOCION_DEMO_SEED_DIR;

afterEach(() => {
  if (priorSeed === undefined) {
    delete process.env.VOCION_DEMO_SEED_DIR;
  } else {
    process.env.VOCION_DEMO_SEED_DIR = priorSeed;
  }
});

describe('GET /api/demo-health', () => {
  it('answers 200 with whether the database answered, and nothing about the installation', async () => {
    delete process.env.VOCION_DEMO_SEED_DIR;
    const res = await GET();
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, db: 'ok' });
    expect(JSON.stringify(body)).not.toContain(process.cwd());
  });

  it('adds the seed diagnostics only on a demo sandbox, and still no user count', async () => {
    process.env.VOCION_DEMO_SEED_DIR = 'demo/seed';
    const body = await (await GET()).json() as Record<string, unknown>;

    expect(body).toMatchObject({ ok: true, db: 'ok' });
    expect(body.seed).toBeDefined();
    expect(body).not.toHaveProperty('userCount');
  });
});
