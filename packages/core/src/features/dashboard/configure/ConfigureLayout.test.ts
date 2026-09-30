import type { ConfigureInput } from './configurePlan';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfigureLayout } from './ConfigureLayout';
import { planConfigure } from './configurePlan';

/**
 * The Configure layout as the server renders it: the tab the URL named is
 * the one drawn, every tab carries its count, and the sidebar carries its
 * blocks — with Needs attention absent when nothing needs a person. Rendered
 * to markup rather than in a browser: this is the first paint, before any
 * script runs, which is exactly what a phone on a slow link sees.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

const input: ConfigureInput = {
  pluginName: 'Kestrel desk',
  seats: [{ slug: 'desk-lead', name: 'Desk lead', seat: 'Kestrel desk · Lead', role: 'lead', model: 'model-large', owns: [], lastRunAt: new Date(NOW - 3_600_000), overBudget: null }],
  skills: [
    { slug: 'read-the-ask', name: 'Reading the ask', kind: 'skill', source: 'plugin', updatedAt: null, drifted: false },
    { slug: 'write-the-reply', name: 'Writing the reply', kind: 'skill', source: 'override', updatedAt: new Date(NOW - 86_400_000), drifted: false },
  ],
  automations: [],
  trust: [{ key: 'desk.file_ask', name: 'File an ask', parent: null, runsOnItsOwn: true, rungLabel: 'Execute within bounds', minConfidence: 0.8, risk: 'low', flagged: false }],
  learnings: [],
  measures: [{ id: 'desk/answered', label: 'Asks answered', teamName: 'Kestrel desk', unit: 'asks', target: 10, direction: 'higher', window: '7d', value: 12, previous: 8, improving: true, sourceLabel: 'review decisions' }],
  changes: [{ id: 'apply:1', what: 'Workspace applied · 2 changes', who: 'Mara Okafor', at: new Date(NOW - 7_200_000), href: '/dashboard/workspace' }],
};

function render(tab?: string, over: Partial<ConfigureInput> = {}): string {
  return renderToStaticMarkup(createElement(ConfigureLayout, { view: planConfigure({ ...input, ...over }, undefined, { tab, now: NOW }) }));
}

describe('ConfigureLayout', () => {
  it('draws every tab with its count', () => {
    const html = render();

    for (const [key, label, count] of [['seats', 'Seats', 1], ['skills', 'Skills &amp; playbooks', 2], ['automations', 'Automations', 0], ['trust', 'Trust rules', 1], ['learned', 'Learned', 0], ['measures', 'Measures', 1]] as const) {
      const trigger = html.match(new RegExp(`<button[^>]*data-testid="page-tab-${key}"[^>]*>([\\s\\S]*?)</button>`));

      expect(trigger?.[1]).toContain(label);
      expect(trigger?.[1]).toContain(`>${count}</span>`);
    }
  });

  it('renders the tab the URL names, on the first paint', () => {
    const html = render('skills');
    const active = html.match(/<button[^>]*aria-selected="true"[^>]*data-testid="page-tab-([a-z]+)"/) ?? html.match(/<button[^>]*data-testid="page-tab-([a-z]+)"[^>]*aria-selected="true"/);

    expect(active?.[1]).toBe('skills');
    expect(html).toContain('Writing the reply');
    expect(html).toContain('Workspace override');
    // The seats panel is not the one drawn.
    expect(html).not.toContain('configure-row-desk-lead');
  });

  it('draws the seats on the first tab by default, each a link to its agent', () => {
    const html = render();

    expect(html).toContain('data-testid="configure-row-desk-lead"');
    expect(html).toContain('href="/dashboard/agents/desk-lead"');
  });

  it('carries How it\'s doing and Recently changed, and no Needs attention when nothing needs a person', () => {
    const html = render();

    expect(html).toContain('data-testid="configure-aside-health"');
    expect(html).toContain('↑ 50% vs last week');
    expect(html).toContain('data-testid="configure-aside-changes"');
    expect(html).toContain('Mara Okafor · 2 hours ago');
    expect(html).not.toContain('configure-aside-attention');
    expect(html).not.toContain('configure-attention-lead');
  });

  it('shows Needs attention once something does', () => {
    const html = render(undefined, { skills: [{ slug: 'write-the-reply', name: 'Writing the reply', kind: 'skill', source: 'override', updatedAt: null, drifted: true }] });

    expect(html).toContain('data-testid="configure-aside-attention"');
    expect(html).toContain('href="/dashboard/skills/write-the-reply"');
    // On a phone it leads the page, ahead of the tabs, rather than trailing every row.
    expect(html.indexOf('configure-attention-lead')).toBeGreaterThan(-1);
    expect(html.indexOf('configure-attention-lead')).toBeLessThan(html.indexOf('page-tab-seats'));
  });
});
