/**
 * The session version a change to someone's sign-in raises, read back for the
 * session callback; the demo sandbox, where every visitor shares one login,
 * never raises it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userSchema } = await import('@/models/Schema');
const { currentSessionVersion, endOtherSessions } = await import('./sessionVersion');

beforeEach(async () => {
  await db.delete(userSchema);
  await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session versions', () => {
  it('starts at zero and goes up by one per change', async () => {
    expect(await currentSessionVersion('usr-sam')).toBe(0);
    expect(await endOtherSessions('usr-sam')).toBe(1);
    expect(await endOtherSessions('usr-sam')).toBe(2);
    expect(await currentSessionVersion('usr-sam')).toBe(2);
  });

  it('has no version for a person who does not exist', async () => {
    expect(await currentSessionVersion('usr-gone')).toBeNull();
    expect(await endOtherSessions('usr-gone')).toBeNull();
  });

  it('never ends sessions in the demo sandbox, whose proxy cannot tell an ended one from a live one', async () => {
    vi.stubEnv('VOCION_DEMO_SEED_DIR', 'demo-seed');

    expect(await endOtherSessions('usr-sam')).toBeNull();
    expect(await currentSessionVersion('usr-sam')).toBe(0);
  });
});
