import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rows the mocked database hands back, in the order the route asks for
 * them: first the duplicate-email lookup, then the invite lookup.
 */
let queryResults: unknown[][] = [];

function nextQueryResult() {
  return queryResults.shift() ?? [];
}

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(nextQueryResult()),
        }),
        limit: () => Promise.resolve(nextQueryResult()),
      }),
    }),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/Auth', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
}));

vi.mock('@/models/Schema', () => ({
  accountMembershipSchema: {},
  inviteSchema: { token: 'token', id: 'id' },
  userSchema: { id: 'id', email: 'email' },
}));

const { POST } = await import('./route');

function signupRequest(body: Record<string, unknown>) {
  return new Request('https://example.test/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  queryResults = [];
  vi.clearAllMocks();
});

describe('POST /api/signup', () => {
  it('rejects a signup with no invite token, even on an instance with no users', async () => {
    // Both lookups would come back empty — the old first-run branch would
    // have read that as "nobody here yet" and minted an admin.
    queryResults = [[], []];

    const res = await POST(signupRequest({
      name: 'Squatter',
      email: 'squatter@example.test',
      password: 'password123',
      accountName: 'Claimed',
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'An invite token is required to create an account.' });
  });

  it('rejects an unparseable body', async () => {
    const res = await POST(new Request('https://example.test/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }));

    expect(res.status).toBe(403);
  });

  it('refuses to make a second user for an email that already has a login, and tells the form to send them to sign in', async () => {
    queryResults = [[{ id: 'usr-existing' }]];

    const res = await POST(signupRequest({
      name: 'Someone',
      email: 'taken@example.test',
      password: 'password123',
      inviteToken: 'tok-1',
    }));

    expect(res.status).toBe(409);
    // The form turns this into "sign in to accept", which joins the account
    // on the existing user (`/api/invites/accept`).
    await expect(res.json()).resolves.toMatchObject({ code: 'EXISTING_USER' });
  });

  it('rejects an invite token that does not exist', async () => {
    queryResults = [[], []];

    const res = await POST(signupRequest({
      name: 'Someone',
      email: 'someone@example.test',
      password: 'password123',
      inviteToken: 'tok-unknown',
    }));

    expect(res.status).toBe(404);
  });

  it('rejects an invite already accepted', async () => {
    queryResults = [[], [{ id: 'inv-1', token: 'tok-1', acceptedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), email: 'someone@example.test', accountId: 'acct-1', role: 'member' }]];

    const res = await POST(signupRequest({
      name: 'Someone',
      email: 'someone@example.test',
      password: 'password123',
      inviteToken: 'tok-1',
    }));

    expect(res.status).toBe(410);
  });

  it('rejects an expired invite', async () => {
    queryResults = [[], [{ id: 'inv-1', token: 'tok-1', acceptedAt: null, expiresAt: new Date(Date.now() - 60_000), email: 'someone@example.test', accountId: 'acct-1', role: 'member' }]];

    const res = await POST(signupRequest({
      name: 'Someone',
      email: 'someone@example.test',
      password: 'password123',
      inviteToken: 'tok-1',
    }));

    expect(res.status).toBe(410);
  });

  it('rejects an invite issued for a different email', async () => {
    queryResults = [[], [{ id: 'inv-1', token: 'tok-1', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000), email: 'invited@example.test', accountId: 'acct-1', role: 'member' }]];

    const res = await POST(signupRequest({
      name: 'Someone',
      email: 'someone-else@example.test',
      password: 'password123',
      inviteToken: 'tok-1',
    }));

    expect(res.status).toBe(403);
  });

  it('refuses to make a login for an operator address, even with a valid invite for it', async () => {
    // A client admin can invite any address and follow the link themselves.
    // An operator's login is made on the instance, so a listed address that
    // has no login yet must not be claimable that way.
    const previous = process.env.VOCION_OPERATOR_EMAILS;
    process.env.VOCION_OPERATOR_EMAILS = 'ops@northwind.example';
    queryResults = [[], [{ id: 'inv-1', token: 'tok-1', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000), email: 'ops@northwind.example', accountId: 'acct-kestrel', role: 'admin' }]];
    try {
      const { db } = await import('@/libs/DB');
      const res = await POST(signupRequest({
        name: 'Claimant',
        email: 'OPS@northwind.example',
        password: 'password123',
        inviteToken: 'tok-1',
      }));

      expect(res.status).toBe(403);
      expect(db.transaction).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.VOCION_OPERATOR_EMAILS;
      } else {
        process.env.VOCION_OPERATOR_EMAILS = previous;
      }
    }
  });

  it('creates the user and consumes the invite when everything matches', async () => {
    queryResults = [[], [{ id: 'inv-1', token: 'tok-1', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000), email: 'invited@example.test', accountId: 'acct-1', role: 'admin' }]];

    const inserted: unknown[] = [];
    const updated: unknown[] = [];
    const { db } = await import('@/libs/DB');
    function recordInsert(row: unknown) {
      inserted.push(row);
      return Promise.resolve();
    }
    function recordUpdate(row: unknown) {
      updated.push(row);
      return Promise.resolve();
    }
    vi.mocked(db.transaction).mockImplementation(async (run: any) => run({
      insert: () => ({ values: recordInsert }),
      update: () => ({ set: (row: unknown) => ({ where: () => recordUpdate(row) }) }),
    }));

    const res = await POST(signupRequest({
      name: 'Invited',
      email: 'invited@example.test',
      password: 'password123',
      inviteToken: 'tok-1',
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, mode: 'invite-accept' });
    expect(inserted).toHaveLength(2);
    expect(updated[0]).toMatchObject({ acceptedAt: expect.any(Date) });
  });
});
