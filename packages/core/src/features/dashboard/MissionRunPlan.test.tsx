/**
 * The mission run page says why a task did not run, and why the run stopped
 * (vocion-core#121, #122).
 *
 * The runtime writes a reason onto every task it skips and onto every run it
 * fails, but the page drew only each task's status and put the run's error
 * in small print under Coaching, so a person saw "skipped" and "failed" with
 * nothing to act on.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MissionRunPlan, MissionRunStopReason } from './MissionRunPlan';

function task(over: Partial<Parameters<typeof MissionRunPlan>[0]['tasks'][number]>) {
  return { id: 't1', title: 'Research', ownerAgentSlug: 'agent-x', type: 'analysis', status: 'completed', ...over };
}

describe('MissionRunPlan', () => {
  it('shows why a task was skipped and why a task failed, under each one', async () => {
    await render(
      <MissionRunPlan
        tasks={[
          task({ id: 'research', title: 'Research', status: 'failed', error: 'Error: the search API timed out' }),
          task({ id: 'draft', title: 'Draft', status: 'skipped', error: 'Skipped: it depends on "Research", which failed.' }),
        ]}
      />,
    );

    await expect.element(page.getByText('Skipped: it depends on "Research", which failed.')).toBeVisible();
    await expect.element(page.getByText('Error: the search API timed out')).toBeVisible();
  });

  it('does not show a leftover error on a task that went on to complete', async () => {
    await render(<MissionRunPlan tasks={[task({ status: 'completed', error: 'an earlier attempt failed' })]} />);

    await expect.element(page.getByText('Research')).toBeVisible();
    expect(page.getByText('an earlier attempt failed').elements()).toHaveLength(0);
  });

  it('says it is still planning before there is a plan', async () => {
    await render(<MissionRunPlan tasks={[]} />);

    await expect.element(page.getByText('Planning…')).toBeVisible();
  });
});

describe('MissionRunStopReason', () => {
  it('leads a failed run with why it failed', async () => {
    await render(<MissionRunStopReason status="failed" error="Planning failed: Error: planner exploded" />);

    await expect.element(page.getByRole('alert')).toHaveTextContent('Run failed');
    await expect.element(page.getByRole('alert')).toHaveTextContent('Planning failed: Error: planner exploded');
  });

  it('calls a cancelled run cancelled, not failed', async () => {
    await render(<MissionRunStopReason status="cancelled" error="stopped by the operator" />);

    await expect.element(page.getByRole('alert')).toHaveTextContent('Run cancelled');
  });

  it('shows nothing for a run that is still going or finished cleanly', async () => {
    await render(<MissionRunStopReason status="completed" error={null} />);

    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });
});
