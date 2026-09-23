/**
 * The mid-turn budget stop (#272): the guard that aborts a turn the first time
 * a cap is crossed, and the words the person reads when it does.
 *
 * The guard takes its budget check as an argument, so these run without a
 * database; what the check itself decides is covered against a real one in
 * `BudgetService.pglite.test.ts`.
 */
import type { BudgetBreach } from './budgetStop';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/BudgetService', () => ({ preflightCheck: vi.fn() }));

const { BudgetGateCallback, budgetRefusalMessage, budgetStopMessage, TurnBudgetGuard } = await import('./budgetStop');
const { isTurnRefusal } = await import('./turnRefusal');

const ORG = 'org_budget_stop';
const AGENT = 'deal-lead';

function breach(overrides: Partial<BudgetBreach> = {}): BudgetBreach {
  return {
    ok: false,
    reason: 'hard_cents_exceeded',
    scope: 'agent',
    agentSlug: AGENT,
    limit: 10_000,
    current: 10_012,
    limitFrom: 'own',
    ...overrides,
  };
}

describe('the turn budget guard', () => {
  it('leaves the turn running while every check comes back under the cap', async () => {
    const guard = new TurnBudgetGuard(ORG, AGENT, vi.fn(async () => ({ ok: true as const })));

    await guard.afterModelCall();
    await guard.afterModelCall();

    expect(guard.signal.aborted).toBe(false);
    expect(guard.stopError()).toBeNull();
  });

  it('stops a turn that goes on as soon as a check finds the cap crossed, with a refusal naming it', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(breach());
    const guard = new TurnBudgetGuard(ORG, AGENT, check);

    await guard.afterModelCall({ turnGoesOn: true });

    expect(guard.signal.aborted).toBe(false);

    await guard.afterModelCall({ turnGoesOn: true });

    // Right away: the next call would not listen to an abort once it started.
    expect(guard.signal.aborted).toBe(true);
    expect(check).toHaveBeenLastCalledWith({ orgId: ORG, agentSlug: AGENT });
    // A refusal, so the stream route stores the message on the turn record.
    expect(isTurnRefusal(guard.stopError())).toBe(true);
    expect(isTurnRefusal(guard.signal.reason)).toBe(true);
    expect(guard.stopError()?.message).toContain('stopped partway');
  });

  it('never stops a turn whose final answer is the call that crossed the cap', async () => {
    const guard = new TurnBudgetGuard(ORG, AGENT, vi.fn().mockResolvedValue(breach()));

    await guard.afterModelCall({ turnGoesOn: false });

    expect(guard.crossed).not.toBeNull();
    expect(guard.stoppedBy).toBeNull();
    expect(guard.signal.aborted).toBe(false);
  });

  it('stops the turn from the LangGraph callback when the next model call starts', async () => {
    const guard = new TurnBudgetGuard(ORG, AGENT, vi.fn().mockResolvedValue(breach()));
    const gate = new BudgetGateCallback(guard);
    await guard.afterModelCall({ turnGoesOn: false });

    await gate.handleChatModelStart();

    expect(guard.signal.aborted).toBe(true);
  });

  it('stops once, with one message, when parallel model calls cross the cap together', async () => {
    const guard = new TurnBudgetGuard(ORG, AGENT, vi.fn().mockResolvedValue(breach()));
    const abortReasons: unknown[] = [];
    guard.signal.addEventListener('abort', () => abortReasons.push(guard.signal.reason));

    await Promise.all([guard.afterModelCall({ turnGoesOn: true }), guard.afterModelCall({ turnGoesOn: true })]);

    expect(abortReasons).toHaveLength(1);
    expect(guard.stoppedBy).toMatchObject({ reason: 'hard_cents_exceeded' });
  });

  it('stops checking once stopped, so a late model call cannot re-trip or reword it', async () => {
    const check = vi.fn().mockResolvedValue(breach());
    const guard = new TurnBudgetGuard(ORG, AGENT, check);

    await guard.afterModelCall();
    await guard.afterModelCall();

    expect(check).toHaveBeenCalledTimes(1);
  });

  it('keeps the turn running, and says so, when the budget cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = new TurnBudgetGuard(ORG, AGENT, vi.fn().mockRejectedValue(new Error('connection reset')));

    await guard.afterModelCall();

    expect(guard.signal.aborted).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('could not re-read the budget'), expect.objectContaining({ error: 'connection reset' }));

    errorSpy.mockRestore();
  });
});

describe('what the person reads', () => {
  it('tells an agent on the built-in default that it has no budget of its own, and where to give it one', () => {
    const message = budgetRefusalMessage(breach({ limitFrom: 'built_in_agent_default' }));

    expect(message).toContain('$100.12 of a $100.00 cap');
    expect(message).toContain('no budget of its own');
    expect(message).toContain('workspace YAML');
    expect(message).toContain('GET /api/v1/budgets/agents');
  });

  it('points an agent on the workspace default at both its own budget and the default', () => {
    const message = budgetRefusalMessage(breach({ limitFrom: 'workspace_agent_default', limit: 500, current: 501 }));

    expect(message).toContain('workspace\'s default agent cap');
    expect(message).toContain('defaults.agentBudget');
  });

  it('does not send someone to an agent\'s YAML for a workspace-wide cap it cannot change', () => {
    const message = budgetRefusalMessage(breach({ scope: 'org', agentSlug: 'platform:all' }));

    expect(message).toContain('"platform:all"');
    expect(message).not.toContain('workspace YAML');
  });

  it('leads a mid-turn stop with the stop, before the cap', () => {
    expect(budgetStopMessage(breach())).toMatch(/^This turn stopped partway because it reached its budget\. /);
  });
});
