import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { AgentBudgetBanner } from './AgentBudgetBanner';
import '@/styles/global.css';

/**
 * The banner an admin sees when an agent has spent through its cap (#272).
 *
 * What it has to get right: it is there at all when an agent is blocked — a
 * cap nobody chose must not fail quietly — and gone when none is; it names the
 * agent, the money, and whose setting the cap is, because "built-in default"
 * and "its own budget" send the admin to different files; and it says when
 * the cap lifts on its own.
 */

const BLOCKED_ON_DEFAULT = {
  agentSlug: 'deal-lead',
  agentName: 'Deal Lead',
  spentCents: 10_050,
  hardCentsLimit: 10_000,
  hardCentsLimitFrom: 'built_in_agent_default' as const,
  periodResetsAt: '2026-09-24T00:00:00.000Z',
};

describe('the agent budget banner', () => {
  it('renders nothing while no agent is at its cap', async () => {
    await render(<AgentBudgetBanner blocked={[]} />);

    await expect.element(page.getByTestId('agent-budget-banner')).not.toBeInTheDocument();
  });

  it('names a blocked agent, its spend against the cap, the default it is on, and when it resets', async () => {
    await render(<AgentBudgetBanner blocked={[BLOCKED_ON_DEFAULT]} />);

    const banner = page.getByTestId('agent-budget-banner');

    await expect.element(banner).toHaveTextContent('1 agent has reached its budget and will refuse new turns.');
    await expect.element(banner).toHaveTextContent('Deal Lead — $100.50 of $100.00');
    await expect.element(banner).toHaveTextContent('built-in default; give the agent a budget in its YAML');
    await expect.element(banner).toHaveTextContent('Resets Sep 24, 12:00 AM UTC.');
  });

  it('tells an agent\'s own cap apart from the workspace default', async () => {
    await render(
      <AgentBudgetBanner
        blocked={[
          { ...BLOCKED_ON_DEFAULT, agentSlug: 'a', agentName: 'Own Cap', hardCentsLimitFrom: 'own' },
          { ...BLOCKED_ON_DEFAULT, agentSlug: 'b', agentName: 'Workspace Cap', hardCentsLimitFrom: 'workspace_agent_default' },
        ]}
      />,
    );

    const banner = page.getByTestId('agent-budget-banner');

    await expect.element(banner).toHaveTextContent('2 agents have reached their budgets');
    await expect.element(banner).toHaveTextContent('Own Cap — $100.50 of $100.00 (its own budget)');
    await expect.element(banner).toHaveTextContent('Workspace Cap — $100.50 of $100.00 (workspace default, defaults.agentBudget)');
  });
});
