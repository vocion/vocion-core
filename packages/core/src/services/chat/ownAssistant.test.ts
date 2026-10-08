/**
 * A shared text number, against PGlite: a text is routed by WHO sent it to
 * that person's own assistant in their personal workspace, an unknown number
 * is told how to become known and runs nothing, a person with no assistant yet
 * is told so, a reply that decides a waiting card still decides it (as the
 * sender, inside their own workspace), and a number bound to one workspace
 * still answers as that workspace's agent. Every number here is in the
 * reserved, undialable 555 exchange.
 */
import type { ChatInbound, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq, inArray } = await import('drizzle-orm');
const { accountMembershipSchema, chatChannelBindingSchema, conversationMessageSchema, conversationSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject, findPersonalProject } = await import('@/services/workspace/personalProject');
const svc = await import('@/services/ChatSurfaceService');
const { approvalFromThread } = await import('./slackApproval');
const { channelBySurface } = await import('./channels');
const { routeToOwnAssistant, routesBySender, SENDERS_OWN_ASSISTANT } = await import('./ownAssistant');

const NORTHWIND = 'acct-own-northwind';
const FACTORY = 'proj-own-factory';
const RILEY = 'usr-own-riley';
const SAM = 'usr-own-sam';

const SHARED = '+19705550100';
const FACTORY_NUMBER = '+19705550200';
const RILEY_PHONE = '+19705550101';
const SAM_PHONE = '+19705550102';
const STRANGER = '+19705550199';

type Reply = { channelId: string; threadRef?: string; text: string };

function smsAdapter(): ChatSurfaceAdapter & { replies: Reply[] } {
  const replies: Reply[] = [];
  return {
    id: 'sms',
    replies,
    verify: () => ({ ok: true }),
    parse: () => ({ kind: 'ignore', reason: 'n/a' }),
    reply: async (target, message) => {
      replies.push({ channelId: target.channelId, ...(target.threadRef ? { threadRef: target.threadRef } : {}), text: typeof message === 'string' ? message : message.text });
      return { channelId: target.channelId, ts: `SM${replies.length}`, media: 'none' as const };
    },
  };
}

const text = (from: string, to: string, words: string): ChatInbound => ({ surface: 'sms', teamId: null, channelId: to, threadRef: from, messageRef: `SM-${from}-${words.length}`, externalUserId: from, text: words, isDirect: true });

const ok = vi.fn(async () => ({ ok: true as const }));

let rileyPersonal: string;

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(chatChannelBindingSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema).where(eq(projectSchema.accountId, NORTHWIND));
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.accountId, NORTHWIND));
  await db.delete(userSchema).where(inArray(userSchema.id, [RILEY, SAM]));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, NORTHWIND));

  await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind' });
  await db.insert(userSchema).values([
    { id: RILEY, email: 'riley@northwind.example', name: 'Riley', phone: RILEY_PHONE },
    { id: SAM, email: 'sam@northwind.example', name: 'Sam', phone: SAM_PHONE },
  ]);
  await db.insert(accountMembershipSchema).values([{ accountId: NORTHWIND, userId: RILEY, role: 'member' }, { accountId: NORTHWIND, userId: SAM, role: 'member' }]);
  await db.insert(projectSchema).values({ id: FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Northwind Factory', leadAgentSlug: 'factory-lead' });
  rileyPersonal = (await ensurePersonalProject(RILEY, NORTHWIND)).id;
  // Riley's assistant leads Riley's own workspace; Sam has not set one up yet.
  await db.update(projectSchema).set({ leadAgentSlug: 'assistant' }).where(eq(projectSchema.id, rileyPersonal));

  await svc.createBinding({ orgId: FACTORY, surface: 'sms', channelId: SHARED, agentSlug: SENDERS_OWN_ASSISTANT });
  await svc.createBinding({ orgId: FACTORY, surface: 'sms', channelId: FACTORY_NUMBER, agentSlug: 'factory-lead' });
});

