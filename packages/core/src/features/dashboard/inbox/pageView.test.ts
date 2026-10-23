import { describe, expect, it } from 'vitest';
import { reviewPageView } from './pageView';

describe('what the Review queue tells the dock', () => {
  it('names the page and says what is on screen, in at most eight pairs', () => {
    const view = reviewPageView({ scope: 'here', tab: 'open', shown: 69, tabs: { open: 69, decided: 246, snoozed: 0 }, oldest: new Date('2026-07-25T12:00:00Z'), kinds: ['proposal'], q: 'expo', batch: { label: 'Approve', count: 14 } }, new Date('2026-10-23T12:00:00Z'));

    expect(view.title).toBe('Review queue');
    expect(view.state).toEqual([
      { label: 'Scope', value: 'This workspace' },
      { label: 'Tab', value: 'Open' },
      { label: 'Shown', value: '69 decisions' },
      { label: 'Tabs', value: 'Open 69 · Decided 246 · Snoozed 0' },
      { label: 'Oldest waiting', value: '90d' },
      { label: 'Filters', value: 'Recommendations, matching "expo"' },
      { label: 'On top', value: '14 recommend "Approve" (Accept all 14)' },
    ]);
    expect(reviewPageView({ scope: 'all', tab: 'open', shown: 1 }).state.slice(0, 3)).toEqual([
      { label: 'Scope', value: 'All workspaces' },
      { label: 'Tab', value: 'Open' },
      { label: 'Shown', value: '1 decision' },
    ]);
  });
});
