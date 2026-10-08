/**
 * A card decided from the thread it shows in, while its run lives in another
 * workspace (5.0 screen capture: the card a person's assistant brought back
 * from a workspace it asked showed only in that workspace's Review).
 *
 * The review routes take the run's workspace (`workspaceId`) and act there —
 * read its status, approve, defer, undo — exactly when the person could switch
 * to that workspace and do it there (`actAs`), and answer "not found" for
 * everything else: a workspace they hold no grant on, someone else's personal
 * one, one that does not exist. The access rules and the reads are the real
 * code against PGlite; only the session and the decision services are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

// Review.ts pulls the workflow stack in at module load; mocked wholesale the
// way the sibling router tests do.
vi.mock('@/services/WorkflowService', async () => {
  const actual = await vi.importActual<typeof import('@/services/WorkflowService')>('@/services/WorkflowService');
  return {
    resumeWorkflow: vi.fn(),
    cancelWorkflow: vi.fn(),
    getWorkflowRun: vi.fn(),
    listWorkflowRuns: vi.fn(),
    submitWorkflowRunFeedback: vi.fn(),
    WorkflowRunNotResumableError: actual.WorkflowRunNotResumableError,
  };
});

vi.mock('@/services/ReviewService', () => ({
  decide: vi.fn(async () => ({ execution: null })),
  snooze: vi.fn(async () => undefined),
  recordActionSignal: vi.fn(async () => undefined),
}));

vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  undoAction: vi.fn(async () => ({ status: 'undone' })),
}));

vi.mock('@/services/adoption/attribution', () => ({ trackReviewDecision: vi.fn() }));

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  actionRunSchema,
  agentSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { decide, snooze } = await import('@/services/ReviewService');
const { undoAction } = await import('@/services/ActionService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { resolveProjectForUser } = await import('@/services/ProjectService');
const { actionStatusRoute, decideActionRoute, snoozeActionRoute, undoActionRoute } = await import('./Review');
const { actingOrgId } = await import('./actingWorkspace');

const NORTHWIND = 'acct-review-acting';
const KESTREL = 'acct-review-kestrel'; // a second account Alex belongs to
const LARKFIELD = 'acct-review-larkfield'; // an account Alex is not in
const ALEX = 'usr-review-alex'; // decides from their personal thread
const BRIT = 'usr-review-brit'; // a colleague
const REVENUE = 'proj-review-revenue'; // shared, Alex granted
const DELIVERY = 'proj-review-delivery'; // shared, no grant for Alex
const KESTREL_OPS = 'proj-review-kestrel-ops'; // on Kestrel, no grant for Alex
const KESTREL_DESK = 'proj-review-kestrel-desk'; // on Kestrel, Alex granted
const LARKFIELD_OPS = 'proj-review-larkfield-ops'; // on an account Alex is not in

let alexHome: string;
let britHome: string;

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer.
 * @param route - The exported procedure.
 * @param input - The input payload.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * The signed-in session: Alex, in their personal workspace.
 * @param projectId - The session's workspace.
 */
function signedIn(projectId: string) {
  vi.mocked(guardAuth).mockResolvedValue({
    userId: ALEX,
    orgId: projectId,
    accountId: NORTHWIND,
    projectId,
    role: 'member',
    has: () => true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

async function reset() {
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
  await reset();
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-review' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-review' },
    { id: LARKFIELD, name: 'Larkfield Systems', slug: 'larkfield-review' },
  ]);
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: BRIT, email: 'brit@northwind.example', name: 'Brit Okafor' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: ALEX, role: 'member' },
    { accountId: NORTHWIND, userId: BRIT, role: 'member' },
    { accountId: KESTREL, userId: ALEX, role: 'member' },
    { accountId: LARKFIELD, userId: BRIT, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Northwind Revenue' },
    { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Delivery' },
    { id: KESTREL_OPS, accountId: KESTREL, slug: 'ops', name: 'Kestrel Ops' },
    { id: KESTREL_DESK, accountId: KESTREL, slug: 'desk', name: 'Kestrel Desk' },
    { id: LARKFIELD_OPS, accountId: LARKFIELD, slug: 'ops', name: 'Larkfield Ops' },
  ]);
  await db.insert(projectMemberSchema).values([
    { projectId: REVENUE, userId: ALEX, role: 'member' },
    { projectId: KESTREL_DESK, userId: ALEX, role: 'member' },
  ]);
  alexHome = (await ensurePersonalProject(ALEX, NORTHWIND)).id;
  britHome = (await ensurePersonalProject(BRIT, NORTHWIND)).id;
  signedIn(alexHome);
});

afterEach(() => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
});

/**
 * A pending run in a workspace.
 * @param orgId - Where it lives.
 * @param over - What differs.
 */
async function runIn(orgId: string, over: Partial<typeof actionRunSchema.$inferInsert> = {}): Promise<number> {
  const [row] = await db.insert(actionRunSchema).values({ orgId, actionId: 'email.send', status: 'pending', invokedBy: 'agent:revenue-lead', ...over }).returning({ id: actionRunSchema.id });
  return row!.id;
}

