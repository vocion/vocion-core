import type { AgentEvent, RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runOperationTool } from './runOperation';

const executeSkillMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/OperationService', () => ({
  executeSkill: executeSkillMock,
}));

function makeCtx(overrides: Partial<RuntimeContext> = {}): { ctx: RuntimeContext; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const ctx: RuntimeContext = {
    orgId: 'org_test',
    agentSlug: 'hiring-manager',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    operationSlugs: ['candidate_screen', 'draft_outreach'],
    harnessConfig: {},
    emit: e => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

describe('runOperationTool', () => {
  beforeEach(() => {
    executeSkillMock.mockReset();
    executeSkillMock.mockResolvedValue({
      skill: { name: 'Draft Outreach', slug: 'draft_outreach', requiresApproval: 'true' },
      runId: 42,
      output: 'draft body',
    });
  });

  it('gates an interrupt-listed operation: emits hitl_gate, does NOT execute', async () => {
    const { ctx, events } = makeCtx({ harnessConfig: { interrupts: ['draft_outreach'] } });
    const t = runOperationTool(ctx);

    const result = await t.invoke({ slug: 'draft_outreach', input: { candidate: 'Ada' } });

    expect(executeSkillMock).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: 'hitl_gate',
        gate: {
          name: 'run-draft-outreach',
          question: 'Run the "draft_outreach" operation with these inputs?',
          payload: { operation: 'draft_outreach', input: { candidate: 'Ada' } },
        },
      },
    ]);
    expect(String(result)).toContain('NOT executed');
  });

  it('executes an interrupt-listed operation once approved', async () => {
    const { ctx, events } = makeCtx({ harnessConfig: { interrupts: ['draft_outreach'] } });
    const t = runOperationTool(ctx);

    const result = await t.invoke({ slug: 'draft_outreach', input: { candidate: 'Ada' }, approved: true });

    expect(executeSkillMock).toHaveBeenCalledOnce();
    expect(events.filter(e => e.type === 'hitl_gate')).toHaveLength(0);
    expect(String(result)).toContain('Run #42');
  });

  it('runs non-interrupted operations without a gate', async () => {
    const { ctx, events } = makeCtx({ harnessConfig: { interrupts: ['draft_outreach'] } });
    executeSkillMock.mockResolvedValue({
      skill: { name: 'Candidate Screen', slug: 'candidate_screen', requiresApproval: 'false' },
      runId: 7,
      output: 'ranked list',
    });
    const t = runOperationTool(ctx);

    const result = await t.invoke({ slug: 'candidate_screen', input: {} });

    expect(executeSkillMock).toHaveBeenCalledOnce();
    expect(events).toHaveLength(0);
    expect(String(result)).toContain('ranked list');
  });

  it('still rejects out-of-scope operations before the gate check', async () => {
    const { ctx, events } = makeCtx({ harnessConfig: { interrupts: ['other_op'] } });
    const t = runOperationTool(ctx);

    const result = await t.invoke({ slug: 'other_op', input: {} });

    expect(executeSkillMock).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(String(result)).toContain('not in scope');
  });
});
