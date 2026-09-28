/**
 * A record's History and Change, in the browser (backlog 035):
 *
 *   - History lists versions with who, why and the field diff, and Restore
 *     goes to `businessObject.restore` and says what it did, with Undo;
 *   - selecting words on the record and choosing Change sends the words, the
 *     new wording and the region's field to `businessObject.change` — the
 *     `objects.update_meta` write — and shows the result with Undo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    businessObject: { history: vi.fn(), restore: vi.fn(), change: vi.fn() },
    review: { undoAction: vi.fn() },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/objects/41',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { client } = await import('@/libs/Orpc');
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
  vi.mocked(client.businessObject.change).mockReset();
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

describe('RecordChangeIntent', () => {
  it('turns a selection and new wording into a change of the field it sits in', async () => {
    vi.mocked(client.businessObject.change).mockResolvedValue({ status: 'done', runId: 21, fields: ['acceptance'], version: 4, field: 'acceptance', label: 'Acceptance criteria', before: [], after: [] } as never);
    await render(
      <div>
        <RecordChangeIntent objectId={41} selectionRoot="[data-test-root]" showHistory={false} />
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

    const box = page.getByPlaceholder('What should it say instead?');

    await expect.element(box).toBeInTheDocument();

    await userEvent.fill(box, 'Existing PDF exports still download');
    await page.getByRole('button', { name: 'Change', exact: true }).click();

    expect(client.businessObject.change).toHaveBeenCalledWith({ id: 41, quote: 'Existing exports keep working', instruction: 'Existing PDF exports still download', field: 'acceptance' });

    await expect.element(page.getByText('Changed acceptance criteria — v4.')).toBeInTheDocument();
  });
});
