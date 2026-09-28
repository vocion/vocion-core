/**
 * `conversations.rename` — the one way a person names a thread, from the chat
 * header, the rail and the Conversations list. Org scoped (another
 * workspace's id is not-found and nothing changes) and it marks the title
 * `person`, which is what stops the generator from ever replacing it.
 */
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A factory, not an automock: AuthGuards pulls in next-auth, which does not
// import cleanly in the unit environment.
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { conversationSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { createConversation } = await import('@/services/ConversationService');
const { rename } = await import('./Conversations');

const ORG = 'org_rename_router';
const OTHER = 'org_rename_other';

function signedInTo(orgId: string) {
  vi.mocked(guardAuth).mockResolvedValue({ orgId, userId: 'usr-rename' } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(conversationSchema);
});

describe('conversations.rename', () => {
  it('renames the thread and marks the title person', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'what is up with northwind' });
    signedInTo(ORG);

    const row = await call<{ title: string; titleSource: string }>(rename, { id: conv.id, title: 'Northwind renewal' });

    expect(row.title).toBe('Northwind renewal');
    expect(row.titleSource).toBe('person');
  });

  it('is not-found from another workspace, and the title is untouched', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'Kestrel pipeline' });
    signedInTo(OTHER);

    const rejection = await call(rename, { id: conv.id, title: 'Hijacked' }).catch(err => err);

    expect(rejection).toBeInstanceOf(ORPCError);
    expect((rejection as InstanceType<typeof ORPCError>).code).toBe('not-found');

    const [after] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, conv.id));

    expect(after!.title).toBe('Kestrel pipeline');
    expect(after!.titleSource).toBe('auto');
  });
});
