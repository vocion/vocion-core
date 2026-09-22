import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * The banner renders only what the server decided (see Workspace.drift.test
 * for the deciding). What it must never do: offer Apply on another project's
 * folder or a git-managed one, apply without showing the diff first, or come
 * back on every page load after a dismiss.
 */

const driftStatus = vi.fn();
const driftDiff = vi.fn();
const applyNow = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    context: {
      driftStatus: () => driftStatus(),
      driftDiff: () => driftDiff(),
      applyNow: (input: { sha: string }) => applyNow(input),
    },
  },
}));

// The version-history link renders through the locale-aware Link; an anchor is enough here.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { WorkspaceDriftBanner } = await import('./WorkspaceDriftBanner');

const base = { available: true as const, projectId: 'proj_a', path: '/ws/a', currentSha: 'sha-1', appliedSha: 'sha-0', neverApplied: false, own: true, owner: null, deployManaged: false, inFlight: false, drifted: true };
const counts = { agents: { created: 1, updated: 2, unchanged: 3 }, skills: { created: 0, updated: 0, unchanged: 4 } };

beforeEach(() => {
  localStorage.clear();
  driftStatus.mockReset();
  driftDiff.mockReset().mockResolvedValue({ sha: 'sha-1', counts, changes: 3, errors: [] });
  applyNow.mockReset().mockResolvedValue({ sha: 'sha-1', counts, errors: [] });
});

afterEach(() => {
  localStorage.clear();
});

describe('WorkspaceDriftBanner', () => {
  it('another project\'s folder: names the owner, links the version history, offers no Apply', async () => {
    driftStatus.mockResolvedValue({ ...base, own: false, drifted: false, owner: { id: 'proj_b', slug: 'metacto-revenue', name: 'Metacto Revenue' } });
    const screen = await render(<WorkspaceDriftBanner />);

    // The owner is named by SLUG, not by display name: the slug is what the
    // reader will type or grep for, and the line has to survive a phone.
    await expect.element(screen.getByRole('status')).toHaveTextContent('metacto-revenue');
    await expect.element(screen.getByRole('status')).toHaveTextContent('applied from git');
    await expect.element(screen.getByRole('link', { name: 'Version history' })).toHaveAttribute('href', '/dashboard/workspace#versions');
    expect(screen.container.textContent).not.toContain('Apply');
    expect(driftDiff).not.toHaveBeenCalled();
  });

  it('a git-managed project: says the next deploy applies it, offers no Apply', async () => {
    driftStatus.mockResolvedValue({ ...base, deployManaged: true });
    const screen = await render(<WorkspaceDriftBanner />);

    await expect.element(screen.getByRole('status')).toHaveTextContent('the next deploy applies it');
    await expect.element(screen.getByRole('link', { name: 'Version history' })).toBeVisible();
    expect(screen.container.textContent).not.toContain('Review & apply');
    expect(driftDiff).not.toHaveBeenCalled();
  });

  it('the project\'s own folder with changes: shows the count, opens the diff, applies only on confirm with the reviewed sha', async () => {
    driftStatus.mockResolvedValue(base);
    const onApplied = vi.fn();
    const screen = await render(<WorkspaceDriftBanner onApplied={onApplied} />);

    await expect.element(screen.getByRole('status')).toHaveTextContent('3 workspace changes not applied yet');

    await screen.getByRole('button', { name: 'Review & apply' }).click();

    await expect.element(page.getByRole('dialog')).toBeVisible();
    await expect.element(page.getByRole('dialog')).toHaveTextContent('agents');
    await expect.element(page.getByRole('dialog')).toHaveTextContent('1 new · 2 updated');
    expect(page.getByRole('dialog').element().textContent).not.toContain('skills');
    expect(applyNow).not.toHaveBeenCalled();

    await page.getByRole('button', { name: 'Apply 3 changes' }).click();
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledOnce());

    expect(applyNow).toHaveBeenCalledWith({ sha: 'sha-1' });
  });

  it('cancelling the review applies nothing', async () => {
    driftStatus.mockResolvedValue(base);
    const screen = await render(<WorkspaceDriftBanner onApplied={() => {}} />);
    await screen.getByRole('button', { name: 'Review & apply' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await vi.waitFor(() => expect(page.getByRole('dialog').query()).toBeNull());

    expect(applyNow).not.toHaveBeenCalled();
  });

  it('an empty diff shows nothing, and is not asked again for that sha', async () => {
    driftStatus.mockResolvedValue(base);
    driftDiff.mockResolvedValue({ sha: 'sha-1', counts: { agents: { created: 0, updated: 0, unchanged: 3 } }, changes: 0, errors: [] });
    const screen = await render(<WorkspaceDriftBanner />);
    await vi.waitFor(() => expect(driftDiff).toHaveBeenCalledOnce());

    expect(screen.container.querySelector('[role=status]')).toBeNull();
    expect(localStorage.getItem('vocion_drift_dismissed:proj_a:sha-1')).not.toBeNull();
  });

  it('a deploy in flight, or a folder in sync, shows nothing', async () => {
    driftStatus.mockResolvedValue({ ...base, inFlight: true });
    const a = await render(<WorkspaceDriftBanner />);
    await vi.waitFor(() => expect(driftStatus).toHaveBeenCalled());

    expect(a.container.querySelector('[role=status]')).toBeNull();

    await a.unmount();

    driftStatus.mockResolvedValue({ ...base, drifted: false });
    const b = await render(<WorkspaceDriftBanner />);
    await new Promise(r => setTimeout(r, 50));

    expect(b.container.querySelector('[role=status]')).toBeNull();
  });

  it('dismiss is remembered per project and folder sha, and the strip returns when the folder changes', async () => {
    driftStatus.mockResolvedValue({ ...base, own: false, drifted: false, owner: null });
    const first = await render(<WorkspaceDriftBanner />);
    await first.getByRole('button', { name: 'Dismiss' }).click();

    expect(first.container.querySelector('[role=status]')).toBeNull();
    expect(localStorage.getItem('vocion_drift_dismissed:proj_a:sha-1')).not.toBeNull();

    await first.unmount();

    // Same folder, next page load: quiet.
    const second = await render(<WorkspaceDriftBanner />);
    await vi.waitFor(() => expect(driftStatus).toHaveBeenCalledTimes(2));
    await new Promise(r => setTimeout(r, 50));

    expect(second.container.querySelector('[role=status]')).toBeNull();

    await second.unmount();

    // The folder moved on: the strip is back.
    driftStatus.mockResolvedValue({ ...base, own: false, drifted: false, owner: null, currentSha: 'sha-2' });
    const third = await render(<WorkspaceDriftBanner />);

    await expect.element(third.getByRole('status')).toBeVisible();
  });
});
