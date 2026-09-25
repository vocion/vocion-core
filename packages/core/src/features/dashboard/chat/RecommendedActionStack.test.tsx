import type { RecommendedAction } from './types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

/**
 * Several cards are one strip you slide, not a stepper you swipe: the card
 * follows the finger and settles on the nearest (Chris, 2026-09-25: "I want
 * to be able to slide the cards. Not just swipe to change"). The card itself
 * is stubbed — this file is about the strip. Fixtures are fictional.
 */

const proposed: string[] = [];
vi.mock('./RecommendedActionCard', () => ({
  RecommendedActionCard: ({ rec, autoPropose }: { rec: RecommendedAction; autoPropose?: boolean }) => {
    if (autoPropose) {
      proposed.push(rec.label);
    }
    return <div className="h-40 rounded-2xl border p-4" data-testid="card">{rec.label}</div>;
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/libs/Orpc', () => ({ client: { review: { propose: vi.fn(async () => ({})) } } }));

const { RecommendedActionStack } = await import('./RecommendedActionStack');

const recs: RecommendedAction[] = ['Approve the Kestrel upload fix', 'Defer the admin panel', 'File the SSO question'].map(label => ({
  actionId: '',
  input: {},
  label,
  agentSlug: 'product-manager',
}));

const strip = () => document.querySelector('[data-testid="recommended-action-strip"]') as HTMLDivElement;

describe('the card strip', () => {
  it('mounts every card, with the next one peeking, and slides to where the finger leaves it', async () => {
    await render(<div style={{ width: 360 }}><RecommendedActionStack recs={recs} /></div>);

    await expect.element(page.getByText('1 of 3')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="card"]')).toHaveLength(3);

    // The second card starts inside the strip's width: it peeks.
    const second = strip().children[1] as HTMLElement;

    expect(second.offsetLeft - strip().offsetLeft).toBeLessThan(strip().clientWidth);

    // A slide is a scroll of the strip; the counter follows where it settles.
    strip().scrollLeft = second.offsetLeft - strip().offsetLeft;

    await expect.element(page.getByText('2 of 3')).toBeInTheDocument();
  });

  it('a dot or Skip moves the strip, and only the card in view proposes itself', async () => {
    proposed.length = 0;
    await render(<div style={{ width: 360 }}><RecommendedActionStack recs={recs} autoPropose /></div>);

    expect(proposed).toEqual(['Approve the Kestrel upload fix']);

    await userEvent.click(page.getByRole('tab', { name: /Card 3 of 3/ }));

    await expect.element(page.getByText('3 of 3')).toBeInTheDocument();
    expect(proposed).toContain('File the SSO question');
    expect(proposed).not.toContain('Defer the admin panel');

    await userEvent.click(page.getByRole('button', { name: 'Skip' }));

    await expect.element(page.getByText(/All set/)).toBeInTheDocument();
  });
});
