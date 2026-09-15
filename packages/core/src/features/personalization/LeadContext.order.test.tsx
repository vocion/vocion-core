import type { LeadDossier } from './LeadContext';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { LeadContext } from './LeadContext';

vi.mock('@/libs/Orpc', () => ({ client: { personalization: { regenerateBrief: vi.fn() } } }));

// The regenerate control refreshes the route after a write; there is no
// router outside the app shell, so the hook is stubbed.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const ROW: LeadDossier = {
  id: 1,
  contactName: 'Pete Laverick',
  confidence: 0.72,
  sections: [
    { heading: 'Prospect', body: 'Pete Laverick, CEO.' },
    { heading: 'CRM Context', body: '- Arrived via paid social\n- 2 emails delivered' },
    { heading: 'Research That Matters', body: '- Publishes compliance updates' },
    { heading: 'Recommended Angle', body: 'Ask about compliance.' },
  ],
  claims: [{ text: 'Publishes compliance updates.', kind: 'fact', source: 'https://example.com/watch', date: 'Aug 2026' }],
  missing: ['No verified direct email.'],
  briefError: null,
  briefAttempts: 0,
  regenerateNote: null,
};

describe('the settled column order (2026-09-02)', () => {
  it('claims close the left column; the rail runs Confidence, timeline, CRM context, Missing, articles', async () => {
    await render(
      <LeadContext
        row={ROW}
        railTimeline={<div><h3>Timeline</h3></div>}
        railArticles={<div><h3>Reference articles</h3></div>}
      />,
    );

    await expect.element(page.getByText('Prospect')).toBeInTheDocument();

    const columns = page.getByText('Prospect').element().closest('.grid')!.children;
    const left = (columns[0] as HTMLElement).textContent ?? '';
    const right = (columns[1] as HTMLElement).textContent ?? '';

    // Left: the prose argument, then Claims as its receipts. CRM Context is
    // NOT here — it renders in the rail, the one hard-coded section name.
    const leftOrder = ['Prospect', 'Research That Matters', 'Recommended Angle', 'Claims'];
    const leftIdx = leftOrder.map(h => left.indexOf(h));

    expect(leftIdx.every(i => i >= 0)).toBe(true);
    expect([...leftIdx].sort((a, b) => a - b)).toEqual(leftIdx);
    expect(left).not.toContain('Arrived via paid social');

    // Right: the settled order, exactly.
    const rightOrder = ['Confidence', 'Timeline', 'CRM Context', 'Missing', 'Reference articles'];
    const rightIdx = rightOrder.map(h => right.indexOf(h));

    expect(rightIdx.every(i => i >= 0)).toBe(true);
    expect([...rightIdx].sort((a, b) => a - b)).toEqual(rightIdx);
    expect(right).not.toContain('Publishes compliance updates.');

    // The explainer became a tooltip with the settled sentence and nothing more.
    await expect.element(page.getByRole('button', { name: 'How well the evidence supports this brief and its angle' })).toBeInTheDocument();
    expect(right).not.toContain('not a prediction that the lead replies');
  });
});