describe('actingOrgId', () => {
  it('is the session\'s workspace when none is named, or the session\'s own is', async () => {
    expect(await actingOrgId({ userId: ALEX, orgId: alexHome }, undefined)).toBe(alexHome);
    expect(await actingOrgId({ userId: ALEX, orgId: alexHome }, alexHome)).toBe(alexHome);
  });

  it('is the named workspace when the person can act there', async () => {
    expect(await actingOrgId({ userId: ALEX, orgId: alexHome }, REVENUE)).toBe(REVENUE);
  });

  it('is the same not-found for an ungranted workspace, someone else\'s personal one, and one that does not exist', async () => {
    for (const ws of [DELIVERY, britHome, 'proj-nowhere']) {
      await expect(actingOrgId({ userId: ALEX, orgId: alexHome }, ws)).rejects.toMatchObject({ status: 404 });
    }
  });

  /**
   * Whether the person may act in a workspace, as switching decides it
   * (`resolveProjectForUser`): acting is never wider than switching, and
   * never narrower.
   * @param ws - The workspace.
   */
  async function bothSay(ws: string): Promise<{ switches: boolean; acts: boolean }> {
    const switches = (await resolveProjectForUser(ALEX, { id: ws })) !== null;
    const acts = await actingOrgId({ userId: ALEX, orgId: alexHome }, ws).then(() => true, (err: { status?: number }) => {
      expect(err.status).toBe(404);

      return false;
    });
    return { switches, acts };
  }

  it('with access enforced, matches switching across accounts: a grant on another account the person is in, never an account they are not in', async () => {
    const cases: Array<[string, boolean]> = [[REVENUE, true], [DELIVERY, false], [KESTREL_DESK, true], [KESTREL_OPS, false], [LARKFIELD_OPS, false], [britHome, false]];

    for (const [ws, allowed] of cases) {
      expect({ ws, ...(await bothSay(ws)) }).toEqual({ ws, switches: allowed, acts: allowed });
    }
  });

  it('with access not enforced (the self-host default), any member of the owning account may act — still never in someone else\'s personal workspace or another account', async () => {
    delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
    const cases: Array<[string, boolean]> = [[REVENUE, true], [DELIVERY, true], [KESTREL_DESK, true], [KESTREL_OPS, true], [LARKFIELD_OPS, false], [britHome, false]];

    for (const [ws, allowed] of cases) {
      expect({ ws, ...(await bothSay(ws)) }).toEqual({ ws, switches: allowed, acts: allowed });
    }
  });
});

describe('the review routes, for a run in the workspace a card names', () => {
  it('reads the run\'s status there, and finds nothing for it here', async () => {
    const id = await runIn(REVENUE);

    await expect(call(actionStatusRoute, { id, workspaceId: REVENUE })).resolves.toMatchObject({ status: 'pending' });
    await expect(call(actionStatusRoute, { id })).rejects.toMatchObject({ status: 404 });
  });

  it('approves, defers and undoes there, as the person', async () => {
    const id = await runIn(REVENUE);

    await call(decideActionRoute, { id, decision: 'approve', workspaceId: REVENUE });

    expect(decide).toHaveBeenCalledWith({ kind: 'action', id }, 'approve', REVENUE, expect.objectContaining({ reviewedBy: ALEX }));

    await call(snoozeActionRoute, { id, until: new Date(Date.now() + 86_400_000).toISOString(), workspaceId: REVENUE });

    expect(vi.mocked(snooze).mock.calls[0]?.[0]).toBe(REVENUE);

    await call(undoActionRoute, { id, workspaceId: REVENUE });

    expect(vi.mocked(undoAction).mock.calls[0]?.slice(0, 2)).toEqual([id, REVENUE]);
  });

  it('refuses, as not found, a workspace the person could not switch to — and decides nothing', async () => {
    const id = await runIn(DELIVERY);

    for (const workspaceId of [DELIVERY, britHome, 'proj-nowhere']) {
      await expect(call(decideActionRoute, { id, decision: 'approve', workspaceId })).rejects.toMatchObject({ status: 404 });
      await expect(call(actionStatusRoute, { id, workspaceId })).rejects.toMatchObject({ status: 404 });
    }

    expect(decide).not.toHaveBeenCalled();
  });

  it('refuses, as not found, to defer or undo in a workspace the person could not switch to — and calls nothing', async () => {
    const id = await runIn(DELIVERY, { status: 'done' });
    const until = new Date(Date.now() + 86_400_000).toISOString();

    for (const workspaceId of [DELIVERY, britHome, LARKFIELD_OPS, 'proj-nowhere']) {
      await expect(call(snoozeActionRoute, { id, until, workspaceId })).rejects.toMatchObject({ status: 404 });
      await expect(call(undoActionRoute, { id, workspaceId })).rejects.toMatchObject({ status: 404 });
    }

    expect(snooze).not.toHaveBeenCalled();
    expect(undoAction).not.toHaveBeenCalled();
  });

  it('links what a done run made into its own workspace', async () => {
    const id = await runIn(REVENUE, { actionId: 'ask.file', status: 'done', result: { askId: 77 } });
    const out = await call<{ links: Array<{ href: string; ref?: unknown }> }>(actionStatusRoute, { id, workspaceId: REVENUE });

    expect(out.links.length).toBeGreaterThan(0);

    for (const link of out.links) {
      expect(link.href).toMatch(/^\/w\/revenue\/dashboard\/.*account=northwind-review/);
      expect(link.ref).toBeUndefined();
    }
  });
});