describe('a shared number', () => {
  it('answers each sender with their own assistant, in their own workspace, one conversation per sender', async () => {
    const adapter = smsAdapter();
    const runAgent = vi.fn(async () => ({ response: 'Two things are waiting on you.', traceId: 't', toolCalls: [] }));

    const out = await svc.handleInbound(adapter, text(RILEY_PHONE, SHARED, 'what is on my plate?'), { runAgent: runAgent as never, preflight: ok });

    expect(out).toMatchObject({ outcome: 'replied', orgId: rileyPersonal, agentSlug: 'assistant' });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ orgId: rileyPersonal, agentSlug: 'assistant', userId: `sms:${RILEY_PHONE}` }));
    // The answer goes back from the shared number to the sender.
    expect(adapter.replies).toEqual([{ channelId: SHARED, threadRef: RILEY_PHONE, text: 'Two things are waiting on you.' }]);

    const [conversation] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, rileyPersonal));

    expect(conversation).toMatchObject({ scopeRef: `sms:${SHARED}:${RILEY_PHONE}`, agentSlug: 'assistant', createdBy: `sms:${RILEY_PHONE}` });
    // Nothing landed in the workspace the number was bound in.
    expect(await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, FACTORY))).toEqual([]);
  });

  // 5.0.1 review: a text gets the turn's words and nothing else, so its turn
  // is never told that its surface draws cards. A tool that brings back a
  // proposal (`ask_workspace`) then gives the person its link as written
  // instead of saying a card is waiting in a thread they cannot see.
  it('runs the turn as one whose surface draws no cards', async () => {
    const runAgent = vi.fn(async (_opts: { rendersCards?: boolean }) => ({ response: 'Two things are waiting on you.', traceId: 't', toolCalls: [] }));

    await svc.handleInbound(smsAdapter(), text(RILEY_PHONE, SHARED, 'what is on my plate?'), { runAgent: runAgent as never, preflight: ok });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]![0].rendersCards).toBeUndefined();
  });

  it('makes a sender\'s personal workspace, with its assistant, when it is not there yet', async () => {
    const adapter = smsAdapter();
    const runAgent = vi.fn(async () => ({ response: 'Nothing is waiting on you.', traceId: 't', toolCalls: [] }));

    expect(await findPersonalProject(SAM, NORTHWIND)).toBeNull();

    const out = await svc.handleInbound(adapter, text(SAM_PHONE, SHARED, 'anything for me?'), { runAgent: runAgent as never, preflight: ok });
    const sams = await findPersonalProject(SAM, NORTHWIND);

    expect(sams).not.toBeNull();
    expect(out).toMatchObject({ outcome: 'replied', orgId: sams!.id, agentSlug: 'assistant' });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ orgId: sams!.id, agentSlug: 'assistant' }));
  });

  it('runs nothing for a number Vocion does not know, and says how to become known', async () => {
    const adapter = smsAdapter();
    const runAgent = vi.fn();

    const out = await svc.handleInbound(adapter, text(STRANGER, SHARED, 'hello?'), { runAgent: runAgent as never, preflight: ok });

    expect(out).toEqual({ outcome: 'not_routed', why: 'unknown_sender' });
    expect(runAgent).not.toHaveBeenCalled();
    expect(adapter.replies[0]).toMatchObject({ channelId: SHARED, threadRef: STRANGER });
    expect(adapter.replies[0]!.text).toContain(channelBySurface('sms')!.signInHint(null));
  });

  it('decides a card waiting in the sender\'s own thread by their reply, as them, inside their own workspace', async () => {
    const adapter = smsAdapter();
    const decide = vi.fn(async () => ({ ok: true, what: 'Sent.' }));
    const pending = vi.fn(async () => [{ runId: 41, actionId: 'mail.send', input: {}, title: 'Send the Kestrel Capital follow-up' }]);
    const runAgent = vi.fn();
    const approval = (orgId: string, inbound: ChatInbound, conversationId: number) => approvalFromThread(orgId, inbound, conversationId, {
      pending,
      decisionSentence: async () => 'approve sending the follow-up',
      consent: async () => ({ said: true, quote: 'yes send it' }),
      // The real medium: the sender's number, resolved inside the personal workspace's account.
      member: async (o, id, surface) => channelBySurface(surface)!.memberOf(o, id),
      signInHint: () => 'a number',
      decide,
    });

    const out = await svc.handleInbound(adapter, text(RILEY_PHONE, SHARED, 'yes send it'), { runAgent: runAgent as never, preflight: ok, approval });

    expect(out).toMatchObject({ outcome: 'replied', orgId: rileyPersonal });
    expect(pending).toHaveBeenCalledWith(rileyPersonal, expect.any(Number));
    expect(decide).toHaveBeenCalledWith(rileyPersonal, 41, 'approve', RILEY, 'yes send it');
    expect(runAgent).not.toHaveBeenCalled();
    expect(adapter.replies.at(-1)!.text).toBe('Approved by Riley: "Send the Kestrel Capital follow-up". Sent.');
  });
});

