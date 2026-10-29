import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * Ticking rows on a list page and asking about them (`selectionPrompts`),
 * in a real browser: the SEO keywords' "Plan a batch from these". A tick
 * never opens the row it sits in; the asks show once something is ticked;
 * and the ask starts a new chat with the strategist, its words naming each
 * ticked keyword by record id and the rows handed over as the chat's
 * records. Every client here is fictional.
 */

const opened = vi.hoisted(() => [] as unknown[]);
const pushed = vi.hoisted(() => [] as string[]);
vi.mock('@/features/dashboard/chat/agentSurface', () => ({ openAgentSurface: (req: unknown) => opened.push(req) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (href: string) => pushed.push(href) }) }));

const { PageSelection, selectionMessage } = await import('./PageSelection');
const { PageTable } = await import('./PageTable');

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, ...over };
}

const FIELDS: PageField[] = [
  field({ key: 'keyword', label: 'Keyword', from: 'meta.keyword' }),
  field({ key: 'volume', label: 'Volume', from: 'meta.volume', format: 'mono' }),
  field({ key: 'status', label: 'Status', from: 'meta.status', format: 'badge', tones: { idea: 'muted' } }),
];

const row = (id: number, keyword: string, volume: number): PageRow => ({ id, title: keyword, status: 'active', createdAt: null, meta: { keyword, volume, status: 'idea' } });
const ROWS = [row(41, 'boiler servicing', 1000), row(42, 'why is my boiler losing pressure', 900), row(43, 'annual boiler service', 300)];
const PROMPT = 'Plan a batch of SEO pages from these keywords (seo_plan_batch with their keyword_ids).';

describe('ticking keywords and planning a batch from them', () => {
  it('says each ticked row by name and record id, in the order ticked', () => {
    expect(selectionMessage(`${PROMPT} `, [{ id: '42', label: 'why is my boiler losing pressure' }, { id: '41', label: 'boiler servicing' }])).toBe(`${PROMPT}\n\n- why is my boiler losing pressure (record #42)\n- boiler servicing (record #41)`);
  });

  it('shows the ask once rows are ticked, never opens the row, and starts a chat with the strategist holding the ticked rows', async () => {
    const screen = await render(
      <PageSelection prompts={[{ label: 'Plan a batch from these', prompt: PROMPT, agent: 'seo-strategist' }]} page="Keywords" objectType="seo_keyword">
        <PageTable rows={ROWS} fields={FIELDS} primary={{ field: 'keyword', subtitle: [] }} rowLink="/dashboard/objects/{id}" now={Date.now()} selectable />
      </PageSelection>,
    );

    await expect.element(screen.getByTestId('page-selection-bar')).not.toBeInTheDocument();

    await screen.getByRole('checkbox', { name: 'Select boiler servicing' }).click();
    await screen.getByRole('checkbox', { name: 'Select annual boiler service' }).click();

    await expect.element(screen.getByText('2 selected')).toBeVisible();
    // A tick is not a click on the row: nothing navigated.
    expect(pushed).toEqual([]);

    await screen.getByRole('button', { name: 'Plan a batch from these' }).click();

    expect(opened).toEqual([expect.objectContaining({
      send: true,
      newChat: true,
      agentSlug: 'seo-strategist',
      prompt: `${PROMPT}\n\n- boiler servicing (record #41)\n- annual boiler service (record #43)`,
      context: expect.objectContaining({
        title: 'Keywords',
        refs: [
          { type: 'object', id: '41', label: 'boiler servicing', href: '/dashboard/objects/41', objectType: 'seo_keyword' },
          { type: 'object', id: '43', label: 'annual boiler service', href: '/dashboard/objects/43', objectType: 'seo_keyword' },
        ],
      }),
    })]);

    await screen.getByRole('button', { name: 'Clear' }).click();

    await expect.element(screen.getByTestId('page-selection-bar')).not.toBeInTheDocument();
  });

  it('draws no checkboxes on a table that is not selectable', async () => {
    const screen = await render(<PageTable rows={ROWS} fields={FIELDS} primary={{ field: 'keyword', subtitle: [] }} now={Date.now()} />);

    await expect.element(screen.getByText('boiler servicing')).toBeVisible();
    expect(page.getByRole('checkbox').elements()).toHaveLength(0);
  });
});
