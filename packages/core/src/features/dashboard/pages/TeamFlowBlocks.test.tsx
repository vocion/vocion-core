import type { FlowStepView, TeamBlockView, TeamMemberView } from '@/services/workspace/teamFlow';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * A page's `team` and `flow` blocks (Chris, 2026-10-20: "those concepts —
 * agent teams, workflows — should be visual in-platform"): the team reads as a
 * lead above the agents that report to it, each with its month; the flow reads
 * as numbered steps, a person's approval marked apart. Fixture data; every
 * name is invented.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { FlowBlock, TeamBlock } = await import('./TeamFlowBlocks');

const NOW = Date.parse('2026-10-20T19:00:00Z');

const member = (over: Partial<TeamMemberView> & { slug: string; name: string }): TeamMemberView => ({
  eyebrow: null,
  owns: null,
  lead: false,
  skills: [],
  systems: [],
  month: { conversations: 0, documents: 0, proposals: 0, approved: 0 },
  ...over,
});

const TEAM: TeamBlockView = {
  name: 'Northwind Finance',
  goal: 'Close the books on time',
  accountable: 'Dana Reyes',
  monthLabel: 'October 2026',
  lead: member({ slug: 'controller', name: 'Controller', lead: true, owns: 'Owns the close.', month: { conversations: 12, documents: 4, proposals: 3, approved: 2 } }),
  members: [
    member({ slug: 'bookkeeper', name: 'Bookkeeper', skills: ['Categorize expense', 'Reconcile', 'Journal entry', 'AP run', 'AR aging'], systems: ['QuickBooks'] }),
    member({ slug: 'analyst', name: 'Financial Analyst', systems: ['Google Drive', 'Zoom'] }),
  ],
};

describe('team block', () => {
  it('draws the lead, the agents under it, and each one\'s month', async () => {
    render(<TeamBlock title="The team" team={TEAM} />);

    await expect.element(page.getByTestId('team-agent-controller')).toHaveTextContent('Lead');
    await expect.element(page.getByTestId('team-agent-controller')).toHaveTextContent('12Asks4Docs');
    await expect.element(page.getByTestId('team-agent-bookkeeper')).toHaveTextContent('+1 more');
    await expect.element(page.getByTestId('team-agent-analyst')).toHaveTextContent('Google Drive');
    await expect.element(page.getByTestId('team-block')).toHaveTextContent('Accountable: Dana Reyes');
    await expect.element(page.getByTestId('team-tree')).toBeInTheDocument();
  });

  it('says so when the workspace has no team', async () => {
    render(<TeamBlock title="The team" team={null} />);

    await expect.element(page.getByText('This workspace has no team yet.')).toBeInTheDocument();
  });
});

const step = (over: Partial<FlowStepView> & { title: string }): FlowStepView => ({ agentName: null, monitor: null, produced: [], ...over });

describe('flow block', () => {
  it('numbers the steps, names who does each, and marks a person\'s approval', async () => {
    render(
      <FlowBlock
        title="How the month runs"
        now={NOW}
        timeZone="UTC"
        steps={[
          step({ title: 'Code expenses', agent: 'bookkeeper', agentName: 'Bookkeeper', cadence: 'Every Monday' }),
          step({ title: 'Reconcile', agent: 'controller', agentName: 'Controller', produced: [{ id: 41, title: 'Reconciliation · Sep 30' }] }),
          step({ title: 'Approve and send', person: 'The partners' }),
        ]}
      />,
    );

    await expect.element(page.getByTestId('flow-step-1')).toHaveTextContent('Every Monday');
    await expect.element(page.getByTestId('flow-step-2')).toHaveTextContent('Reconciliation · Sep 30');
    await expect.element(page.getByTestId('flow-step-3')).toHaveTextContent('The partners · approves');
    await expect.element(page.getByRole('link', { name: 'Reconciliation · Sep 30' })).toHaveAttribute('href', '/dashboard/artifacts/41');
  });
});
