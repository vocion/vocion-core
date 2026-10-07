/**
 * A person's own assistant asking their workspaces, against PGlite.
 *
 * The refusals are what matter most, and each one must look like the others:
 * a workspace the person holds no grant on, someone else's personal workspace
 * and a workspace that does not exist all answer "not found", run nothing and
 * write nothing. Then the ask that is allowed: it runs the other workspace's
 * lead as a turn of that workspace (its orgId, the person as the user), lands
 * as that workspace's conversation linked to this thread, shows its steps
 * nested under one "Asking …" row, and comes back with links built for that
 * workspace.
 *
 * The other workspace's model is the only thing faked: `runAgentDeep` plays a
 * turn's events. Everything around it — `askWorkspace`, the conversation rows,
 * `actAs`, the access rules — is the real code.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/AgentService')>()),
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const {
  accountMembershipSchema,
  actionRunSchema,
  agentSchema,
  conversationMessageSchema,
  conversationSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { createConversation, getConversation, listConversations } = await import('@/services/ConversationService');
const { assistantTools } = await import('./assistant');

const NORTHWIND = 'acct-asst-northwind';
const KESTREL = 'acct-asst-kestrel';

const ALEX = 'usr-asst-alex'; // the person whose assistant asks
const BRIT = 'usr-asst-brit'; // a colleague with a personal workspace of her own
const CASS = 'usr-asst-cass'; // a member of the revenue workspace

const REVENUE = 'proj-asst-revenue'; // shared, Alex granted
const DELIVERY = 'proj-asst-delivery'; // shared, Alex holds no grant
const KESTREL_OPS = 'proj-asst-kestrel-ops'; // another account entirely

let alexHome: string;
let britHome: string;

async function reset() {
  await db.delete(actionRunSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(agentSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
}

async function seed() {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-asst' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-asst' },
  ]);
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: BRIT, email: 'brit@northwind.example', name: 'Brit Okafor' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: ALEX, role: 'member' },
    { accountId: NORTHWIND, userId: BRIT, role: 'member' },
    { accountId: NORTHWIND, userId: CASS, role: 'member' },
    { accountId: KESTREL, userId: ALEX, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue Team', description: 'Pipeline, renewals and the quarterly number.', leadAgentSlug: 'revenue-lead' },
    { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Delivery', leadAgentSlug: 'delivery-lead' },
    { id: KESTREL_OPS, accountId: KESTREL, slug: 'ops', name: 'Kestrel Ops', leadAgentSlug: 'ops-lead' },
  ]);
  await db.insert(projectMemberSchema).values([
    { projectId: REVENUE, userId: ALEX, role: 'member' },
    { projectId: REVENUE, userId: CASS, role: 'member' },
    { projectId: KESTREL_OPS, userId: ALEX, role: 'member' },
  ]);
  const agent = (orgId: string, slug: string, name: string) => ({ orgId, projectId: orgId, slug, name, systemPrompt: `You are ${name}.`, role: 'lead', active: 'true' });
  await db.insert(agentSchema).values([
    agent(REVENUE, 'revenue-lead', 'Revenue Lead'),
    agent(DELIVERY, 'delivery-lead', 'Delivery Lead'),
    agent(KESTREL_OPS, 'ops-lead', 'Ops Lead'),
  ]);
  alexHome = (await ensurePersonalProject(ALEX, NORTHWIND)).id;
  britHome = (await ensurePersonalProject(BRIT, NORTHWIND)).id;
}

/**
 * The context the assistant's tools close over, as the harness would build it.
 * @param over - What differs.
 */
function assistantCtx(over: Partial<RuntimeContext> = {}): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: alexHome,
    userId: ALEX,
    agentSlug: 'assistant',
    workspaceKind: 'personal',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: e => events.push(e),
    events,
    ...over,
  };
}

function toolNamed(ctx: RuntimeContext, name: string) {
  const t = assistantTools(ctx).find(x => x.name === name);
  if (!t) {
    throw new Error(`no ${name} in this context`);
  }
  return t;
}

/**
 * The other workspace's turn: two steps, an answer, and a card it filed.
 * @param runId - The `action_run` its card was filed as, when it filed one.
 */
function revenueAnswers(runId?: number) {
  vi.mocked(runAgentDeep).mockImplementation(async (opts) => {
    const lead = { id: 'lead', kind: 'lead' as const, name: 'Revenue Lead' };
    opts.onEvent?.({ type: 'trace_node', id: 't1', actor: lead, kind: 'search', status: 'start', label: 'Searching renewals' });
    opts.onEvent?.({ type: 'trace_node', id: 't1', actor: lead, kind: 'search', status: 'done', label: 'Searched renewals', citations: [{ sourceType: 'crm', title: 'Contoso renewal', actorId: 'lead' }] });
    opts.onEvent?.({ type: 'trace_node', id: 't2', parentId: 't1', actor: { id: 'task-9', kind: 'specialist', name: 'Renewals analyst' }, kind: 'tool', status: 'done', label: 'Read the deal' });
    if (runId !== undefined) {
      opts.onEvent?.({ type: 'tool_progress', tool: 'propose_action', meta: { runId } } as never);
    }
    opts.onEvent?.({ type: 'response_delta', delta: 'Contoso renews on Nov 3; the order form is with their legal team.' });
    return { response: 'Contoso renews on Nov 3; the order form is with their legal team.', traceId: 'trace-asst-1', toolCalls: [] };
  });
}

