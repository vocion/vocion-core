/**
 * Stopping an agent turn when it spends through its cap partway (#272).
 *
 * The budget used to be read once, before the turn. A turn that started under
 * its cap could then make any number of model calls with nothing reading the
 * running total, so one long turn spent without limit until it finished. Every
 * model call already charges as it completes; the guard here reads the caps
 * again right after each charge and, the first time one is crossed, stops the
 * turn before its next model call. A call that crossed the cap with a final
 * answer (no tools asked for) has finished the turn, which keeps its answer;
 * the next turn is refused before it starts.
 *
 * The stop is a refusal, not a failure (`TurnRefusedError`, #114): nothing
 * broke, and asking again will not help until somebody raises the cap or the
 * period rolls over. That is also what gets the message written onto the turn
 * record, where a failure's raw text is deliberately not.
 *
 * It stops one call late by design. The call that crosses the cap has already
 * been paid for when its usage arrives, so a turn can overshoot by one model
 * call's worth — the price of charging real usage rather than guessing it
 * ahead. Model calls already running side by side (parallel delegations) are
 * each allowed to finish, so a turn that fans out can overshoot by one call
 * per branch. Reserving an estimate before each call is #117's job.
 */

import type { BudgetCheck } from '@/services/BudgetService';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { preflightCheck } from '@/services/BudgetService';
import { TurnRefusedError } from './turnRefusal';

/** A budget check that refused. */
export type BudgetBreach = Extract<BudgetCheck, { ok: false }>;

/**
 * Cents as a person reads money.
 * @param cents - An amount in cents; may carry a fraction.
 */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Where an admin reads every agent's cap and spend. */
const WHERE_TO_LOOK = 'Every agent\'s cap and spend: GET /api/v1/budgets/agents.';

/**
 * The cap that refused, in words, and what the reader can do about it.
 *
 * An agent that set no cap of its own is held to a default, and "raise the cap
 * on this agent" would send the admin looking for a setting that does not
 * exist yet — so the words say which default applied.
 * @param breach - The refusing check.
 */
function whatToChange(breach: BudgetBreach): string {
  const spent = breach.reason === 'hard_cents_exceeded'
    ? `${dollars(breach.current)} of a ${dollars(breach.limit)} cap`
    : `${breach.current} of a ${breach.limit}-token cap`;
  if (breach.limitFrom === 'built_in_agent_default') {
    return `"${breach.agentSlug}" has used ${spent}. It has no budget of its own, so the built-in daily default applies. `
      + `Ask an admin to give it a \`budget\` in its workspace YAML, or wait for the next period. ${WHERE_TO_LOOK}`;
  }
  if (breach.limitFrom === 'workspace_agent_default') {
    return `"${breach.agentSlug}" has used ${spent}. It has no budget of its own, so the workspace's default agent cap applies. `
      + `Ask an admin to give it a \`budget\` in its workspace YAML, raise \`defaults.agentBudget\` in workspace.yaml, or wait for the next period. ${WHERE_TO_LOOK}`;
  }
  if (breach.scope === 'agent') {
    return `"${breach.agentSlug}" has used ${spent}. `
      + `Ask an admin to raise its \`budget\` in its workspace YAML, or wait for the next period. ${WHERE_TO_LOOK}`;
  }
  // The workspace-wide or one feature's cap: not something an agent's YAML can fix.
  return `Budget exceeded for "${breach.agentSlug}" (${breach.reason}: ${breach.current}/${breach.limit}). `
    + 'Ask an admin to raise that cap, or wait for the next period.';
}

/**
 * The words a turn refused before it started shows.
 * @param breach - The refusing check.
 */
export function budgetRefusalMessage(breach: BudgetBreach): string {
  return whatToChange(breach);
}

/**
 * The words a turn stopped partway shows. Leads with the stop, because the
 * reader is looking at an answer that ends early and wants to know why.
 * @param breach - The refusing check.
 */
