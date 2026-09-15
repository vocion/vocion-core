import { ORPCError } from '@orpc/client';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ReviewQueue } from './ReviewQueue';

/**
 * Approving or cancelling a paused workflow run can now lose a race — a
 * second reviewer, or a second tab, resolving the same run first — and the
 * server answers with a CONFLICT carrying a plain message. This pins the
 * reviewer-facing side of that: the banner shows the server's message, and
 * the stale card is refetched away instead of sitting there offering a
 * button that can never work again.
 */

const listWorkflowRuns = vi.fn();
const resumeWorkflow = vi.fn();
const cancelWorkflow = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    review: {
      listWorkflowRuns: (input: { status: string; limit: number }) => listWorkflowRuns(input),
      resumeWorkflow: (input: { id: number; input?: string }) => resumeWorkflow(input),
      cancelWorkflow: (input: { id: number }) => cancelWorkflow(input),
    },
  },
}));

const CONFLICT_MESSAGE = 'This run is no longer resumable — someone may have already approved it, or it has moved on.';

function pausedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    workflowId: 9,
    status: 'paused',
    currentStep: 2,
    pauseReason: 'awaiting_approval:approve_step',
    stepResults: {},
    error: null,
    workspaceSha: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

async function openCard() {
  await page.getByRole('button', { name: /Workflow run #501/ }).click();
}

describe('resuming a workflow run that already moved on', () => {
  it('shows the server\'s message instead of failing silently', async () => {
    listWorkflowRuns.mockReset();
    resumeWorkflow.mockReset();
    resumeWorkflow.mockRejectedValue(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    listWorkflowRuns.mockResolvedValue([]);
    render(<ReviewQueue initialWorkflowRuns={[pausedRun()]} />);
    await openCard();

    await page.getByRole('button', { name: 'Approve + resume' }).click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();
  });

  it('refetches the queue on the failed approve, so the resolved run drops off the list', async () => {
    listWorkflowRuns.mockReset();
    resumeWorkflow.mockReset();
    resumeWorkflow.mockRejectedValue(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    // The refetch after the lost race finds the run already resolved
    // elsewhere, so it comes back empty — proof the stale card was not left
    // clickable.
    listWorkflowRuns.mockResolvedValue([]);
    render(<ReviewQueue initialWorkflowRuns={[pausedRun()]} />);
    await openCard();

    await page.getByRole('button', { name: 'Approve + resume' }).click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();
    await expect.element(page.getByText('Nothing pending review — queue is empty.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Workflow run #501/ })).not.toBeInTheDocument();
  });
});

describe('cancelling a workflow run that already moved on', () => {
  it('shows the conflict message and clears the stale card the same way', async () => {
    listWorkflowRuns.mockReset();
    cancelWorkflow.mockReset();
    cancelWorkflow.mockRejectedValue(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    listWorkflowRuns.mockResolvedValue([]);
    render(<ReviewQueue initialWorkflowRuns={[pausedRun()]} />);
    await openCard();

    await page.getByRole('button', { name: 'Cancel run' }).click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();
    await expect.element(page.getByText('Nothing pending review — queue is empty.')).toBeVisible();
  });
});