beforeEach(async () => {
  vi.mocked(runAgentDeep).mockReset();
  process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
  await reset();
  await seed();
});

afterEach(() => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
});

describe('the assistant\'s tools exist only in a personal workspace', () => {
  it('builds nothing for an agent in a shared workspace, both tools in a personal one', () => {
    expect(assistantTools(assistantCtx({ orgId: REVENUE, workspaceKind: 'shared' }))).toEqual([]);
    expect(assistantTools(assistantCtx({ orgId: REVENUE, workspaceKind: undefined }))).toEqual([]);
    expect(assistantTools(assistantCtx()).map(t => t.name).sort()).toEqual(['ask_workspace', 'list_my_workspaces']);
  });
});

describe('every personal workspace starts with its assistant', () => {
  it('is the workspace lead, from the core template', async () => {
    const [home] = await db.select().from(projectSchema).where(eq(projectSchema.id, alexHome));
    const [agent] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, alexHome), eq(agentSchema.slug, 'assistant')));

    expect(home?.leadAgentSlug).toBe('assistant');
    expect(agent).toMatchObject({ name: 'Assistant', role: 'lead', active: 'true' });
    expect(agent?.harnessConfig?.grantTools).toEqual(['list_my_workspaces', 'ask_workspace']);
  });
});

describe('list_my_workspaces', () => {
  it('lists the shared workspaces on this account the person can act in — no ungranted, no personal, no other account', async () => {
    const out = String(await toolNamed(assistantCtx(), 'list_my_workspaces').invoke({}));

    expect(out).toContain('Revenue Team (workspace: revenue)');
    expect(out).toContain('Pipeline, renewals and the quarterly number.');
    expect(out).toContain('answered by Revenue Lead');
    expect(out).not.toContain('Delivery');
    expect(out).not.toContain('Personal');
    expect(out).not.toContain('Kestrel');
  });

  it('follows the account rule when access is not enforced: every shared workspace of the account, still no personal one', async () => {
    delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
    const out = String(await toolNamed(assistantCtx(), 'list_my_workspaces').invoke({}));

    expect(out).toContain('(workspace: revenue)');
    expect(out).toContain('(workspace: delivery)');
    expect(out).not.toContain('personal-');
  });
});

describe('ask_workspace refuses, as not found, what the person cannot reach', () => {
  const refusals = async (ref: string) => {
    const ctx = assistantCtx();
    const out = String(await toolNamed(ctx, 'ask_workspace').invoke({ workspace: ref, message: 'Where does the Contoso renewal stand?' }));
    return { out, ctx };
  };

  it('a workspace they hold no grant on, someone else\'s personal workspace, and one that does not exist read the same', async () => {
    const [brit] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, britHome));
    const ungranted = await refusals('delivery');
    const theirs = await refusals(brit!.slug);
    const byId = await refusals(britHome);
    const missing = await refusals('no-such-workspace');
    const otherAccount = await refusals('ops');

    for (const [r, ref] of [[ungranted, 'delivery'], [theirs, brit!.slug], [byId, britHome], [missing, 'no-such-workspace'], [otherAccount, 'ops']] as const) {
      expect(r.out).toBe(`No workspace "${ref}" is one you can reach from here. Call list_my_workspaces for the ones you can ask.`);
      expect(r.ctx.events).toEqual([]);
    }

    expect(runAgentDeep).not.toHaveBeenCalled();
    expect(await db.select().from(conversationSchema)).toEqual([]);
  });

  it('refuses a turn that does not run for the personal workspace\'s owner', async () => {
    revenueAnswers();
    const out = String(await toolNamed(assistantCtx({ userId: BRIT }), 'ask_workspace').invoke({ workspace: 'revenue', message: 'Anything due?' }));

    expect(out).toContain('is one you can reach from here');
    expect(runAgentDeep).not.toHaveBeenCalled();
  });

  it('refuses a turn with no person behind it (a schedule)', async () => {
    const out = String(await toolNamed(assistantCtx({ userId: undefined }), 'ask_workspace').invoke({ workspace: 'revenue', message: 'Anything due?' }));

    expect(out).toContain('is one you can reach from here');
    expect(runAgentDeep).not.toHaveBeenCalled();
  });
});

