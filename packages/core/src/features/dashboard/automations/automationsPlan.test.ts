import { describe, expect, it } from 'vitest';
import { planAutomations, pluginOf, triggerWords } from './automationsPlan';

/**
 * The Automations register (Chris, 2026-10-01; one register per workspace,
 * filtered by app, 2026-10-29): every automation, each naming the app that
 * installed it, with what it reacts to, its owner, its last run and whether
 * it is on, paused or off; a chip per app; system plumbing left out unless
 * asked for. Fictional Northwind names.
 */

const NOW = new Date('2026-10-01T12:00:00Z').getTime();
type Auto = Parameters<typeof planAutomations>[0]['automations'][number];
const auto = (slug: string, over: Partial<Auto> = {}): Auto => ({ slug, name: slug.replace(/-/g, ' '), status: 'active', whenConfig: { event: 'run.failed' }, pausedAt: null, pausedNote: null, ...over });

const plugins = [
  { slug: 'software-factory', name: 'Software factory', automations: ['deploy-answer', 'daily-plan', 'weekly-review'] },
  { slug: 'seo', name: 'SEO pages', automations: ['seo-continue', 'seo-opportunities'] },
];
const apps = [
  { id: 'software-factory', name: 'Software Factory', plugins: ['software-factory'] },
  { id: 'seo', name: 'Search Engine Optimization', plugins: ['seo'] },
];
const base = {
  plugins,
  apps,
  owners: new Map([['deploy-answer', 'Release engineer']]),
  lastRuns: new Map([['deploy-answer', { status: 'error', startedAt: new Date('2026-10-01T11:57:00Z') }]]),
  pausers: new Map([['daily-plan', 'Dana Reyes']]),
  now: NOW,
};
const automations = [
  auto('deploy-answer', { source: 'plugin:software-factory' }),
  auto('daily-plan', { source: 'plugin:software-factory', whenConfig: { schedule: '0 9 * * *' }, pausedAt: new Date('2026-09-21T13:01:00Z'), pausedNote: 'Hold the ideas' }),
  auto('weekly-review', { source: 'plugin:software-factory', status: 'disabled' }),
  auto('northwind-digest', { source: 'workspace', whenConfig: { event: ['digest.requested', 'pr.checks_completed'] } }),
  auto('seo-continue', { source: 'plugin:seo', visibility: 'system', whenConfig: { event: 'seo.work_queued' } }),
  auto('seo-opportunities', { source: 'plugin:seo', name: 'New page opportunities', whenConfig: { schedule: '0 7 * * 1', timezone: 'America/Chicago' } }),
];

describe('the Automations register', () => {
  it('lists every automation once, each naming its app, in rail order with the workspace\'s own last', () => {
    const view = planAutomations({ ...base, automations });

    expect(view.rows.map(r => [r.slug, r.app])).toEqual([
      ['daily-plan', 'Software Factory'],
      ['deploy-answer', 'Software Factory'],
      ['weekly-review', 'Software Factory'],
      ['seo-opportunities', 'Search Engine Optimization'],
      ['northwind-digest', 'This workspace'],
    ]);
    expect(view.rows.find(r => r.slug === 'deploy-answer')).toMatchObject({ trigger: 'On run failed', owner: 'Release engineer', last: 'Failed 3 minutes ago', lastFailed: true, state: 'on', pause: null });
    expect(view.rows.find(r => r.slug === 'daily-plan')).toMatchObject({ state: 'paused', pause: { byName: 'Dana Reyes', when: '21 Sep 13:01 UTC', note: 'Hold the ideas' }, last: 'Never ran' });
    expect(view.rows.find(r => r.slug === 'weekly-review')).toMatchObject({ state: 'off' });
    expect(view.rows.find(r => r.slug === 'northwind-digest')!.trigger).toBe('On digest requested, pr checks completed');
  });

  it('filters by app, with one chip per app that has rows and how many', () => {
    const view = planAutomations({ ...base, automations, filter: { app: 'seo' } });

    expect(view.rows.map(r => r.slug)).toEqual(['seo-opportunities']);
    expect(view.selected).toBe('seo');
    expect(view.apps).toEqual([
      { key: 'software-factory', label: 'Software Factory', count: 3 },
      { key: 'seo', label: 'Search Engine Optimization', count: 1 },
      { key: 'workspace', label: 'This workspace', count: 1 },
    ]);
    expect(planAutomations({ ...base, automations, filter: { app: 'workspace' } }).rows.map(r => r.slug)).toEqual(['northwind-digest']);
  });

  it('keeps system automations out of the list and its counts until asked for, and says how many it left out', () => {
    const hidden = planAutomations({ ...base, automations, filter: { app: 'seo' } });

    expect(hidden.rows.some(r => r.slug === 'seo-continue')).toBe(false);
    expect(hidden.systemHidden).toBe(1);

    const shown = planAutomations({ ...base, automations, filter: { app: 'seo', showSystem: true } });

    expect(shown.rows.map(r => [r.slug, r.system])).toEqual([['seo-opportunities', false], ['seo-continue', true]]);
    expect(shown.systemHidden).toBe(0);
    expect(shown.apps.find(a => a.key === 'seo')?.count).toBe(2);
  });

  it('narrows to one plugin for an app\'s own panel, the same rows the register draws', () => {
    const view = planAutomations({ ...base, automations, filter: { plugin: 'seo' } });

    expect(view.rows.map(r => r.slug)).toEqual(['seo-opportunities']);
  });

  it('says a schedule in words, and an automation with no trigger as by hand', () => {
    expect(triggerWords({ event: 'pr.checks_completed' })).toBe('On pr checks completed');
    expect(triggerWords({})).toBe('By hand');
    expect(triggerWords({ schedule: '*/5 * * * *' })).not.toBe('*/5 * * * *');
  });
});

describe('provenance', () => {
  it('reads the app from the stamped source, not from which folder ships the slug', () => {
    // A workspace's own automation that happens to share a slug with nothing: its own.
    expect(pluginOf({ slug: 'deploy-answer', source: 'workspace' }, plugins)).toBeNull();
    // Stamped by the plugin that installed it, even where another plugin's folder lists the slug.
    expect(pluginOf({ slug: 'deploy-answer', source: 'plugin:seo' }, plugins)).toBe('seo');
  });

  it('falls back to the plugin that ships the slug for a row applied before it was stamped', () => {
    expect(pluginOf({ slug: 'seo-continue', source: null }, plugins)).toBe('seo');
    expect(pluginOf({ slug: 'northwind-digest', source: null }, plugins)).toBeNull();
  });
});
