import type { AppFront as AppFrontData } from '@/libs/chat/appFront';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { NAV_WHERE_KEY } from '@/features/dashboard/nav/workspaceMemory';
import '@/styles/global.css';

/**
 * An app's Chat page leads with what needs the person today: the attention
 * entry over real counts, then the app's own briefing in compact form.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/libs/workspaceSlug', () => ({ useWorkspaceSlug: () => 'northwind-sales' }));

const { AppFront } = await import('./AppFront');
const { useAppFront } = await import('./useAppFront');

const FRONT: AppFrontData = {
  appId: 'sales',
  leadSlug: 'pipeline-lead',
  prompt: 'What needs my attention today? Start from today\'s briefing ("Pipeline Briefing").',
  counts: [
    { key: 'mail.send', label: 'Send email', count: 6, href: '/dashboard/inbox?agents=pipeline-lead&actionKind=mail.send' },
    { key: 'leads.enroll', label: 'Enroll lead', count: 2, href: '/gtm/personalization' },
  ],
  more: { count: 3, href: '/dashboard/inbox?agents=pipeline-lead' },
  briefing: {
    id: 12,
    title: 'Pipeline Briefing',
    href: '/dashboard/briefings/12',
    today: false,
    dateLabel: 'Fri, Oct 23',
    headline: 'Two renewals slipped; Northwind wants a revised scope.',
    decisions: 2,
    moves: ['Approve the Northwind scope', 'Send the Kestrel Capital follow-up'],
    failedRun: { href: '/dashboard/missions/runs/42' },
  },
};

beforeEach(() => {
  localStorage.clear();
});

describe('AppFront', () => {
  it('opens on the attention entry and asks the app\'s lead by name', async () => {
    const onAsk = vi.fn();
    render(<AppFront front={FRONT} onAsk={onAsk} />);
    await page.getByTestId('app-front-attention').click();

    expect(onAsk).toHaveBeenCalledWith(FRONT.prompt, 'pipeline-lead');
  });

  it('links each count to where its items are', async () => {
    render(<AppFront front={FRONT} onAsk={() => {}} />);

    await expect.element(page.getByTestId('app-front-count').first()).toBeVisible();

    const counts = page.getByTestId('app-front-count').elements();

    expect(counts.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['6 Send email', '/dashboard/inbox?agents=pipeline-lead&actionKind=mail.send'],
      ['2 Enroll lead', '/gtm/personalization'],
    ]);
    await expect.element(page.getByTestId('app-front-more')).toHaveTextContent('3 more in Review');
  });

  it('dates a brief from another day and says its run failed, with the run', async () => {
    render(<AppFront front={FRONT} onAsk={() => {}} />);

    await expect.element(page.getByTestId('app-front-briefing-date')).toHaveTextContent('Fri, Oct 23');
    await expect.element(page.getByTestId('app-front-briefing-failed').getByRole('link')).toHaveAttribute('href', '/dashboard/missions/runs/42');
    await expect.element(page.getByTestId('app-front-decisions')).toHaveTextContent('2 need your decision');
    await expect.element(page.getByTestId('app-front-move').first()).toBeVisible();
    expect(page.getByTestId('app-front-move').elements().map(a => a.getAttribute('href'))).toEqual(['/dashboard/briefings/12', '/dashboard/briefings/12']);
  });

  it('shrinks with what there is: no briefing, no briefing block', async () => {
    render(<AppFront front={{ ...FRONT, briefing: null, more: null }} onAsk={() => {}} />);

    await expect.element(page.getByTestId('app-front-attention')).toBeVisible();
    await expect.element(page.getByTestId('app-front-briefing')).not.toBeInTheDocument();
    expect(page.getByTestId('app-front-briefing').elements()).toHaveLength(0);
  });
});

describe('useAppFront', () => {
  function Probe({ fronts }: { fronts: Record<string, AppFrontData> }) {
    const front = useAppFront(fronts);
    return <span data-testid="probe">{front?.appId ?? 'none'}</span>;
  }

  it('draws the front of the app the sidebar remembers for this workspace', async () => {
    localStorage.setItem(NAV_WHERE_KEY, JSON.stringify({ 'northwind-sales': { app: 'sales', path: '/dashboard/chat', at: 1 } }));
    render(<Probe fronts={{ sales: FRONT }} />);

    await expect.element(page.getByTestId('probe')).toHaveTextContent('sales');
  });

  it('draws none in the core app or before the browser has said', async () => {
    localStorage.setItem(NAV_WHERE_KEY, JSON.stringify({ 'northwind-sales': { app: 'workforce', path: '/dashboard/chat', at: 1 } }));
    render(<Probe fronts={{ sales: FRONT }} />);

    await expect.element(page.getByTestId('probe')).toHaveTextContent('none');
  });
});
