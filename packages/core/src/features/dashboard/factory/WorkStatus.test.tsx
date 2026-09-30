import type { RecordStatus, TurnRecord } from '@/libs/factory/liveStatus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * The chat's microcard and the three lines (Chris, 2026-09-30: "Is a plan run
 * happening? I have no way to see that or click in." … "an intelligent 1ish
 * line chip? Microcard?"). Fixtures are fictional.
 */

const undoAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 'undone' })));
vi.mock('@/libs/Orpc', () => ({ client: { review: { undoAction } } }));

const { LIVE_POLL_MS, RecordMicrocard, WorkStatus } = await import('./WorkStatus');

const planning: RecordStatus = {
  record: { id: 265, objectType: 'request', title: 'Fix the header overflow', href: '/dashboard/p/feature/265' },
  stage: { key: 'planning', label: 'Planning', tone: 'info' },
  you: { needsYou: false, line: 'Nothing needs you', why: null, move: null },
  live: { kind: 'planning', label: 'Writing the plan', step: null, runRef: { type: 'mission_run', id: '6414' }, runHref: '/dashboard/p/runs/agent-6414', runLabel: 'Agent run #6414', startedAt: new Date(Date.now() - 65_000).toISOString(), since: 'started' },
  next: 'The build starts when the plan is approved.',
  readAt: new Date().toISOString(),
};
const approved: RecordStatus = { ...planning, stage: { key: 'approve', label: 'Build proposed', tone: 'warn' }, live: null, next: 'Once it is approved, a worker picks it up and the engineer builds it.' };

const filed: TurnRecord = { id: 265, title: 'Fix the header overflow', href: '/dashboard/p/feature/265', filed: true, change: null, hasStatus: true };

const fetchMock = vi.fn();

function answer(body: RecordStatus) {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', window.location.pathname);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname);
});

describe('the record microcard under a chat turn', () => {
  it('is one line: the number, the title and what is running, with a live dot, and opens the record in the pane', async () => {
    fetchMock.mockResolvedValue(answer(planning));
    await render(<RecordMicrocard record={filed} />);

    const card = page.getByTestId('record-microcard');

    await expect.element(page.getByTestId('record-microcard-now')).toHaveTextContent('· Writing the plan · 1 min');
    await expect.element(card).toHaveTextContent('#265');
    await expect.element(card).toHaveTextContent('Fix the header overflow');
    expect(card.element().getAttribute('data-live')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/objects/265/status', expect.objectContaining({ credentials: 'same-origin' }));

    await page.getByTestId('record-microcard-open').click();

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('object:265');
  });

  it('keeps re-reading while something runs, and stops once nothing does', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fetchMock.mockResolvedValueOnce(answer(planning)).mockResolvedValue(answer(approved));
    await render(<RecordMicrocard record={filed} />);

    await expect.element(page.getByTestId('record-microcard-now')).toBeInTheDocument();

    vi.advanceTimersByTime(LIVE_POLL_MS);

    await expect.element(page.getByTestId('record-microcard-stage')).toHaveTextContent('Build proposed');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(LIVE_POLL_MS * 5);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says what a change wrote, from the version it made, and opens that version', async () => {
    fetchMock.mockResolvedValue(answer(approved));
    await render(<RecordMicrocard record={{ ...filed, filed: false, change: { fields: ['acceptance'], version: 3, historyRef: '265@3' } }} />);

    const change = page.getByTestId('record-microcard-change');

    await expect.element(change).toHaveTextContent('Changed acceptance · v3');

    await change.click();

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('record_history:265@3');
  });

  it('does not read a status for a record whose type has none', async () => {
    await render(<RecordMicrocard record={{ ...filed, hasStatus: false }} />);

    await expect.element(page.getByTestId('record-microcard')).toHaveTextContent('Fix the header overflow');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the three lines', () => {
  it('say You, Now and Next, with the run to open', async () => {
    await render(<WorkStatus status={planning} />);

    await expect.element(page.getByTestId('work-status-stage')).toHaveTextContent('Planning');
    await expect.element(page.getByTestId('work-status-you')).toHaveTextContent('Nothing needs you');
    await expect.element(page.getByTestId('work-status-now')).toHaveTextContent('Writing the plan');
    await expect.element(page.getByTestId('work-status-run')).toHaveTextContent('Agent run #6414');
    await expect.element(page.getByTestId('work-status-next')).toHaveTextContent('The build starts when the plan is approved.');
  });

  it('say "Nothing running" when nothing is, and name the move when a person holds it', async () => {
    await render(<WorkStatus status={{ ...approved, you: { needsYou: true, line: 'Needs you: Build it', why: 'A build card is waiting', move: { label: 'Build it', href: '/dashboard/p/feature/265#feature-decide' } } }} />);

    await expect.element(page.getByTestId('work-status-now')).toHaveTextContent('Nothing running');
    await expect.element(page.getByRole('link', { name: 'Build it' })).toHaveAttribute('href', '/dashboard/p/feature/265#feature-decide');
  });
});

describe('a duplicate (backlog 044)', () => {
  const duplicate: RecordStatus = {
    ...approved,
    record: { ...approved.record, id: 268 },
    stage: { key: 'duplicate', label: 'Duplicate of #265', tone: 'muted' },
    next: null,
    duplicate: { of: { id: 265, title: 'Fix the header overflow', href: '/dashboard/p/feature/265' }, reason: 'Both ask that the header stops overflowing on a phone.', confidence: 0.93, undoRunId: 5401 },
  };

  it('says which record it repeats and why, in one line, with Undo', async () => {
    await render(<WorkStatus status={duplicate} />);

    await expect.element(page.getByTestId('work-status-duplicate')).toHaveTextContent('Same as #265 Fix the header overflow — Both ask that the header stops overflowing on a phone.');
    await expect.element(page.getByRole('link', { name: '#265 Fix the header overflow' })).toHaveAttribute('href', '/dashboard/p/feature/265');

    await page.getByTestId('work-status-duplicate-undo').click();

    expect(undoAction).toHaveBeenCalledWith({ id: 5401 });
  });

  it('reads as a duplicate on the microcard, with Undo beside it', async () => {
    fetchMock.mockResolvedValue(answer(duplicate));
    await render(<RecordMicrocard record={{ ...filed, id: 268 }} />);

    await expect.element(page.getByTestId('record-microcard-stage')).toHaveTextContent('· Duplicate of #265');
    await expect.element(page.getByTestId('work-status-duplicate-undo')).toBeVisible();
  });
});
