import type { EmailInboundMeta, ReceivedEmail } from '@/libs/surfaces/email';
import type { EmailHandlerDeps } from '@/services/EmailSurfaceService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentSchema, askSchema, conversationMessageSchema, conversationSchema, emailThreadSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const svc = await import('@/services/EmailSurfaceService');
const { workspaceFrom } = await import('@/services/mail/workspaceFrom');

const ORG = 'proj-revenue-test';
const ACCT = 'acct-test';
const ADDRESS = 'revenue@agents.example.com';

async function seed(opts: { mailbox?: boolean; lead?: string | null } = {}): Promise<void> {
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'Test', slug: 'test' } as never).onConflictDoNothing();
  await db.insert(projectSchema).values({
    id: ORG,
    accountId: ACCT,
    slug: 'revenue',
    name: 'Revenue Team',
    leadAgentSlug: opts.lead === undefined ? 'revenue-director' : opts.lead,
    mailboxAddress: opts.mailbox === false ? null : ADDRESS,
    mailboxEnabled: opts.mailbox !== false,
  } as never);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'revenue-director', name: 'Revenue Director', systemPrompt: 'test' });
  await db.insert(userSchema).values({ id: 'usr-chris', name: 'Chris', email: 'chris@example.com' } as never);
  await db.insert(accountMembershipSchema).values({ accountId: ACCT, userId: 'usr-chris', role: 'admin' });
}

function meta(over: Partial<EmailInboundMeta> = {}): EmailInboundMeta {
  return {
    surface: 'email',
    receivedEmailId: 'rcv-1',
    from: 'chris@example.com',
    fromRaw: 'Chris <chris@example.com>',
    recipients: [ADDRESS],
    subject: 'Q4 pipeline',
    messageId: 'm1@example.com',
    attachments: [],
    ...over,
  };
}

