import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    anchoredComments: { list: vi.fn(), create: vi.fn(), apply: vi.fn(), delete: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { CommentLayerProvider, useCommentLayer } = await import('./CommentLayer');
const { CommentChips } = await import('./AnchoredComments');

const BODY = 'The angle rests on two sourced facts. The weakest point is the unverified email address.';
const FIELD = 'Recommended angle';

/** A stand-in for the dock: renders the chips the layer holds. */
function ChipSurface() {
  const layer = useCommentLayer();
  if (!layer) {
    return null;
  }
  return (
    <CommentChips
      comments={layer.open}
      activeId={layer.activeId}
      onFocus={layer.focusComment}
      onRemove={id => void layer.removeComment(id)}
    />
  );
}

function Harness() {
  return (
    <CommentLayerProvider targetRef="lead_brief:1">
      <div>
        <div data-comment-field={FIELD}>{BODY}</div>
      </div>
      <ChipSurface />
    </CommentLayerProvider>
  );
}

/**
 * Select `text` inside the commentable region and release the mouse.
 * @param text
 */
async function selectText(text: string) {
  await page.getByText(BODY).element();
  const region = document.querySelector('[data-comment-field]')!;
  const node = region.firstChild!;
  const start = BODY.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

const storedComment = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  field: FIELD,
  note: 'soften this',
  status: 'open',
  anchor: { quote: 'two sourced facts', prefix: 'rests on ', suffix: '. The weakest' },
  range: { start: BODY.indexOf('two sourced facts'), end: BODY.indexOf('two sourced facts') + 17, exact: true },
  ...over,
});

beforeEach(() => {
  vi.mocked(client.anchoredComments.list).mockReset().mockResolvedValue([]);
  vi.mocked(client.anchoredComments.create).mockReset().mockResolvedValue({ id: 1 } as never);
  vi.mocked(client.anchoredComments.apply).mockReset().mockResolvedValue([] as never);
  vi.mocked(client.anchoredComments.delete).mockReset().mockResolvedValue({ ok: true } as never);
});

describe('the comment layer', () => {
  it('any selection raises the control at it, from the first character', async () => {
    await render(<Harness />);

    await selectText('two');

    await expect.element(page.getByRole('dialog', { name: 'Comment on the selection' })).toBeInTheDocument();
  });

  it('the selection stays native while the note is written, so copying still works', async () => {
    await render(<Harness />);

    await selectText('two sourced facts');

    expect(window.getSelection()?.toString()).toBe('two sourced facts');
    expect(document.querySelector('mark[data-anchor-id]')).toBeNull();
  });

  it('the span gets its own highlight the moment commenting begins, so it never goes dark', async () => {
    await render(<Harness />);
    await selectText('two sourced facts');

    expect(document.querySelector('mark[data-anchor-pending]')).toBeNull();

    // Focusing the note is where commenting begins — and where the browser
    // drops its own selection, so the layer takes over the highlighting.
    (document.querySelector('[data-comment-popover] textarea') as HTMLTextAreaElement).focus();

    await vi.waitFor(() => expect(document.querySelector('mark[data-anchor-pending]')).not.toBeNull());

    expect(document.querySelector('mark[data-anchor-pending]')!.textContent).toBe('two sourced facts');
  });

  it('cancelling drops the provisional highlight, leaving the text as it was', async () => {
    await render(<Harness />);
    await selectText('two sourced facts');
    (document.querySelector('[data-comment-popover] textarea') as HTMLTextAreaElement).focus();
    await vi.waitFor(() => expect(document.querySelector('mark[data-anchor-pending]')).not.toBeNull());

    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));

    await vi.waitFor(() => expect(document.querySelector('mark[data-anchor-pending]')).toBeNull());

    await expect.element(page.getByText(BODY)).toBeInTheDocument();
  });

  it('Add change stores the note with a content anchor', async () => {
    await render(<Harness />);
    await selectText('two sourced facts');

    await userEvent.fill(page.getByRole('textbox'), 'name the two facts');
    await userEvent.click(page.getByRole('button', { name: 'Add change' }));

    expect(client.anchoredComments.create).toHaveBeenCalledWith(expect.objectContaining({
      targetRef: 'lead_brief:1',
      field: FIELD,
      note: 'name the two facts',
      anchor: expect.objectContaining({ quote: 'two sourced facts' }),
    }));
  });

  it('a stored comment paints its highlight and lands as a chip', async () => {
    vi.mocked(client.anchoredComments.list).mockResolvedValue([storedComment()] as never);

    await render(<Harness />);

    await expect.element(page.getByText('“two sourced facts”')).toBeInTheDocument();

    await vi.waitFor(() => expect(document.querySelector('mark[data-anchor-id="1"]')).not.toBeNull());
  });

  it('a chip collapses to a receipt and expands to the change', async () => {
    vi.mocked(client.anchoredComments.list).mockResolvedValue([storedComment()] as never);
    await render(<Harness />);

    await expect.element(page.getByText('“two sourced facts”')).toBeInTheDocument();

    await expect.element(page.getByText('soften this')).not.toBeInTheDocument();

    await userEvent.click(page.getByText('“two sourced facts”'));

    await expect.element(page.getByText('soften this')).toBeInTheDocument();
  });

  it('clicking a highlight lights its chip — navigation runs both ways', async () => {
    vi.mocked(client.anchoredComments.list).mockResolvedValue([storedComment()] as never);
    await render(<Harness />);
    await vi.waitFor(() => expect(document.querySelector('mark[data-anchor-id="1"]')).not.toBeNull());

    (document.querySelector('mark[data-anchor-id="1"]') as HTMLElement).click();

    await expect.element(page.getByText('soften this')).toBeInTheDocument();
  });

  it('an applied comment loses its highlight and its chip', async () => {
    vi.mocked(client.anchoredComments.list).mockResolvedValue([storedComment({ status: 'applied' })] as never);

    await render(<Harness />);

    await expect.element(page.getByText('“two sourced facts”')).not.toBeInTheDocument();
    expect(document.querySelector('mark[data-anchor-id="1"]')).toBeNull();
  });

  it('an orphaned comment keeps its chip and says the text moved', async () => {
    vi.mocked(client.anchoredComments.list).mockResolvedValue([storedComment({ status: 'orphaned', range: null })] as never);
    await render(<Harness />);

    await userEvent.click(page.getByText('“two sourced facts”'));

    await expect.element(page.getByText(/The text this pointed at has changed/)).toBeInTheDocument();
    expect(document.querySelector('mark[data-anchor-id="1"]')).toBeNull();
  });
});
