import type { AutonomyPolicyView } from '@/services/autonomy/AutonomyService';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The goal a person named during setup sits under the rung, with the day it
 * was set. A row nobody named a goal for shows no goal line, and a setter who
 * cannot be resolved is left out rather than shown as an id.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { AutonomyTable } = await import('./AutonomyTable');

const SET_AT = new Date('2026-10-02T15:30:00Z');

function policy(overrides: Partial<AutonomyPolicyView>): AutonomyPolicyView {
  return {
    actionId: 'git.merge',
    name: 'Merge a pull request',
    registered: true,
    external: true,
    neverAuto: false,
    rung: 'execute-with-approval',
    riskTier: 'medium',
    minConfidence: 0.8,
    automates: false,
    promotedAt: null,
    promotedBy: null,
    evidence: null,
    flagged: false,
    flagReason: null,
    source: 'default',
    alignment: { agreementRate: null, n: 0, agreed: 0, decided: 0, rejected: 0, withNote: 0, window: '30d' },
    eligibility: { earned: false, nextRung: 'execute-within-bounds', reason: 'Needs 10 decisions' } as AutonomyPolicyView['eligibility'],
    goalRung: null,
    goalSetByName: null,
    goalSetAt: null,
    ...overrides,
  };
}

describe('the Autonomy table goal line', () => {
  it('shows the goal, who set it, and the date', async () => {
    render(<AutonomyTable isAdmin={false} policies={[policy({ goalRung: 'execute-within-bounds', goalSetByName: 'Avery Stone', goalSetAt: SET_AT })]} />);

    const line = page.getByText(/^Goal: Execute within bounds, set by Avery Stone on /);

    await expect.element(line).toBeVisible();
    await expect.element(line).toHaveTextContent(/2026|10\/2|Oct/);
  });

  it('drops the "by" clause when the setter cannot be resolved, and never shows an id', async () => {
    render(<AutonomyTable isAdmin={false} policies={[policy({ goalRung: 'assist', goalSetByName: null, goalSetAt: SET_AT })]} />);

    const line = page.getByText(/^Goal: Assist, set on /);

    await expect.element(line).toBeVisible();
    await expect.element(line).not.toHaveTextContent('set by');
  });

  it('shows no goal line for a row without a goal', async () => {
    render(<AutonomyTable isAdmin={false} policies={[policy({})]} />);

    await expect.element(page.getByText('Merge a pull request')).toBeVisible();
    expect(document.body.textContent).not.toContain('Goal:');
  });
});
