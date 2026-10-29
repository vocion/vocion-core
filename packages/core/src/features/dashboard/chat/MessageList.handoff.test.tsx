import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import messages from '@/locales/en.json';

/**
 * A thread handed to another team's agent says so in one line, and an in-app
 * path an agent wrote as text is a link the person can follow (2026-10-29).
 * Fixtures are fictional: Fernhill, an agency with an SEO team.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/libs/Orpc', () => ({ client: { preview: { status: async () => ({}) } } }));

const { MessageList } = await import('./MessageList');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
});

afterEach(() => vi.unstubAllGlobals());

const handoff = { chosen: 'seo-strategist', defaulted: false, reason: 'The thread was with workspace-lead, and this follow-up turned to work the SEO team owns.', candidates: [], surface: 'chat', at: '2026-10-29T17:00:00.000Z', decidedBy: 'handoff' as const, handedFrom: 'workspace-lead', confidence: 0.82 };

async function draw(msgs: Parameters<typeof MessageList>[0]['messages']) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MessageList messages={msgs} agentName="Fernhill lead" conversationId={null} />
    </NextIntlClientProvider>,
  );
}

describe('a hand-off, in the thread', () => {
  it('says once who the thread was handed to, before their answer', async () => {
    const { container } = await draw([
      { role: 'user', content: 'connect to Github for our client projects' },
      { role: 'assistant', content: 'Github is connected.', agentSlug: 'workspace-lead', agentName: 'Fernhill lead' },
      { role: 'user', content: 'find me keywords to build seo pages for' },
      { role: 'assistant', content: 'Here are three keywords worth a page.', agentSlug: 'seo-strategist', agentName: 'SEO strategist', routing: handoff },
    ]);

    await expect.poll(() => container.querySelectorAll('[data-testid="handoff-line"]').length).toBe(1);
    expect(container.querySelector('[data-testid="handoff-line"]')?.textContent).toBe('Handing this to SEO strategist');
  });

  it('draws no line for a turn the thread kept', async () => {
    const { container } = await draw([
      { role: 'user', content: 'Approve the keyword plan' },
      { role: 'assistant', content: 'Approved.', agentSlug: 'seo-strategist', agentName: 'SEO strategist', routing: { ...handoff, decidedBy: 'thread' } },
    ]);

    await expect.poll(() => container.textContent).toContain('Approved.');
    expect(container.querySelector('[data-testid="handoff-line"]')).toBeNull();
  });
});

describe('an in-app path in an answer', () => {
  it('renders as a link to the page, never as raw text', async () => {
    const { container } = await draw([
      { role: 'user', content: 'where is the batch?' },
      { role: 'assistant', content: 'The plan is in /dashboard/p/seo-pages?batch=506.' },
    ]);

    await expect.poll(() => container.querySelector('a[href="/dashboard/p/seo-pages?batch=506"]')).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard/p/seo-pages?batch=506"]')?.textContent).toContain('Seo pages · batch 506');
    expect(container.textContent).not.toContain('/dashboard/p/seo-pages');
  });
});
