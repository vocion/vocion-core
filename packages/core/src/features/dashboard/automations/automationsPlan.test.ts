import { describe, expect, it } from 'vitest';
import { planAutomations, triggerWords } from './automationsPlan';

/**
 * The Automations page's rows (Chris, 2026-10-01): every automation, grouped
 * by the plugin that ships it, each with what it reacts to, its owner, its
 * last run and whether it is on, paused or off. Fictional Northwind names.
 */

const NOW = new Date('2026-10-01T12:00:00Z').getTime();
const auto = (slug: string, over: Partial<Parameters<typeof planAutomations>[0]['automations'][number]> = {}) => ({ slug, name: slug.replace(/-/g, ' '), status: 'active', whenConfig: { event: 'run.failed' }, pausedAt: null, pausedNote: null, ...over });

describe('the Automations page', () => {
  it('groups by plugin, the workspace\'s own last, and says on, paused or off with who and when', () => {
    const groups = planAutomations({
      automations: [
        auto('deploy-answer'),
        auto('daily-plan', { whenConfig: { schedule: '0 9 * * *' }, pausedAt: new Date('2026-09-21T13:01:00Z'), pausedNote: 'Hold the ideas' }),
        auto('weekly-review', { status: 'disabled' }),
        auto('northwind-digest', { whenConfig: { event: ['digest.requested', 'pr.checks_completed'] } }),
      ],
      plugins: [{ slug: 'software-factory', name: 'Software factory', automations: ['deploy-answer', 'daily-plan', 'weekly-review'] }],
      owners: new Map([['deploy-answer', 'Release engineer']]),
      lastRuns: new Map([['deploy-answer', { status: 'error', startedAt: new Date('2026-10-01T11:57:00Z') }]]),
      pausers: new Map([['daily-plan', 'Dana Reyes']]),
      now: NOW,
    });

    expect(groups.map(g => [g.key, g.rows.map(r => r.slug)])).toEqual([
      ['software-factory', ['daily-plan', 'deploy-answer', 'weekly-review']],
      ['workspace', ['northwind-digest']],
    ]);

    const [factory, own] = groups;

    expect(factory!.rows.find(r => r.slug === 'deploy-answer')).toMatchObject({ trigger: 'On run failed', owner: 'Release engineer', last: 'Failed 3 minutes ago', lastFailed: true, state: 'on', pause: null });
    expect(factory!.rows.find(r => r.slug === 'daily-plan')).toMatchObject({ state: 'paused', pause: { byName: 'Dana Reyes', when: '21 Sep 13:01 UTC', note: 'Hold the ideas' }, last: 'Never ran' });
    expect(factory!.rows.find(r => r.slug === 'weekly-review')).toMatchObject({ state: 'off' });
    expect(own!.rows[0]!.trigger).toBe('On digest requested, pr checks completed');
  });

  it('says a schedule in words, and an automation with no trigger as by hand', () => {
    expect(triggerWords({ event: 'pr.checks_completed' })).toBe('On pr checks completed');
    expect(triggerWords({})).toBe('By hand');
    expect(triggerWords({ schedule: '*/5 * * * *' })).not.toBe('*/5 * * * *');
  });
});
