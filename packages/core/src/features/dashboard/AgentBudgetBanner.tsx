import type { AgentBudgetStatus, BudgetLimitSource } from '@/services/BudgetService';

/** The blocked agents as the banner shows them — only what it reads. */
export type BlockedAgentView = Pick<AgentBudgetStatus, 'agentSlug' | 'agentName' | 'spentCents' | 'hardCentsLimit' | 'hardCentsLimitFrom' | 'periodResetsAt'>;

/**
 * Cents as a person reads money.
 * @param cents - An amount in cents; may carry a fraction.
 */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Whose setting the cap is, in words — so an admin knows which file to open.
 * @param source - Where the cap came from.
 */
function capSourceLabel(source: BudgetLimitSource): string {
  if (source === 'built_in_agent_default') {
    return 'built-in default; give the agent a budget in its YAML';
  }
  if (source === 'workspace_agent_default') {
    return 'workspace default, defaults.agentBudget';
  }
  return 'its own budget';
}

/**
 * The reset time as a person reads it, in UTC because the period is UTC.
 * @param iso - ISO-8601 instant.
 */
function resetLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Says, above every dashboard page, which agents have spent through their cap
 * and will refuse their next turn (#272).
 *
 * A cap nobody set — every new agent runs on a default — must not fail
 * quietly: the person chatting sees a refusal, and this is where the admin
 * sees it before anyone asks. Names the cap's source so the fix is obvious.
 * Renders nothing when no agent is blocked.
 * @param props - The blocked agents.
 * @param props.blocked - Agents whose next turn would be refused, from `agentBudgetStatuses`.
 */
export function AgentBudgetBanner({ blocked }: { blocked: BlockedAgentView[] }) {
  if (blocked.length === 0) {
    return null;
  }
  return (
    <div
      role="alert"
      data-testid="agent-budget-banner"
      className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-2.5 lg:px-6"
    >
      <p className="text-sm font-medium text-foreground">
        <span className="font-semibold">
          {blocked.length === 1 ? '1 agent has reached its budget' : `${blocked.length} agents have reached their budgets`}
          {' '}
          and will refuse new turns.
        </span>
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {blocked.map(agent => (
          <li key={agent.agentSlug}>
            <span className="font-medium text-foreground/80">{agent.agentName}</span>
            {' — '}
            {dollars(agent.spentCents)}
            {' of '}
            {agent.hardCentsLimit === null ? 'no cap' : dollars(agent.hardCentsLimit)}
            {' ('}
            {capSourceLabel(agent.hardCentsLimitFrom)}
            {'). Resets '}
            {resetLabel(agent.periodResetsAt)}
            {' UTC.'}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        Every agent&apos;s cap and spend:
        {' '}
        <code>GET /api/v1/budgets/agents</code>
      </p>
    </div>
  );
}
