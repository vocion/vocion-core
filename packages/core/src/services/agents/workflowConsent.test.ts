/**
 * WORKFLOWS ON A PERSON'S WORD (2026-11-06).
 *
 *   - A workflow's `agent` step runs with the step's task, as interpolated,
 *     and the person who started the run, when a person did.
 *   - A browser task in that step is judged against the work the step
 *     declares: the person who started the run is whose word it is, whose
 *     browser it runs in and whose conversation it reports to. A run nobody
 *     started carries no one's word: the task waits for a Start.
 *   - `workflow.run` starts a run as the person who decided it, from the
 *     conversation it was asked in.
 *
 * The browser, the judge and the workflow engine are stand-ins.
 */
import type { AgentTurnRequest } from '@/services/workflows/agentRunner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const created: Array<Record<string, unknown>> = [];
const judged: Array<Record<string, unknown>> = [];
const launched: Array<Record<string, unknown>> = [];
let verdict = true;

vi.mock('@/services/browser/BrowserRunService', () => ({
  BrowserRunBusyError: class extends Error {},
  createBrowserRun: vi.fn(async (input: Record<string, unknown>) => {
    created.push(input);
    return { id: 77, status: input.start ? 'running' : 'proposed', steps: [], result: null, url: null };
  }),
  waitForBrowserRun: vi.fn(async () => ({ id: 77, status: 'done', steps: [], result: { rows: [] }, summary: 'Read the board.', url: null })),
}));
vi.mock('./turnJudge', async orig => ({
  ...(await orig<object>()),
  saidToDecide: vi.fn(async (input: Record<string, unknown>) => {
    judged.push(input);
    return { said: verdict, quote: null };
  }),
  readAutomationMatch: vi.fn(async () => null),
}));
vi.mock('@/services/WorkflowService', async orig => ({
  ...(await orig<object>()),
  launchWorkflow: vi.fn(async (opts: Record<string, unknown>) => {
    launched.push(opts);
    return { id: 501, runLabel: 'Enroll · week of Nov 2' };
  }),
}));

const { browserTaskTools } = await import('./tools/browserTasks');
const { personWhoStarted } = await import('@/services/WorkflowService');
const { runAgentStep } = await import('@/services/workflows/agentStep');
const { workflowRunAction } = await import('@/libs/actions/workflow-run');

const TASK = 'Read the Cedar Hollow board and list everyone who is Ready to check, with their Provider NPI.';

function stepCtx(startedBy: string | null) {
  return {
    orgId: 'org_flow',
    agentSlug: 'enrollment-coordinator',
    userId: 'workflow:enroll-with-larkspur:9',
    harnessConfig: { grantTools: ['browser_tasks'] },
    enabledPlugins: [],
    emit: () => {},
    workflowStep: { runId: 9, workflow: 'enroll-with-larkspur', task: TASK, startedBy, conversationId: 42 },
  } as never;
}

async function callBrowserTask(ctx: never, args: Record<string, unknown>): Promise<string> {
  const t = browserTaskTools(ctx).find(x => x.name === 'browser_task')!;
  return String(await t.invoke(args));
}

beforeEach(() => {
  created.length = 0;
  judged.length = 0;
  launched.length = 0;
  verdict = true;
});

describe('who started a run', () => {
  it('is a person only when a person did', () => {
    expect(personWhoStarted('u_marcus')).toBe('u_marcus');
    expect(personWhoStarted('mcp')).toBeNull();
    expect(personWhoStarted('system')).toBeNull();
    expect(personWhoStarted('workflow:enroll:3')).toBeNull();
    expect(personWhoStarted('agent:enrollment-coordinator')).toBeNull();
    expect(personWhoStarted(null)).toBeNull();
  });
});

describe('a workflow\'s agent step carries its task and who started the run', () => {
  it('hands them to the agent\'s turn', async () => {
    const calls: AgentTurnRequest[] = [];
    await runAgentStep({
      orgId: 'org_flow',
      runId: 9,
      workflow: { slug: 'enroll-with-larkspur', name: 'Enroll' },
      stepLabel: 'Read the board',
      step: { name: 'read', type: 'agent', agent: 'enrollment-coordinator', task: '{{input.board}}' },
      task: TASK,
      startedBy: 'u_marcus',
      conversationId: 42,
      turn: async (req) => {
        calls.push(req);
        return { text: 'done', traceId: 't', toolCalls: 1 };
      },
    });

    expect(calls[0]!.workflowStep).toEqual({ runId: 9, workflow: 'enroll-with-larkspur', task: TASK, startedBy: 'u_marcus', conversationId: 42 });
  });
});

describe('a browser task inside a workflow step', () => {
  it('a run a person started: judged against the declared work, and run in their browser and their conversation', async () => {
    const out = await callBrowserTask(stepCtx('u_marcus'), { task: TASK, effect: 'reads', start_url: 'https://board.example/boards/credentialing' });

    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ orgId: 'org_flow', messages: [], declared: TASK });
    expect(String(judged[0]!.decision)).toContain('Read a website (browser_task): read board.example');
    expect(created[0]).toMatchObject({ userId: 'u_marcus', conversationId: 42, start: true, proposedBy: 'person' });
    expect(out).toContain('"status":"done"');
  });

  it('work beyond what the step declares waits for the person\'s Start', async () => {
    verdict = false;
    const out = await callBrowserTask(stepCtx('u_marcus'), { task: 'Set every clinician who is Ready to check to On hold.', effect: 'changes', start_url: 'https://board.example/boards/credentialing' });

    expect(created[0]).toMatchObject({ userId: 'u_marcus', start: false, proposedBy: 'agent:enrollment-coordinator' });
    expect(out).toContain('"status":"proposed"');
  });

  it('a run nobody started carries no one\'s word: nothing is judged, and it waits', async () => {
    await callBrowserTask(stepCtx(null), { task: TASK, effect: 'reads' });

    expect(judged).toHaveLength(0);
    expect(created[0]).toMatchObject({ start: false, userId: 'workflow:enroll-with-larkspur:9' });
  });
});

describe('workflow.run', () => {
  it('starts the run as the person who approved it, from the conversation it was asked in', async () => {
    const out = await workflowRunAction.execute({ orgId: 'org_flow', reviewedBy: 'u_marcus', invokedBy: 'agent:enrollment-coordinator', origin: { conversationId: 42, userId: 'u_marcus', byPerson: true } }, { workflow: 'enroll-with-larkspur', input: {} });

    expect(launched[0]).toEqual({ orgId: 'org_flow', slug: 'enroll-with-larkspur', input: {}, triggerContext: { trigger: 'chat', conversationId: 42 }, invokedBy: 'u_marcus' });
    expect(out).toMatchObject({ workflowRunId: 501, startedBy: 'u_marcus', url: '/dashboard/workflows/enroll-with-larkspur/runs/501' });
  });

  it('on the person\'s own word, as them', async () => {
    await workflowRunAction.execute({ orgId: 'org_flow', invokedBy: 'u_marcus', origin: { conversationId: 42, userId: 'u_marcus', byPerson: true } }, { workflow: 'enroll-with-larkspur', input: { week: '2026-11-02' } });

    expect(launched[0]).toMatchObject({ invokedBy: 'u_marcus', input: { week: '2026-11-02' } });
  });

  it('an agent\'s own proposal waits for a person, every time', () => {
    expect(workflowRunAction.approvalRequired).toBe(true);
  });
});
