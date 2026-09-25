/**
 * The person pressing Stop has to reach the server (#114).
 *
 * An aborted fetch looks exactly like a locked phone, and those two must end
 * differently: a dropped connection leaves the run going so the person can
 * come back to it, while a stop means the short answer stored against the turn
 * was a choice. This route is how the client says which one happened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { openStream, wasStopped } = await import('@/libs/streams/buffer');
const { POST } = await import('./route');

const signedIn = { userId: 'usr-1', orgId: 'org-1', accountId: null, projectId: 'org-1', role: 'admin' as const, workspaceRole: 'owner' as const, has: () => true };

/**
 * Post a stop for one stream id.
 * @param body - What the client sends.
 */
async function postStop(body: unknown) {
  const res = await POST(new Request('http://localhost/rpc/agent/stream/stop', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as { marked?: boolean; error?: string } };
}

beforeEach(() => {
  vi.mocked(clerkAuth).mockResolvedValue(signedIn);
});

const OWNER = { orgId: 'org-1', userId: 'usr-1' };
const SOMEONE_ELSE = { ...signedIn, orgId: 'org-2', projectId: 'org-2', userId: 'usr-2' };

describe('agent stream stop route', () => {
  it('marks a running turn as stopped, so the row it writes says the person chose to end it', async () => {
    openStream('stream-running', OWNER);

    const res = await postStop({ stream_id: 'stream-running' });

    expect(res.json.marked).toBe(true);
    expect(wasStopped('stream-running')).toBe(true);
  });

  it('leaves every other turn alone', async () => {
    openStream('stream-a', OWNER);
    openStream('stream-b', OWNER);

    await postStop({ stream_id: 'stream-a' });

    expect(wasStopped('stream-b')).toBe(false);
  });

  it('answers calmly when the turn already finished — the intent just arrived too late', async () => {
    const res = await postStop({ stream_id: 'stream-long-gone' });

    expect(res.status).toBe(200);
    expect(res.json.marked).toBe(false);
  });

  it('refuses a call with no stream id rather than guessing which turn was meant', async () => {
    const res = await postStop({});

    expect(res.status).toBe(400);
  });

  it('will not let one person end another person\'s turn, however they came by the stream id', async () => {
    openStream('stream-someone-elses', OWNER);
    vi.mocked(clerkAuth).mockResolvedValue(SOMEONE_ELSE as never);

    const res = await postStop({ stream_id: 'stream-someone-elses' });

    expect(res.json.marked).toBe(false);
    expect(wasStopped('stream-someone-elses')).toBe(false);
    // Answered exactly like an unknown id: a caller never learns whether a
    // given stream belongs to somebody.
    expect(res.status).toBe(200);
  });

  it('refuses a signed-out caller, who has no turn here to stop', async () => {
    vi.mocked(clerkAuth).mockResolvedValue({ ...signedIn, userId: null, orgId: null } as never);

    const res = await postStop({ stream_id: 'stream-running' });

    expect(res.status).toBe(401);
  });
});
