/**
 * The body readers the learning-candidate write routes share: who a decision
 * is recorded against, and the bounded free-text fields. A tenant token acts
 * for a person in another system (a client's admin panel), so it may name
 * that person; a dashboard session is the person and may not name anyone else.
 */
import type { ApiCaller } from '@/services/writeApi';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The API's shared helpers pull in the session; nothing here signs in.
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn(), auth: vi.fn() }));

const { isErrorResponse } = await import('../_shared');
const { readActorOverride, readBoundedText } = await import('./_lib');

const ORG = 'proj-larkfield';

/**
 * A caller as `authApi` returns it.
 * @param source - How the caller authenticated.
 */
function caller(source: 'token' | 'session'): ApiCaller {
  const id = source === 'token' ? 'token:t1' : 'u_drew';
  return { orgId: ORG, actorId: id, source, principal: { kind: 'user', id, role: 'admin', scope: { orgId: ORG } } };
}

/**
 * The error body a reader answered with.
 * @param value - What the reader returned.
 */
async function errorOf(value: unknown) {
  expect(isErrorResponse(value)).toBe(true);

  const res = value as Response;

  expect(res.status).toBe(400);

  return (await res.json()).error as { code: string; message: string };
}

describe('readActorOverride', () => {
  it('records the caller itself when the body names nobody', () => {
    expect(readActorOverride({}, 'undoneBy', caller('token'))).toBe('token:t1');
    expect(readActorOverride({ undoneBy: null }, 'undoneBy', caller('session'))).toBe('u_drew');
  });

  it('lets a token name the person it acts for, trimmed', () => {
    expect(readActorOverride({ undoneBy: '  larkfield-admin:7 ' }, 'undoneBy', caller('token'))).toBe('larkfield-admin:7');
  });

  it('refuses a session naming someone else — the session is the person', async () => {
    const error = await errorOf(readActorOverride({ decidedBy: 'larkfield-admin:7' }, 'decidedBy', caller('session')));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('decidedBy may only be set by a tenant token');
  });

  it('refuses a blank, an over-long or a non-string name', async () => {
    for (const bad of ['   ', 'x'.repeat(201), 42]) {
      const error = await errorOf(readActorOverride({ undoneBy: bad }, 'undoneBy', caller('token')));

      expect(error.message).toBe('undoneBy must be 1–200 characters');
    }
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(readActorOverride({ undoneBy: 'x'.repeat(200) }, 'undoneBy', caller('token'))).toBe('x'.repeat(200));
  });
});

describe('readBoundedText', () => {
  it('reads an absent or blank field as not given', () => {
    expect(readBoundedText({}, 'reason', 500)).toBeUndefined();
    expect(readBoundedText({ reason: null }, 'reason', 500)).toBeUndefined();
    expect(readBoundedText({ reason: '   ' }, 'reason', 500)).toBeUndefined();
  });

  it('returns the text trimmed, up to the cap', () => {
    expect(readBoundedText({ reason: '  Too broad. ' }, 'reason', 500)).toBe('Too broad.');
    expect(readBoundedText({ reason: 'x'.repeat(500) }, 'reason', 500)).toBe('x'.repeat(500));
  });

  it('refuses text past the cap, counted after trimming', async () => {
    const error = await errorOf(readBoundedText({ reason: `  ${'x'.repeat(501)}  ` }, 'reason', 500));

    expect(error.message).toBe('reason must be at most 500 characters');
  });

  it('refuses a value that is not text', async () => {
    const error = await errorOf(readBoundedText({ reason: ['Too broad'] }, 'reason', 500));

    expect(error.message).toBe('reason must be a string');
  });
});
