/**
 * The words every budget refusal is written in — one place, so a cap reads
 * the same wherever it stops something: an agent turn before it starts or
 * partway (`services/agents/budgetStop.ts`), an ingest embedding batch
 * (`BudgetExceededError`), an external worker's claim, image generation, a
 * chat or mail surface.
 *
 * The point of having one is the account cap. It is the one cap nobody in a
 * workspace can change — a Vocion operator sets it — so every site that
 * refuses over it has to say so, rather than sending the reader to an admin
 * who cannot help. And because members of one workspace have no view of the
 * rest of the account, the account's message names no figure: how much the
 * whole account spent is the account's business, not every member's.
 *
 * Depends on nothing but types, so `BudgetService` can build its own error
 * from it without importing the agent runtime.
 */

import type { BudgetCheck } from '@/services/BudgetService';

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
export function budgetRefusalMessage(breach: BudgetBreach): string {
  if (breach.scope === 'account') {
    // Nobody in the workspace can change this one — saying "ask an admin"
    // would send them to someone who cannot help. No amount: the reader may
    // be a member of one workspace, with no view of the account's others.
    return 'This account has reached its monthly cap, across all of its workspaces. '
      + 'The account cap is set by your Vocion operator: ask them to raise it, or wait for the first of next month (UTC).';
  }
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