describe('ask_workspace on a workspace the person can act in', () => {
  it('runs that workspace\'s lead as the person, in that workspace, as a conversation of its own linked to this thread', async () => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: REVENUE, actionId: 'email.send', status: 'pending', invokedBy: 'agent:revenue-lead' }).returning();
    revenueAnswers(run!.id);
    const parent = await createConversation({ orgId: alexHome, agentSlug: 'assistant', createdBy: ALEX });
    const ctx = assistantCtx({ conversationId: parent.id });

    const out = String(await toolNamed(ctx, 'ask_workspace').invoke({ workspace: 'Revenue', message: 'Where does the Contoso renewal stand?' }));

    // The nested turn: the other workspace's orgId, the person, its lead.
    const call = vi.mocked(runAgentDeep).mock.calls[0]![0];

    expect(call).toMatchObject({ orgId: REVENUE, userId: ALEX, agentSlug: 'revenue-lead' });
    expect(call.message).toContain('Where does the Contoso renewal stand?');
    expect(call.message).toContain('Alex Rivera\'s own assistant');

    // The child conversation is the workspace's record.
    const [child] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, REVENUE));

    expect(child).toMatchObject({ orgId: REVENUE, surface: 'assistant', parentConversationId: parent.id, createdBy: ALEX, agentSlug: 'revenue-lead' });
    expect(child!.title).toBe('Alex Rivera\'s assistant asked: Where does the Contoso renewal stand?');

    const messages = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, child!.id));

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.content).toContain('Contoso renews on Nov 3');

    // The answer comes back with the workspace's own links.
    expect(out).toContain('Revenue Team answered (Revenue Lead)');
    expect(out).toContain('Contoso renews on Nov 3');
    expect(out).toContain(`/w/revenue/dashboard/chat/${child!.id}`);
    expect(out).toContain(`[Proposed email.send](`);
    expect(out).toContain(`/w/revenue/dashboard/inbox/proposal-${run!.id}`);
  });

  it('shows the workspace\'s steps nested under one "Asking …" row', async () => {
    revenueAnswers();
    const ctx = assistantCtx();
    await toolNamed(ctx, 'ask_workspace').invoke({ workspace: 'revenue', message: 'Where does the Contoso renewal stand?' });
    const nodes = ctx.events.filter((e): e is Extract<AgentEvent, { type: 'trace_node' }> => e.type === 'trace_node');
    const row = nodes[0]!;

    expect(row).toMatchObject({ kind: 'delegate', status: 'start', label: 'Asking Revenue Team' });
    expect(nodes.at(-1)).toMatchObject({ id: row.id, kind: 'delegate', status: 'done', label: 'Revenue Team answered' });

    const inner = nodes.filter(n => n.id !== row.id);

    expect(inner.map(n => n.id)).toEqual([`${row.id}:t1`, `${row.id}:t1`, `${row.id}:t2`]);
    expect(inner[0]!.parentId).toBe(row.id);
    expect(inner[2]!.parentId).toBe(`${row.id}:t1`);
    expect(inner.every(n => n.actor.kind === 'specialist')).toBe(true);
    expect(inner[1]!.citations?.[0]?.actorId).toBe(`${row.id}:lead`);
    // Only steps cross over: the other workspace's words reach this thread as the tool's result.
    expect(ctx.events.some(e => e.type === 'response_delta')).toBe(false);
  });

  it('keeps the asking thread its owner\'s alone, and the asked conversation visible to the workspace\'s members', async () => {
    revenueAnswers();
    const parent = await createConversation({ orgId: alexHome, agentSlug: 'assistant', createdBy: ALEX });
    await toolNamed(assistantCtx({ conversationId: parent.id }), 'ask_workspace').invoke({ workspace: 'revenue', message: 'Anything due this week?' });

    expect(await getConversation({ orgId: alexHome, id: parent.id, viewerId: ALEX })).not.toBeNull();
    expect(await getConversation({ orgId: alexHome, id: parent.id, viewerId: BRIT })).toBeNull();
    expect(await getConversation({ orgId: alexHome, id: parent.id, viewerId: CASS })).toBeNull();

    const seenByCass = await listConversations({ orgId: REVENUE, viewerId: CASS });

    expect(seenByCass).toHaveLength(1);
    expect(seenByCass[0]).toMatchObject({ surface: 'assistant', parentConversationId: parent.id });
  });

  it('says so, plainly, when the workspace could not answer', async () => {
    vi.mocked(runAgentDeep).mockRejectedValue(new Error('upstream reset'));
    const ctx = assistantCtx();
    const out = String(await toolNamed(ctx, 'ask_workspace').invoke({ workspace: 'revenue', message: 'Anything due?' }));

    expect(out).toContain('Revenue Team could not answer');
    expect(ctx.events.at(-1)).toMatchObject({ type: 'trace_node', status: 'error', label: 'Revenue Team could not answer' });
  });

  it('with one workspace to ask, asks it without a routing read when none is named', async () => {
    revenueAnswers();
    const out = String(await toolNamed(assistantCtx(), 'ask_workspace').invoke({ message: 'Where does the Contoso renewal stand?' }));

    expect(out).toContain('Revenue Team answered');
    expect(vi.mocked(runAgentDeep).mock.calls[0]![0].orgId).toBe(REVENUE);
  });
});