describe('a number bound to one workspace', () => {
  it('still answers as that workspace\'s agent, whoever texts it', async () => {
    const adapter = smsAdapter();
    const runAgent = vi.fn(async () => ({ response: 'The line is running.', traceId: 't', toolCalls: [] }));

    const out = await svc.handleInbound(adapter, text(RILEY_PHONE, FACTORY_NUMBER, 'how is the line?'), { runAgent: runAgent as never, preflight: ok });

    expect(out).toMatchObject({ outcome: 'replied', orgId: FACTORY, agentSlug: 'factory-lead' });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ orgId: FACTORY, agentSlug: 'factory-lead' }));
  });
});

describe('routeToOwnAssistant', () => {
  it('routes by the sender, not by the binding', async () => {
    expect(routesBySender({ agentSlug: SENDERS_OWN_ASSISTANT })).toBe(true);
    expect(routesBySender({ agentSlug: 'factory-lead' })).toBe(false);

    const route = await routeToOwnAssistant({ orgId: FACTORY }, { surface: 'sms', externalUserId: RILEY_PHONE, text: 'hi' });

    expect(route).toMatchObject({ routed: 'sender', orgId: rileyPersonal, agentSlug: 'assistant', userId: RILEY });
  });

  it('falls back to the workspace\'s own router when nobody leads it', async () => {
    const pick = vi.fn(async () => 'notes-keeper');

    // The personal workspace as found, with no lead: making it again would put the assistant back.
    const route = await routeToOwnAssistant({ orgId: FACTORY }, { surface: 'sms', externalUserId: RILEY_PHONE, text: 'remember this' }, defaultsWith({ pick, personal: async () => ({ id: rileyPersonal }) as never, lead: async () => null }));

    expect(pick).toHaveBeenCalledWith(rileyPersonal, 'remember this', 'sms');
    expect(route).toMatchObject({ routed: 'sender', agentSlug: 'notes-keeper' });
  });

  it('says so in one line when nothing in the personal workspace can answer', async () => {
    const route = await routeToOwnAssistant({ orgId: FACTORY }, { surface: 'sms', externalUserId: RILEY_PHONE, text: 'hi' }, defaultsWith({ pick: async () => null, personal: async () => ({ id: rileyPersonal }) as never, lead: async () => null }));

    expect(route).toMatchObject({ routed: null, why: 'no_assistant' });
  });
});

/**
 * The real seams, with some replaced.
 * @param over - The seams to replace.
 */
function defaultsWith(over: Partial<import('./ownAssistant').OwnAssistantDeps>): import('./ownAssistant').OwnAssistantDeps {
  return {
    member: async (orgId, surface, id) => channelBySurface(surface)!.memberOf(orgId, id),
    signInHint: async surface => channelBySurface(surface)!.signInHint(null),
    accountOf: async (orgId) => {
      const [row] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
      return row?.accountId ?? null;
    },
    personal: (userId, accountId) => ensurePersonalProject(userId, accountId),
    lead: async (orgId) => {
      const [row] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
      return row?.lead ?? null;
    },
    pick: async () => null,
    ...over,
  };
}
