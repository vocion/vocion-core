import type { WorkItem, WorkView } from '@/services/work/WorkService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/libs/Orpc', () => ({
  client: { work: { forConversation: vi.fn(), stop: vi.fn() } },
}));

const { client } = await import('@/libs/Orpc');
const { chipLine, ConversationWork, RunningWorkChip, RunningWorkPanel } = await import('./RunningWork');

const now = Date.now();
const item = (over: Partial<WorkItem>): WorkItem => ({
  key: 'mission:1',
  kind: 'mission',
  title: 'Reconcile the Northwind invoices',
  what: 'Mission',
  state: 'running',
  startedAt: new Date(now - 95_000).toISOString(),
  endedAt: null,
  href: '/dashboard/missions/runs/1',
  canStop: true,
  ...over,
});

const VIEW: WorkView = {
  running: [
    item({}),
    item({ key: 'worker:4', kind: 'worker', title: 'Fix the export button', what: 'Background task', href: '/dashboard/activity' }),
  ],
  finished: [
    item({ key: 'workflow:9', kind: 'workflow', title: 'Weekly digest', what: 'Workflow', state: 'failed', endedAt: new Date(now - 30_000).toISOString(), href: '/dashboard/workflows/weekly-digest', canStop: false }),
  ],
};

beforeEach(() => {
  vi.mocked(client.work.forConversation).mockReset();
  vi.mocked(client.work.stop).mockReset();
});

describe('what the chip says', () => {
  it('counts what runs and what finished, and is absent when there is nothing', () => {
    expect(chipLine(VIEW)).toBe('1 finished, 2 running');
    expect(chipLine({ running: [VIEW.running[0]!], finished: [] })).toBe('1 running');
    expect(chipLine({ running: [], finished: VIEW.finished })).toBe('1 finished');
    expect(chipLine({ running: [], finished: [] })).toBeNull();
  });
});

describe('the panel', () => {
  it('lists running work with Stop, and folds the finished behind "Finished N"', async () => {
    const onStop = vi.fn();
    await render(<RunningWorkPanel view={VIEW} onStop={onStop} />);

    const rows = page.getByTestId('work-item');

    await expect.element(rows.first()).toHaveTextContent('Reconcile the Northwind invoices');
    expect(rows.elements()).toHaveLength(2);
    expect(page.getByText('Weekly digest').elements()).toHaveLength(0);

    await userEvent.click(page.getByTestId('work-item-stop').first());

    expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ key: 'mission:1' }));

    await userEvent.click(page.getByTestId('work-finished-toggle'));

    await expect.element(page.getByText('Weekly digest')).toBeVisible();
    // A finished run says how it ended, in words, and links to its run.
    await expect.element(page.getByTestId('work-item').last()).toHaveTextContent('Failed');
    expect(page.getByTestId('work-item-link').last().element().getAttribute('href')).toContain('/dashboard/workflows/weekly-digest');
  });

  it('offers no Stop where the run has none', async () => {
    await render(<RunningWorkPanel view={{ running: [item({ canStop: false })], finished: [] }} onStop={vi.fn()} />);

    await expect.element(page.getByTestId('work-item')).toBeInTheDocument();
    expect(page.getByTestId('work-item-stop').elements()).toHaveLength(0);
  });
});

describe('the chip', () => {
  it('draws nothing when no work is behind the conversation', async () => {
    const screen = await render(<RunningWorkChip view={{ running: [], finished: [] }} onChanged={vi.fn()} />);

    expect(screen.container.querySelector('[data-testid="running-work-chip"]')).toBeNull();
  });

  it('opens the panel, and a Stop reads the work again', async () => {
    vi.mocked(client.work.stop).mockResolvedValue({ stopped: true });
    const onChanged = vi.fn();
    await render(<RunningWorkChip view={VIEW} onChanged={onChanged} />);

    await expect.element(page.getByTestId('running-work-chip')).toHaveTextContent('1 finished, 2 running');

    await userEvent.click(page.getByTestId('running-work-chip'));

    await expect.element(page.getByTestId('running-work-panel')).toBeVisible();

    await userEvent.click(page.getByTestId('work-item-stop').first());

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());

    expect(client.work.stop).toHaveBeenCalledWith({ key: 'mission:1' });
  });

  it('reads the conversation\'s work, and nothing for a new conversation', async () => {
    vi.mocked(client.work.forConversation).mockResolvedValue(VIEW);
    await render(<ConversationWork session={{ conversationId: 12, isStreaming: false }} />);

    await expect.element(page.getByTestId('running-work-chip')).toHaveTextContent('2 running');

    expect(client.work.forConversation).toHaveBeenCalledWith({ conversationId: 12 });

    vi.mocked(client.work.forConversation).mockClear();
    await render(<ConversationWork session={{ conversationId: null }} />);

    expect(client.work.forConversation).not.toHaveBeenCalled();
  });
});
