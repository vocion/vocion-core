/**
 * A dropped turn is resumable by the person whose turn it is — and nobody else.
 *
 * The buffer holds the whole text of somebody's conversation, replayed to
 * whoever attaches with the right id. A v4 UUID is hard to guess, but hard to
 * guess is not a permission: ids travel in logs, screenshots and bug reports.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { openStream } = await import('@/libs/streams/buffer');
const { GET } = await import('./route');

const OWNER = { orgId: 'org-1', userId: 'usr-1' };
const signedIn = { ...OWNER, accountId: null, projectId: 'org-1', role: 'admin' as const, workspaceRole: 'owner' as const, has: () => true };

/**
 * Attach to a stream and read whatever it replays before it closes.
 * @param id - The stream id to resume.
 */
async function resume(id: string): Promise<{ status: number; body: string }> {
  const res = await GET(new Request(`http://localhost/rpc/agent/stream/resume?id=${id}&after=0`));
  const body = res.body ? await new Response(res.body).text() : '';
  return { status: res.status, body };
}

beforeEach(() => {
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
});

describe('agent stream resume route', () => {
  it('replays the turn to the person it belongs to', async () => {
    const stream = openStream('resume-mine', OWNER);
    stream.append(JSON.stringify({ type: 'response_delta', delta: 'Four deals closed' }));
    stream.close();

    const res = await resume('resume-mine');

    expect(res.status).toBe(200);
    expect(res.body).toContain('Four deals closed');
  });

  it('replays nothing of somebody else\'s turn, however they came by the id', async () => {
    const stream = openStream('resume-theirs', OWNER);
    stream.append(JSON.stringify({ type: 'response_delta', delta: 'Northwind renews in March' }));
    stream.close();
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, orgId: 'org-2', projectId: 'org-2', userId: 'usr-2' } as never);

    const res = await resume('resume-theirs');

    // Not one token of the other org's conversation — and the same 404 an id
    // that never existed gets, so this is not a way to test ids for existence.
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Northwind');
    expect(res.body).not.toContain('response_delta');
  });

  it('says the same thing about a stream that never existed', async () => {
    const res = await resume('resume-never-was');

    expect(res.status).toBe(404);
  });

  it('refuses a signed-out caller', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, userId: null, orgId: null } as never);

    const res = await resume('resume-mine');

    expect(res.status).toBe(401);
  });
});