function deps(over: Partial<EmailHandlerDeps> & { email?: Partial<ReceivedEmail> } = {}) {
  const sent: Parameters<EmailHandlerDeps['send']>[0][] = [];
  const runs: string[] = [];
  const d: EmailHandlerDeps & { sent: typeof sent; runs: string[] } = {
    sent,
    runs,
    runAgent: vi.fn(async (opts: { message: string }) => {
      runs.push(opts.message);
      return { response: 'Pushed to Sep 30. Anything else?' } as never;
    }) as never,
    preflight: vi.fn(async () => ({ ok: true })) as never,
    fetchEmail: async id => ({ id, from: 'Chris <chris@example.com>', to: [ADDRESS], subject: 'Q4 pipeline', text: 'Can you push the close date?\n\nOn Mon wrote:\n> old', html: null, headers: {}, message_id: '<m1@example.com>', ...over.email }),
    send: vi.fn(async (m) => {
      sent.push(m);
      return { skipped: false, provider: 'resend', id: `sent-${sent.length}` } as const;
    }) as never,
    ...over,
  };
  return d;
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.VOCION_MAIL_ENABLED = '1';
  process.env.VOCION_MAIL_DOMAIN = 'agents.example.com';
  await db.delete(emailThreadSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(askSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
});

describe('address helpers', () => {
  it('derives the default address and refuses one off the domain', () => {
    expect(svc.defaultMailboxAddress('Revenue', 'agents.example.com')).toBe('revenue@agents.example.com');
    expect(svc.addressOnDomain('x@agents.example.com', 'agents.example.com')).toBe(true);
    expect(svc.addressOnDomain('x@evil.example.com', 'agents.example.com')).toBe(false);
    expect(svc.mailboxFrom({ projectName: 'Revenue <Team>', address: ADDRESS })).toBe(`Revenue Team <${ADDRESS}>`);
  });
});

describe('resolveMailbox', () => {
  it('finds an enabled mailbox case-insensitively, and nothing for a disabled or unknown one', async () => {
    await seed();

    expect((await svc.resolveMailbox('REVENUE@agents.example.com'))?.orgId).toBe(ORG);
    expect(await svc.resolveMailbox('other@agents.example.com')).toBeNull();

    await db.update(projectSchema).set({ mailboxEnabled: false });

    expect(await svc.resolveMailbox(ADDRESS)).toBeNull();
    expect(await workspaceFrom(ORG)).toBeUndefined();
  });

  it('workspaceFrom wears the workspace name and address when enabled', async () => {
    await seed();

    expect(await workspaceFrom(ORG)).toBe(`Revenue Team <${ADDRESS}>`);
  });
});

describe('handleInboundEmail', () => {
  it('runs the workspace lead for a known sender and replies by mail with threading headers', async () => {
    await seed();
    const d = deps();
    const out = await svc.handleInboundEmail(meta(), d);

    expect(out.outcome).toBe('replied');

    if (out.outcome !== 'replied') {
      return;
    }

    expect(out.agentSlug).toBe('revenue-director');
    expect(out.created).toBe(true);
    expect(d.runs[0]).toContain('Can you push the close date?');
    expect(d.runs[0]).not.toContain('> old');
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]!.from).toBe(`Revenue Team <${ADDRESS}>`);
    expect(d.sent[0]!.to).toBe('chris@example.com');
    expect(d.sent[0]!.subject).toBe('Re: Q4 pipeline');
    expect(d.sent[0]!.headers?.['In-Reply-To']).toBe('<m1@example.com>');
    expect(d.sent[0]!.headers?.References).toContain('<m1@example.com>');
    expect(d.sent[0]!.headers?.['Message-ID']).toMatch(/^<vocion-.+@agents\.example\.com>$/);

    const [conv] = await db.select().from(conversationSchema);

    expect(conv!.surface).toBe('email');
    expect(conv!.title).toBe('Q4 pipeline');

    const threads = await db.select().from(emailThreadSchema);

    expect(threads.map(t => t.direction).sort()).toEqual(['in', 'out']);

    // The reply went out, so the stored turn says it finished rather than
    // leaving a NULL that a reader has to guess at (#114).
    const rows = await db.select().from(conversationMessageSchema);
    const assistant = rows.find(r => r.role === 'assistant');

    expect(assistant?.status).toBe('complete');
  });

  it('drops a redelivered webhook for an email already handled', async () => {
    await seed();
    const d = deps();
    await svc.handleInboundEmail(meta(), d);
    const again = await svc.handleInboundEmail(meta(), d);

    expect(again).toEqual({ outcome: 'duplicate', receivedEmailId: 'rcv-1' });
    expect(d.runs).toHaveLength(1);
  });

  it('threads a reply that references our outbound Message-ID into the same conversation', async () => {
    await seed();
    const d = deps();
    const first = await svc.handleInboundEmail(meta(), d);
    const ourId = d.sent[0]!.headers!['Message-ID']!;
    const second = await svc.handleInboundEmail(
      meta({ receivedEmailId: 'rcv-2', messageId: 'm2@example.com', subject: 'Re: Q4 pipeline' }),
      deps({ email: { message_id: '<m2@example.com>', headers: { 'in-reply-to': ourId, 'references': `<m1@example.com> ${ourId}` }, text: 'Yes please' } }),
    );

    expect(second.outcome).toBe('replied');

    if (first.outcome === 'replied' && second.outcome === 'replied') {
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.created).toBe(false);
    }

    expect(await db.select().from(conversationSchema)).toHaveLength(1);
  });

  it('threads the same sender on the same subject within a week even without headers', async () => {
    await seed();
    const first = await svc.handleInboundEmail(meta(), deps());
    const second = await svc.handleInboundEmail(meta({ receivedEmailId: 'rcv-3', messageId: 'm3@example.com', subject: 'RE: q4 Pipeline' }), deps({ email: { message_id: '<m3@example.com>', headers: {} } }));
    if (first.outcome === 'replied' && second.outcome === 'replied') {
      expect(second.conversationId).toBe(first.conversationId);
    } else {
      throw new Error(`unexpected ${first.outcome}/${second.outcome}`);
    }
  });

  it('files an ask and acknowledges an unknown sender without running an agent', async () => {
    await seed();
    const d = deps();
    const out = await svc.handleInboundEmail(meta({ receivedEmailId: 'rcv-4', from: 'stranger@elsewhere.com', fromRaw: 'A Stranger <stranger@elsewhere.com>' }), d);

    expect(out.outcome).toBe('unknown_sender');
    expect(d.runs).toHaveLength(0);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]!.text).toContain('A person will look at it');

    const [ask] = await db.select().from(askSchema);

    expect(ask!.kind).toBe('input');
    expect(ask!.title).toBe(`Unknown sender wrote to ${ADDRESS}`);
    expect(ask!.sourceRef).toBe('email:rcv-4');
    expect(ask!.options.find(o => o.recommended)?.id).toBe('let-agent-answer');

    const [conv] = await db.select().from(conversationSchema);

    expect(conv!.surface).toBe('email');
  });

  it('reports unbound, no_lead and over_budget without side effects', async () => {
    expect(await svc.handleInboundEmail(meta({ recipients: ['nobody@agents.example.com'] }), deps())).toEqual({ outcome: 'unbound', recipients: ['nobody@agents.example.com'] });

    await seed({ lead: null });

    expect(await svc.handleInboundEmail(meta(), deps())).toEqual({ outcome: 'no_lead', orgId: ORG });

    await db.update(projectSchema).set({ leadAgentSlug: 'revenue-director' });
    const d = deps({ preflight: vi.fn(async () => ({ ok: false, reason: 'hard_cents_exceeded' })) as never });
    const out = await svc.handleInboundEmail(meta({ receivedEmailId: 'rcv-5' }), d);

    expect(out.outcome).toBe('over_budget');
    expect(d.runs).toHaveLength(0);
    expect(d.sent[0]!.text).toContain('over its cents budget');
  });
});
