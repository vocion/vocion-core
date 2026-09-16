import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import { FIXTURE_BRIEFING } from '@/services/briefings/fixtures';

/**
 * The Briefing detail is a Detail page, so it gets the platform's selection
 * pattern — not one of its own (docs/design/patterns.md § Select → talk).
 *
 * The commentable regions are the archetype's own `Section`s, named by their
 * eyebrows: the typed document's rendered sections. Nothing here traverses
 * markdown headings, and the page carries no selection control of its own.
 */

vi.mock('@/libs/Orpc', () => ({
  client: {
    anchoredComments: { list: vi.fn(async () => []), create: vi.fn(), apply: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/dashboard/briefings/42',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/dashboard/briefings/42' }));

const { BriefingView } = await import('./BriefingView');
const { CommentLayerProvider } = await import('@/features/comments/CommentLayer');
const { dismissSelectionControl } = await import('@/features/comments/AnchoredComments');

function Harness() {
  return (
    <CommentLayerProvider targetRef="briefing:42" record={{ type: 'briefing', id: '42', label: FIXTURE_BRIEFING.title }}>
      <BriefingView doc={FIXTURE_BRIEFING} liveDecisions={[]} />
    </CommentLayerProvider>
  );
}

/** Select the first words of a rendered section and release the mouse. */
async function selectInFirstSection(): Promise<string> {
  const region = document.querySelector<HTMLElement>('[data-pattern="section"][data-comment-field]')!;
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node && (node.textContent ?? '').trim().length < 12) {
    node = walker.nextNode() as Text | null;
  }
  const text = (node!.textContent ?? '').slice(0, 12);
  const range = document.createRange();
  range.setStart(node!, 0);
  range.setEnd(node!, 12);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return text;
}

beforeEach(() => {
  document.title = 'Briefing';
});

describe('the briefing detail is commentable', () => {
  it('names every rendered section of the typed document as a region', async () => {
    render(<Harness />);

    await expect.element(page.getByTestId('briefing')).toBeVisible();

    const fields = [...document.querySelectorAll('[data-pattern="section"][data-comment-field]')]
      .map(el => (el as HTMLElement).dataset.commentField);

    // The archetype supplies these, so the page declares nothing: the eyebrow
    // of each rendered section IS the region's name.
    expect(fields.length).toBeGreaterThan(1);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toContain('Needs your decision');
  });

  it('a selection raises the standard control, and Ask about this carries the passage', async () => {
    const seen: Array<{ context?: { selection?: { text: string }; record?: { type: string; id: string } }; tags?: unknown[] }> = [];
    const onRequest = (e: Event) => {
      e.preventDefault();
      seen.push((e as CustomEvent).detail);
    };
    window.addEventListener('vocion:open-agent-surface', onRequest);
    try {
      render(<Harness />);

      await expect.element(page.getByTestId('briefing')).toBeVisible();

      const text = await selectInFirstSection();

      await expect.element(page.getByRole('dialog', { name: 'What to do with the selection' })).toBeVisible();
      // A briefing has no draft to rewrite, so no intent action is offered.
      expect(page.getByRole('button', { name: 'Add change' }).elements()).toHaveLength(0);

      await userEvent.click(page.getByRole('button', { name: 'Ask about this' }));

      await vi.waitFor(() => expect(seen).toHaveLength(1));

      expect(seen[0]!.context?.selection?.text).toBe(text);
      expect(seen[0]!.context?.record).toMatchObject({ type: 'briefing', id: '42' });
      expect(seen[0]!.tags).toBeUndefined();
    } finally {
      window.removeEventListener('vocion:open-agent-surface', onRequest);
    }
  });

  it('stands down when another surface takes the screen', async () => {
    render(<Harness />);

    await expect.element(page.getByTestId('briefing')).toBeVisible();

    await selectInFirstSection();

    await expect.element(page.getByRole('dialog', { name: 'What to do with the selection' })).toBeVisible();

    // What the preview panel calls instead of reaching into the layer.
    dismissSelectionControl();

    await vi.waitFor(() => expect(page.getByRole('dialog', { name: 'What to do with the selection' }).elements()).toHaveLength(0));
  });

  it('renders as ONE bordered surface — the sections inside it are not cards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<Harness />);

      await expect.element(page.getByTestId('briefing')).toBeVisible();

      expect(warn.mock.calls.filter(c => String(c[0]).includes('Nested bordered surface'))).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
