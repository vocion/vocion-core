import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The row under a turn: what it made, and what it set moving, followed live
 * (Chris, 2026-09-29: "End chat should give me something to click on to watch
 * and follow up"). Fixtures are fictional.
 */

const status = vi.fn(async (): Promise<Record<string, unknown>> => ({}));
vi.mock('@/libs/Orpc', () => ({ client: { preview: { status } } }));
const workspaceIntake = vi.fn((): { typeSlug: string; label: string; ownerSlug: string | null } | null => null);
vi.mock('./useWorkspaceIntake', () => ({ useWorkspaceIntake: () => workspaceIntake(), loadWorkspaceIntake: async () => workspaceIntake() }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ArtifactChips } = await import('./ArtifactChips');
const { AgentMessage } = await import('./AgentMessage');

const FOLLOW = [
  { label: 'run #419', href: '/dashboard/p/runs/419', ref: { type: 'worker_run' as const, id: '419' } },
  { label: 'ask #221', href: '/dashboard/inbox/221', ref: { type: 'ask' as const, id: '221' } },
];

beforeEach(() => {
  status.mockReset();
  window.history.replaceState(null, '', window.location.pathname);
});

afterEach(() => window.history.replaceState(null, '', window.location.pathname));

describe('what a turn set moving, in the artifact row', () => {
  it('each thing is a chip with a live status dot, in the artifact chips\' own row', async () => {
    status.mockResolvedValue({ 'worker_run:419': { state: 'running', label: 'running' }, 'ask:221': { state: 'done', label: 'approved' } });
    await render(<TooltipProvider><ArtifactChips artifacts={[{ id: 7, title: 'Kestrel brief', kind: 'markdown', version: 1 }]} follow={FOLLOW} /></TooltipProvider>);

    await expect.element(page.getByText('Run #419')).toBeInTheDocument();
    await expect.poll(() => document.querySelector('[data-follow-chip="worker_run:419"]')?.getAttribute('data-follow-state')).toBe('running');
    expect(document.querySelector('[data-follow-chip="ask:221"]')?.getAttribute('data-follow-state')).toBe('done');
    // One row: the artifact and the follow-ups share it.
    expect(document.querySelectorAll('[data-artifact-chips] > li')).toHaveLength(3);
    expect(status).toHaveBeenCalledWith({ refs: [{ type: 'worker_run', id: '419' }, { type: 'ask', id: '221' }] });
  });

  it('a run opens in the preview pane; an ask opens its page', async () => {
    status.mockResolvedValue({});
    await render(<TooltipProvider><ArtifactChips artifacts={[]} follow={FOLLOW} /></TooltipProvider>);

    await userEvent.click(page.getByText('Run #419'));

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('worker_run:419');
    await expect.element(page.getByRole('link', { name: /Ask #221/ })).toHaveAttribute('href', '/dashboard/inbox/221');
  });

  it('stops asking once everything has settled', async () => {
    status.mockResolvedValue({ 'worker_run:419': { state: 'done', label: 'completed' }, 'ask:221': { state: 'done', label: 'approved' } });
    await render(<TooltipProvider><ArtifactChips artifacts={[]} follow={FOLLOW} /></TooltipProvider>);

    await expect.poll(() => status.mock.calls.length).toBe(1);

    await new Promise(r => setTimeout(r, 200));

    expect(status).toHaveBeenCalledTimes(1);
  });

  it('an answer whose step started a build ends with the chip for that run', async () => {
    status.mockResolvedValue({ 'worker_run:419': { state: 'queued', label: 'queued' } });
    await render(
      <TooltipProvider>
        <AgentMessage
          agentName="Squatch"
          message={{
            role: 'assistant',
            content: 'Started the build.',
            runs: [
              { type: 'tool', name: 'propose_action', input: { action_id: 'factory.dispatch_task' }, output: 'factory.dispatch_task is DONE (run #5301, confidence 0.95) — ran. Result: {"workerRunId":419}', state: 'done' },
              { type: 'text', text: 'Started the build.' },
            ],
          }}
        />
      </TooltipProvider>,
    );

    await expect.poll(() => document.querySelector('[data-follow-chip="worker_run:419"]')?.getAttribute('data-follow-state')).toBe('queued');
  });
});

describe('Build it on a card a turn drew', () => {
  const CARDS = [
    { id: 41, title: 'Request link creator UI', kind: 'record' as const, version: 1 },
    { id: 42, title: 'Send history', kind: 'table' as const, version: 1 },
  ];

  it('is offered on a record card when the workspace has an intake, and sends the card once', async () => {
    workspaceIntake.mockReturnValue({ typeSlug: 'request', label: 'Request', ownerSlug: 'product-manager' });
    const onBuild = vi.fn();
    await render(<TooltipProvider><ArtifactChips artifacts={CARDS} onBuild={onBuild} /></TooltipProvider>);

    const build = page.getByRole('button', { name: 'Build Request link creator UI' });
    await build.click();

    expect(onBuild).toHaveBeenCalledWith(CARDS[0]);
    await expect.element(page.getByText('Sent to build')).toBeInTheDocument();
    await expect.element(build).toBeDisabled();
    // A table is not an idea to build.
    await expect.element(page.getByRole('button', { name: 'Build Send history' })).not.toBeInTheDocument();
  });

  it('is absent when the workspace has no intake', async () => {
    workspaceIntake.mockReturnValue(null);
    await render(<TooltipProvider><ArtifactChips artifacts={CARDS} onBuild={vi.fn()} /></TooltipProvider>);

    await expect.element(page.getByText('Build it')).not.toBeInTheDocument();
  });
});
