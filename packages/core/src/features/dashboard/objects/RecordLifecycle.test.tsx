import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

/**
 * A thing owed carries its verbs where it is read (2026-10-23): Done and Drop
 * move the record through its own lifecycle on the agent's rail, with Undo;
 * Do it hands it to the team in the person's words. Fixtures are fictional.
 */

const push = vi.fn();
vi.mock('@/libs/I18nNavigation', () => ({ useRouter: () => ({ push, replace: () => {} }) }));

const propose = vi.fn();
const decideAction = vi.fn();
const undoAction = vi.fn();
vi.mock('@/libs/Orpc', () => ({ client: { review: { propose: (...a: unknown[]) => propose(...a), decideAction: (...a: unknown[]) => decideAction(...a), undoAction: (...a: unknown[]) => undoAction(...a) } } }));

const surface = vi.fn();
vi.mock('@/features/dashboard/chat/agentSurface', () => ({ openAgentSurface: (...a: unknown[]) => surface(...a) }));

const { RecordLifecycle, snoozeChoices } = await import('./RecordLifecycle');

const record = { type: 'object' as const, id: '412', label: 'Send Dana the deck' };

beforeEach(() => {
  propose.mockReset().mockResolvedValue({ runId: 77, status: 'done' });
  decideAction.mockReset().mockResolvedValue({});
  undoAction.mockReset().mockResolvedValue({});
  surface.mockReset();
});

describe('a record\'s verbs', () => {
  it('marks it done through objects.update_meta, then puts it back with Undo', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" />);

    await view.getByTestId('record-lifecycle-done').click();

    await expect.poll(() => view.container.querySelector('[data-testid="record-lifecycle-moved"]')?.textContent).toContain('Done.');
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'objects.update_meta', input: expect.objectContaining({ objectType: 'follow-up', id: 412, set: { status: 'done' } }) }));
    // Done on the person's click: nothing waits for another approval.
    expect(decideAction).not.toHaveBeenCalled();

    await view.getByTestId('record-lifecycle-undo').click();

    await expect.poll(() => undoAction.mock.calls.length).toBe(1);
    expect(undoAction).toHaveBeenCalledWith({ id: 77 });
    await expect.poll(() => view.container.querySelector('[data-testid="record-lifecycle-done"]')).not.toBeNull();
  });

  it('approves its own write when the workspace\'s trust rule parked it', async () => {
    propose.mockResolvedValue({ runId: 78, status: 'pending' });
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" />);

    await view.getByTestId('record-lifecycle-drop').click();

    await expect.poll(() => decideAction.mock.calls.length).toBe(1);
    expect(decideAction).toHaveBeenCalledWith({ id: 78, decision: 'approve' });
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ set: { status: 'dropped' } }) }));
  });

  it('hands the record to the team, sent at once and about this record', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" />);

    await view.getByTestId('record-lifecycle-do').click();

    expect(surface).toHaveBeenCalledWith(expect.objectContaining({ send: true, context: expect.objectContaining({ record }) }), expect.any(Function));
    expect(String(surface.mock.calls[0]![0].prompt)).toContain('Send Dana the deck');
  });

  it('offers Reopen, and nothing else, once finished', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="done" />);

    expect(view.container.querySelector('[data-testid="record-lifecycle-reopen"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="record-lifecycle-do"]')).toBeNull();

    await view.getByTestId('record-lifecycle-reopen').click();

    await expect.poll(() => propose.mock.calls.length).toBe(1);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ set: { status: 'open' } }) }));
  });

  it('on a microcard, is one quiet Done, and the finished state in words', async () => {
    const open = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" look="inline" />);

    expect(open.container.querySelector('[data-testid="record-lifecycle-done"]')?.getAttribute('aria-label')).toBe('Mark Send Dana the deck done');

    const finished = await render(<RecordLifecycle record={record} objectType="follow-up" status="dropped" look="inline" />);

    expect(finished.container.querySelector('[data-testid="record-lifecycle-state"]')?.textContent).toBe('Dropped');
  });

  it('offers nothing on a record that is neither owed nor finished — a candidate is judged in Review', async () => {
    const bar = await render(<RecordLifecycle record={record} objectType="follow-up" status="candidate" />);

    expect(bar.container.querySelector('[data-testid="record-lifecycle"]')).toBeNull();

    const chip = await render(<RecordLifecycle record={record} objectType="follow-up" status="rejected" look="inline" />);

    expect(chip.container.querySelector('[data-testid^="record-lifecycle"]')).toBeNull();
  });

  it('on a candidate, makes its pending Review decision in place: Approve, and the owed verbs follow', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="candidate" decideRunId={88} />);

    expect(view.container.querySelector('[data-testid="record-lifecycle-done"]')).toBeNull();

    await view.getByTestId('record-lifecycle-approve').click();

    await expect.poll(() => decideAction.mock.calls.length).toBe(1);
    expect(decideAction).toHaveBeenCalledWith({ id: 88, decision: 'approve' });
    await expect.poll(() => view.container.querySelector('[data-testid="record-lifecycle-do"]')).not.toBeNull();
  });

  it('on a candidate, Dismiss rejects its Review item and says so', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="candidate" decideRunId={88} />);

    await view.getByTestId('record-lifecycle-dismiss').click();

    await expect.poll(() => view.container.querySelector('[data-testid="record-lifecycle-dismissed"]')).not.toBeNull();
    expect(decideAction).toHaveBeenCalledWith(expect.objectContaining({ id: 88, decision: 'reject' }));
  });

  it('sits where the page puts it', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" className="mb-6" />);

    expect(view.container.querySelector('[data-testid="record-lifecycle"]')?.className).toContain('mb-6');
  });

  it('puts a snoozed record\'s date first, and Wake writes it back to now, with Undo', async () => {
    const view = await render(<RecordLifecycle record={record} objectType="follow-up" status="active" snoozedUntil="2026-11-02T17:00:00.000Z" />);

    expect(view.container.querySelector('[data-testid="record-lifecycle-snoozed"]')?.textContent).toContain('Snoozed until');
    expect(view.container.querySelector('[data-testid="record-lifecycle-snooze"]')).toBeNull();

    await view.getByTestId('record-lifecycle-wake').click();

    await expect.poll(() => propose.mock.calls.length).toBe(1);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ set: { snoozedUntil: null } }) }));
    await expect.poll(() => view.container.querySelector('[data-testid="record-lifecycle-moved"]')?.textContent).toContain('Back on the list.');
  });

  it('offers tomorrow, next Monday and two weeks out, each at nine', () => {
    // A Friday afternoon.
    const choices = snoozeChoices(new Date(2026, 9, 23, 15, 0));

    expect(choices.map(c => c.label)).toEqual(['Tomorrow', 'Next Monday', 'In 2 weeks']);
    expect(choices.map(c => [c.at.getDate(), c.at.getHours()])).toEqual([[24, 9], [26, 9], [6, 9]]);
  });
});