export function budgetStopMessage(breach: BudgetBreach): string {
  return `This turn stopped partway because it reached its budget. ${whatToChange(breach)}`;
}

/**
 * Watches one agent turn's spend and stops it before the next model call once
 * a cap is crossed.
 *
 * Call {@link afterModelCall} after each model call's usage is charged, and
 * {@link beforeModelCall} when a call starts. Pass {@link signal} to whatever
 * runs the turn so the abort reaches it. Once stopped, {@link stopError} is
 * what the turn should end with; a turn that crossed its cap on its final
 * answer never stops, and ends the way it would have.
 */
export class TurnBudgetGuard {
  private readonly controller = new AbortController();
  private breach: BudgetBreach | null = null;
  private stopped = false;

  /**
   * @param orgId - Tenant.
   * @param agentSlug - The agent whose turn this is.
   * @param check - The budget check; the real one outside of tests.
   */
  constructor(
    private readonly orgId: string,
    private readonly agentSlug: string,
    private readonly check: typeof preflightCheck = preflightCheck,
  ) {}

  /** Aborts when the turn crosses its cap. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The cap a charged model call crossed, whether or not the turn has been stopped for it yet. */
  get crossed(): BudgetBreach | null {
    return this.breach;
  }

  /** The cap that stopped the turn, or null while it is still running. */
  get stoppedBy(): BudgetBreach | null {
    return this.stopped ? this.breach : null;
  }

  /** The error the turn ends with once stopped: a refusal carrying the message. */
  stopError(): TurnRefusedError | null {
    return this.stopped && this.breach ? new TurnRefusedError(budgetStopMessage(this.breach)) : null;
  }

  /**
   * Another model call is starting: stop the turn here if an earlier call
   * crossed a cap. Synchronous, so the abort lands before the call's request
   * goes out.
   */
  beforeModelCall(): void {
    if (!this.breach || this.stopped) {
      return;
    }
    this.stopped = true;
    this.controller.abort(this.stopError());
  }

  /**
   * Read the caps again after a model call was charged. When one is crossed
   * and the call said the turn goes on (it asked for tools), stop the turn
   * now: an in-process model call does not listen to the abort once its
   * request is out, and LangGraph only checks between steps, so waiting for
   * the next call to start would let that call run and be paid for. When the
   * call was a final answer, only remember the cap, so the turn finishes with
   * its answer, and a call that starts anyway is stopped by
   * {@link beforeModelCall}.
   * @param call - What the finished call said about the turn.
   * @param call.turnGoesOn - True when more work follows this call.
   *
   * A check that fails to read is logged and the turn carries on: refusing
   * somebody's answer because the database hiccupped once would be the more
   * expensive mistake, and the next model call checks again.
   */
  async afterModelCall(call: { turnGoesOn?: boolean } = {}): Promise<void> {
    if (this.breach) {
      return;
    }
    let result: BudgetCheck;
    try {
      result = await this.check({ orgId: this.orgId, agentSlug: this.agentSlug });
    } catch (error) {
      console.error('turn budget guard: could not re-read the budget after a model call; the turn continues', {
        orgId: this.orgId,
        agentSlug: this.agentSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (result.ok) {
      return;
    }
    this.breach = result;
    if (call.turnGoesOn) {
      this.beforeModelCall();
    }
  }
}

/**
 * The callback that tells a {@link TurnBudgetGuard} a model call is starting,
 * for an in-process LangGraph turn. Registered next to the tracing callback.
 * `awaitHandlers` keeps LangChain from running it in the background, where the
 * call it should stop could get its request out first.
 */
export class BudgetGateCallback extends BaseCallbackHandler {
  override name = 'BudgetGateCallback';
  override awaitHandlers = true;

  /** @param guard - The turn's guard. */
  constructor(private readonly guard: TurnBudgetGuard) {
    super();
  }

  override async handleChatModelStart(): Promise<void> {
    this.guard.beforeModelCall();
  }

  override async handleLLMStart(): Promise<void> {
    this.guard.beforeModelCall();
  }
}
