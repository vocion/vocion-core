import type { PageField, PageRow } from '@/libs/workspace/pages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

/**
 * A Work card says which chat started it (Chris, 2026-09-30, #269: "missing
 * the Chat that started this request"): a small chat icon at the card's
 * corner, outside the card's own link, with a Tooltip naming the thread, that
 * opens it in the preview pane. Fixture rows.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { PageBlocks } = await import('./PageBlocks');

const FIELDS = [{ key: 'title', label: 'Outcome', format: 'text', total: false, priority: 1, hideWhenConstant: false, hideWhenEmpty: true }] as PageField[];

const ASKED: PageRow = { id: 268, title: 'Fix header width overflow on mobile', status: null, createdAt: null, meta: { originChat: { conversationId: 812, title: 'Header overflows on a phone', href: '/dashboard/chat?c=812' } } };
const FILED: PageRow = { id: 269, title: 'Room PDF export', status: null, createdAt: null, meta: {} };

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/p/work');
});

describe('a Work card started in chat', () => {
  it('carries a chat icon that names the thread and opens it in the pane', async () => {
    render(<PageBlocks rows={[ASKED, FILED]} fields={FIELDS} primary={{ field: 'title', subtitle: [] }} rowLink="/dashboard/p/feature/{id}" now={Date.now()} />);

    const icon = page.getByTestId('row-origin-chat');

    await expect.element(icon).toHaveAttribute('aria-label', 'Started in chat: Header overflows on a phone');

    expect(document.querySelectorAll('[data-testid="row-origin-chat"]')).toHaveLength(1);
    // Outside the card's link: a tap on it does one thing.
    expect(document.querySelector('a[href="/dashboard/p/feature/268"] [data-testid="row-origin-chat"]')).toBeNull();

    await userEvent.hover(icon);

    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Started in chat: Header overflows on a phone');

    await userEvent.click(icon);

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('conversation:812');
  });
});
