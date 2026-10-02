/**
 * A record's History and Change, in the browser (backlog 035):
 *
 *   - History lists versions with who, why and the field diff, and Restore
 *     goes to `businessObject.restore` and says what it did, with Undo;
 *   - selecting words on the record and choosing Change opens the chat with
 *     the passage and the change intent — the artifact gesture, the agent
 *     revises the record's body;
 *   - a version written elsewhere (the chat) reloads the history in place and
 *     marks that version.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    businessObject: { history: vi.fn(), restore: vi.fn() },
    review: { undoAction: vi.fn() },
  },
}));

vi.mock('@/features/dashboard/chat/agentSurface', () => ({ openAgentSurface: vi.fn(() => 'claimed') }));

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/objects/41',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { client } = await import('@/libs/Orpc');
const { openAgentSurface } = await import('@/features/dashboard/chat/agentSurface');
const { announceVersionWritten } = await import('@/features/dashboard/versions/versionEvents');
const { RecordHistory } = await import('./RecordHistory');
const { RecordChangeIntent } = await import('./RecordChangeIntent');

const HISTORY = {
  objectId: 41,
  objectType: 'request',
  title: 'Export the ledger as CSV',
  artifactId: 7,
  current: 3,
  versions: [
    { version: 3, createdAt: '2026-09-28T10:00:00.000Z', authorKind: 'human', authorId: 'u1', authorName: 'Priya Natarajan', reason: 'Changed acceptance criteria', actionRunId: 12, changes: [{ key: 'acceptance', label: 'Acceptance criteria', before: [{ statement: 'Old wording' }], after: [{ statement: 'New wording' }] }], drift: [], restorable: false },
    { version: 2, createdAt: '2026-09-27T10:00:00.000Z', authorKind: 'agent', authorId: 'agent:product-manager', authorName: 'product-manager', reason: 'Ranked.', actionRunId: 11, changes: [{ key: 'priority', label: 'Priority', before: null, after: 82 }], drift: [{ key: 'actualCents', label: 'Actual', before: 0, after: 1200 }], restorable: true },
    { version: 1, createdAt: '2026-09-26T10:00:00.000Z', authorKind: 'system', authorId: null, authorName: 'Vocion', reason: 'Created from the record', actionRunId: null, changes: [], drift: [], restorable: true },
  ],
};

beforeEach(() => {
  vi.mocked(client.businessObject.history).mockReset().mockResolvedValue(HISTORY as never);
  vi.mocked(client.businessObject.restore).mockReset();
  vi.mocked(openAgentSurface).mockClear();
  vi.mocked(client.review.undoAction).mockReset().mockResolvedValue({} as never);
});

describe('RecordHistory', () => {
  it('lists each version with who, why and what changed', async () => {
    const screen = await render(<RecordHistory objectId={41} />);

    await expect.element(screen.getByText('Changed acceptance criteria')).toBeInTheDocument();

    const rows = document.querySelectorAll('[data-testid="record-version"]');

    expect([...rows].map(r => r.getAttribute('data-version'))).toEqual(['3', '2', '1']);
    expect(rows[0]!.textContent).toContain('Priya Natarajan');
    expect(rows[0]!.textContent).toContain('Old wording');
    expect(rows[0]!.textContent).toContain('New wording');
    expect(rows[1]!.textContent).toContain('Also moved without this write: Actual');
    // The current version has nothing to restore.
    expect(rows[0]!.querySelector('[data-testid="record-version-restore"]')).toBeNull();
    expect(rows[1]!.querySelector('[data-testid="record-version-restore"]')).not.toBeNull();
  });

  it('restores through the restore route and offers Undo', async () => {
    vi.mocked(client.businessObject.restore).mockResolvedValue({ status: 'done', runId: 13, fields: ['priority'], version: 4 } as never);
    const screen = await render(<RecordHistory objectId={41} />);

    await expect.element(screen.getByRole('button', { name: 'Restore version 2' })).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Restore version 2' }).click();

    expect(client.businessObject.restore).toHaveBeenCalledWith({ id: 41, version: 2 });

    await expect.element(screen.getByText('Restored — now v4.')).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Undo' }).click();

    expect(client.review.undoAction).toHaveBeenCalledWith({ id: 13 });
  });
});

describe('RecordHistory — live', () => {
  it('reloads in place and marks the version when one is written for its record, and ignores other records', async () => {
    const screen = await render(<RecordHistory objectId={41} />);

    await expect.element(screen.getByText('Changed acceptance criteria')).toBeInTheDocument();
    expect(client.businessObject.history).toHaveBeenCalledTimes(1);

    announceVersionWritten({ ref: { type: 'object', id: '99' }, from: 1, to: 2 });
    announceVersionWritten({ ref: { type: 'object', id: '41' }, from: 2, to: 3, fields: ['acceptance'] });

    await expect.poll(() => vi.mocked(client.businessObject.history).mock.calls.length).toBe(2);
    await expect.element(page.getByTestId('record-version').first()).toHaveAttribute('aria-current', 'true');
  });

  it('opens on the version a link named', async () => {
    await render(<RecordHistory objectId={41} focusVersion={2} />);

    await expect.element(page.getByTestId('record-version').nth(1)).toHaveAttribute('aria-current', 'true');
  });
});

describe('RecordChangeIntent', () => {
  it('Change opens the chat with the passage and the change intent — the artifact gesture', async () => {
    await render(
      <div>
        <RecordChangeIntent objectId={41} title="Export the ledger as CSV" selectionRoot="[data-test-root]" />
        <div data-test-root>
          <ul data-record-field="acceptance"><li>Existing exports keep working</li></ul>
        </div>
      </div>,
    );

    // Select the line, the way a person drags across it.
    const li = document.querySelector('[data-record-field="acceptance"] li')!;
    const range = document.createRange();
    range.selectNodeContents(li);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    await expect.element(page.getByRole('toolbar', { name: 'Selected passage' })).toBeInTheDocument();

    const change = [...document.querySelectorAll('[role="toolbar"] button')].find(b => b.textContent?.includes('Change')) as HTMLElement;
    change.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    await expect.poll(() => vi.mocked(openAgentSurface).mock.calls.length).toBe(1);

    const [req] = vi.mocked(openAgentSurface).mock.calls[0]!;

    expect(req.context).toMatchObject({ record: { type: 'object', id: '41', label: 'Export the ledger as CSV' }, selection: { text: 'Existing exports keep working', quote: true } });
    expect(req.tags).toEqual([expect.objectContaining({ type: 'intent', id: 'change' })]);
    // Nothing is sent for the person: they say what it should say.
    expect(req.send).toBeFalsy();
  });
});
