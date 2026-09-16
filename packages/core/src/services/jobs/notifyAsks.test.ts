import { describe, expect, it } from 'vitest';
import { renderAskNotification } from './notifyAsks';

describe('renderAskNotification', () => {
  it('names the one decision, or counts them, and deep-links each into the inbox', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';
    const one = renderAskNotification([{ id: 7, kind: 'ruling', title: 'Slack app granularity', agentSlug: 'ceo', risk: 'medium', groupTitle: 'Rulings' }], 'Vocion Workforce');

    expect(one.subject).toBe('Needs you — Slack app granularity');
    expect(one.text).toContain('https://app.example.com/dashboard/inbox/7');
    expect(one.text).toContain('[Ruling] Slack app granularity · asked by ceo · medium risk · sheet: Rulings');
    expect(one.html).toContain('href="https://app.example.com/dashboard/inbox/7"');

    const many = renderAskNotification([
      { id: 1, kind: 'approval', title: 'Post to Show HN', agentSlug: 'distribution', risk: 'low', groupTitle: null },
      { id: 2, kind: 'merge', title: 'Merge <core#325>', agentSlug: null, risk: null, groupTitle: null },
    ], 'Vocion Workforce');

    expect(many.subject).toBe('Needs you — 2 decisions waiting (Vocion Workforce)');
    expect(many.html).toContain('Merge &lt;core#325&gt;');
    expect(many.text).toContain('Open the inbox: https://app.example.com/dashboard/inbox');
  });
});
