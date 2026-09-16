import type { InboxItem } from '@/services/InboxService';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MAX_ABOVE_FOLD_ITEMS } from '@/services/briefings/budget';
import { FIXTURE_BRIEFING } from '@/services/briefings/fixtures';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/dashboard/briefings/42' }));

const { BriefingView } = await import('./BriefingView');

/** The live inbox rows behind the fixture's three decision cards. */
const LIVE: InboxItem[] = FIXTURE_BRIEFING.decisions!.judgment.map(c => ({
  key: c.key,
  kind: c.kind,
  shape: 'single',
  ref: c.ref,
  title: c.title,
  subline: 'Needs you',
  agentSlug: null,
  teamSlug: null,
  risk: c.risk,
  status: 'open',
  at: new Date('2026-09-14T12:00:00Z'),
  href: c.href,
}));

/**
 * The page is the spec's first screen: a metrics line, the decisions, what
 * changed, today's clock — and nothing that says nothing happened.
 */
describe('the briefing page', () => {
  it('leads with the metrics line, deltas and all', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);

    await expect.element(page.getByText('Weighted forecast unavailable')).toBeInTheDocument();
    const line = document.querySelector('[data-briefing-section="today"]')!;

    expect(line.textContent).toContain('Open pipeline');
    expect(line.textContent).toContain('$3.52M');
    expect(line.textContent).toContain('↑ $210K');
    // Every metric on one line, with its delta beside it.
    expect(line.textContent).toContain('Awaiting signature');
  });

  it('renders the decisions as inbox rows, with why-now on each', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);

    await expect.element(page.getByText('3 decisions need you today · 658 lower-priority items queued')).toBeInTheDocument();
    await expect.element(page.getByText('Delivery has started while the master agreement and its schedules remain unsigned, so work is running ahead of the commercial paperwork.')).toBeInTheDocument();
    // The row's own Open link — the same route /dashboard/inbox would send you to.
    await expect.element(page.getByRole('link', { name: 'Open: Project Kestrel — no record exists' })).toHaveAttribute('href', '/dashboard/inbox/23');
  });

  it('never makes the raw queue count the headline', () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);

    // 3 + 658 is 661; the sum must never be what the page leads with.
    expect(document.body.textContent ?? '').not.toContain('661');
  });

  it('keeps the first screen inside the attention budget', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);
    const decisions = document.querySelectorAll('[data-briefing-section="decisions"] li[data-kind]');
    const changes = document.querySelectorAll('[data-briefing-section="changes"] > ul > li');

    expect(decisions.length + changes.length).toBeLessThanOrEqual(MAX_ABOVE_FOLD_ITEMS);
  });

  it('hides the pipeline detail, the sources and the run-level truth behind disclosures', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);

    await expect.element(page.getByRole('button', { name: /View full pipeline/ })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Sources & run details/ })).toBeInTheDocument();
    // The connector field is nowhere on the page until "Why?" is opened.
    expect(document.body.textContent ?? '').not.toContain('hs_deal_stage_probability');

    await page.getByRole('button', { name: 'Why?' }).click();
    await expect.element(page.getByText(/hs_deal_stage_probability/)).toBeInTheDocument();
  });

  it('draws no section for anything that carries nothing', async () => {
    render(<BriefingView doc={{ ...FIXTURE_BRIEFING, exceptions: { items: [] }, detail: { tables: [] } }} liveDecisions={LIVE} />);

    expect(document.querySelector('[data-briefing-section="exceptions"]')).toBeNull();
    expect(document.querySelector('[data-briefing-section="detail"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/nothing (?:ran|to judge|happened)/i);
  });

  it('shows the last briefings and a link to the archive, not the archive', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE} />);
    const rows = document.querySelectorAll('[data-briefing-section="history"] [data-slot="list-row"]');

    expect(rows.length).toBeLessThanOrEqual(5);
    await expect.element(page.getByRole('link', { name: 'View all briefings' })).toHaveAttribute('href', '/dashboard/briefings/archive');
  });

  it('says a decision was already made rather than showing it as waiting', async () => {
    render(<BriefingView doc={FIXTURE_BRIEFING} liveDecisions={LIVE.slice(0, 2)} />);

    await expect.element(page.getByText('Decided since this brief was written')).toBeInTheDocument();
  });
});
