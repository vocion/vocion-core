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

vi.mock('./RecommendedActionCard', () => ({
  // No fixed height: a card is as tall as its content, and the strip is what
  // has to make them match.
  RecommendedActionCard: ({ rec }: { rec: RecommendedAction }) => {
    return (
      <div className="rounded-2xl border p-4" data-testid="card">
        {rec.label}
        {rec.rationale && <p style={{ height: 160 }}>{rec.rationale}</p>}
      </div>
    );
  },
}));

const { RecommendedActionStack } = await import('./RecommendedActionStack');

const recs: RecommendedAction[] = ['Approve the Kestrel upload fix', 'Defer the admin panel', 'File the SSO question'].map((label, i) => ({
  actionId: '',
  input: {},
  label,
  agentSlug: 'product-manager',
  // The middle card is the tall one.
  ...(i === 1 ? { rationale: 'Northwind asked for it twice this week.' } : {}),
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

  it('a dot moves the strip, and nothing sits under the strip', async () => {
    await render(<div style={{ width: 360 }}><RecommendedActionStack recs={recs} /></div>);

    await userEvent.click(page.getByRole('tab', { name: /Card 3 of 3/ }));

    await expect.element(page.getByText('3 of 3')).toBeInTheDocument();

    // Add by subtracting (Chris, 2026-09-25): the card decides; the strip adds nothing.
    for (const gone of ['Skip', 'Save for later', /Queue all/]) {
      expect(page.getByRole('button', { name: gone }).elements()).toHaveLength(0);
    }
  });

  it('every card is as tall as the tallest, so paging does not jump', async () => {
    await render(<div style={{ width: 360 }}><RecommendedActionStack recs={recs} /></div>);

    await expect.element(page.getByText('1 of 3')).toBeInTheDocument();

    const heights = Array.from(document.querySelectorAll('[data-testid="card"]')).map(c => (c as HTMLElement).offsetHeight);

    expect(new Set(heights).size).toBe(1);
    // …and that height is the tall card's, not the short one's.
    expect(heights[0]).toBeGreaterThan(160);
  });

  it('on a desktop, previous and next page the strip and stop at the ends', async () => {
    await render(<div style={{ width: 480 }}><RecommendedActionStack recs={recs} /></div>);

    // The browser project runs as a desktop with a mouse: a fine pointer.
    expect(window.matchMedia('(pointer: fine)').matches).toBe(true);

    const prev = page.getByRole('button', { name: 'Previous card' });
    const next = page.getByRole('button', { name: 'Next card' });

    await expect.element(prev).toBeVisible();
    await expect.element(next).toBeVisible();
    await expect.element(prev).toBeDisabled();

    await userEvent.click(next);

    await expect.element(page.getByText('2 of 3')).toBeInTheDocument();
    await expect.element(prev).toBeEnabled();

    await userEvent.click(next);

    await expect.element(page.getByText('3 of 3')).toBeInTheDocument();
    await expect.element(next).toBeDisabled();

    // The strip moved with the counter: it is scrolled to its end, where the
    // last card is the one in view.
    await expect.poll(() => strip().scrollWidth - strip().clientWidth - strip().scrollLeft).toBeLessThan(2);

    await userEvent.click(prev);

    await expect.element(page.getByText('2 of 3')).toBeInTheDocument();
  });
});
