/**
 * `POST /api/v1/feedback` — the contract an app with its own review screen
 * builds against. What matters here is what the route lets onto the queue:
 * a note, a list of field corrections, or both, and never a correction list
 * the worker would have to guess at.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { feedbackJobSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_feedback_route';

const CATEGORY_EDIT = { field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Live Music', 'Food & Drink'] };

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function post(body: unknown): Request {
  return new Request('https://vocion.test/api/v1/feedback', {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * The status and error message a refused body gets.
 * @param body - The request body to post.
 */
async function refusal(body: unknown): Promise<{ status: number; message: string }> {
  const res = await POST(post(body));
  const json = await res.json() as { error?: { message?: string }; message?: string };
  return { status: res.status, message: json.error?.message ?? json.message ?? JSON.stringify(json) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(feedbackJobSchema);
});

afterAll(async () => {
  await db.delete(feedbackJobSchema);
});

describe('POST /api/v1/feedback', () => {
  it('queues corrections a reviewer made without writing a note', async () => {
    const res = await POST(post({
      externalId: 'review:42',
      payload: { text: '', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction', quotedText: 'title: "Harbor Jazz Brunch"' },
    }));

    expect(res.status).toBe(200);

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.payload).toEqual({
      text: '',
      edits: [CATEGORY_EDIT],
      targetSlug: 'event-extraction',
      quotedText: 'title: "Harbor Jazz Brunch"',
    });
  });

  it('stores a note-only payload as it always has, with no empty corrections list', async () => {
    await POST(post({ externalId: 'review:43', payload: { text: 'Always cite the source line.' } }));

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.payload).toEqual({ text: 'Always cite the source line.' });
  });

  it('still refuses feedback with neither a note nor a correction', async () => {
    expect(await refusal({ payload: { text: '   ' } })).toEqual({
      status: 400,
      message: 'payload.text is required unless payload.edits carries a correction',
    });
    expect((await refusal({ payload: { text: '', edits: [] } })).status).toBe(400);
  });

  it('refuses a corrections list the worker could not read, naming the bad entry', async () => {
    expect(await refusal({ payload: { text: 'x', edits: { categories: 'Food & Drink' } } })).toMatchObject({
      status: 400,
      message: expect.stringContaining('must be an array'),
    });
    expect(await refusal({ payload: { text: 'x', edits: [CATEGORY_EDIT, { before: 1, after: 2 }] } })).toMatchObject({
      status: 400,
      message: expect.stringContaining('payload.edits[1]'),
    });
    expect(await db.select().from(feedbackJobSchema)).toHaveLength(0);
  });

  it('refuses a note that is not text, even alongside corrections', async () => {
    expect(await refusal({ payload: { text: 42, edits: [CATEGORY_EDIT] } })).toEqual({
      status: 400,
      message: 'payload.text must be a string',
    });
  });
});
