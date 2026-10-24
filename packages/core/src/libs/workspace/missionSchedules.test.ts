import type { LoadedAutomation, LoadedMission } from './loader';
import { describe, expect, it } from 'vitest';
import { scheduledChecksFromMissions } from './missionSchedules';
import { AutomationManifestSchema, MissionManifestSchema } from './schemas';

function mission(slug: string, extra: Record<string, unknown> = {}): LoadedMission {
  return { ...MissionManifestSchema.parse({ slug, name: `The ${slug}`, goal: 'Keep it current.', agent: 'kestrel-lead', ...extra }), sourceFile: `missions/${slug}.yaml`, origin: 'workspace' } as LoadedMission;
}

function automation(slug: string, when: Record<string, unknown>, doCfg: Record<string, unknown>, extra: Record<string, unknown> = {}): LoadedAutomation {
  return { ...AutomationManifestSchema.parse({ slug, when, do: doCfg, ...extra }), sourceFile: `automations/${slug}.yaml` };
}

describe('a mission\'s schedule runs as an automation (ADR 0008)', () => {
  it('turns schedule: into the automation a person would write, same cron, read in UTC as before', () => {
    const { automations, deprecations } = scheduledChecksFromMissions([mission('weekly-review', { schedule: '0 15 * * 1,5' })], []);

    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({ slug: 'weekly-review-check', status: 'active', agent: 'kestrel-lead', when: { schedule: '0 15 * * 1,5' }, do: { checkMission: 'weekly-review' } });
    expect(automations[0]!.when.timezone).toBeUndefined();
    expect(deprecations).toEqual([expect.objectContaining({ resource: 'mission', slug: 'weekly-review', message: expect.stringContaining('automation "weekly-review-check"') })]);
  });

  it('never fires the same check twice: an authored schedule for the mission keeps the cadence and schedule: is dropped', () => {
    const authored = [automation('morning-pass', { schedule: '30 13 * * 1-5' }, { checkMission: 'daily-touch' })];
    const { automations, deprecations } = scheduledChecksFromMissions([mission('daily-touch', { schedule: '30 14 * * 1-5' })], authored);

    expect(automations.map(a => a.slug)).toEqual(['morning-pass']);
    expect(deprecations[0]!.message).toContain('automation "morning-pass" already checks this mission');
  });

  it('still translates when the only automation checking it is an event, or is disabled', () => {
    const authored = [
      automation('on-reply', { event: 'prospect.reply' }, { checkMission: 'daily-touch' }),
      automation('old-pass', { schedule: '0 9 * * *' }, { checkMission: 'daily-touch' }, { status: 'disabled' }),
    ];
    const { automations } = scheduledChecksFromMissions([mission('daily-touch', { schedule: '30 14 * * 1-5' })], authored);

    expect(automations.map(a => a.slug)).toEqual(['on-reply', 'old-pass', 'daily-touch-check']);
  });

  it('takes the next free slug, and a disabled mission gets a disabled automation', () => {
    const authored = [automation('rooms-check', { event: 'object.created' }, { job: 'notify-asks' }, { agent: 'kestrel-lead' })];
    const { automations } = scheduledChecksFromMissions([mission('rooms', { schedule: '0 8 * * *', status: 'disabled' })], authored);

    expect(automations[1]).toMatchObject({ slug: 'rooms-scheduled-check', status: 'disabled' });
  });

  it('leaves a workspace with no mission schedules exactly as authored, with nothing to warn about', () => {
    const authored = [automation('morning', { schedule: '0 13 * * 1-5', timezone: 'America/Los_Angeles' }, { checkMission: 'daily' })];
    const result = scheduledChecksFromMissions([mission('daily')], authored);

    expect(result.automations).toEqual(authored);
    expect(result.deprecations).toEqual([]);
  });
});

describe('when.timezone', () => {
  it('accepts an IANA zone on a schedule', () => {
    expect(AutomationManifestSchema.safeParse({ slug: 'a', when: { schedule: '30 6 * * 1-5', timezone: 'America/Los_Angeles' }, do: { checkMission: 'm' } }).success).toBe(true);
  });

  it('refuses a zone that is not one, and a zone on an event', () => {
    expect(AutomationManifestSchema.safeParse({ slug: 'a', when: { schedule: '30 6 * * 1-5', timezone: 'Pacific Time' }, do: { checkMission: 'm' } }).success).toBe(false);
    expect(AutomationManifestSchema.safeParse({ slug: 'a', when: { event: 'prospect.reply', timezone: 'America/Los_Angeles' }, do: { checkMission: 'm' } }).success).toBe(false);
  });
});

describe('mission deliver:', () => {
  it('takes email: true or a list of addresses, and nothing else', () => {
    expect(MissionManifestSchema.safeParse({ slug: 'm', name: 'M', goal: 'g', agent: 'a', deliver: { email: true } }).success).toBe(true);
    expect(MissionManifestSchema.safeParse({ slug: 'm', name: 'M', goal: 'g', agent: 'a', deliver: { email: ['ops@example.com'] } }).success).toBe(true);
    expect(MissionManifestSchema.safeParse({ slug: 'm', name: 'M', goal: 'g', agent: 'a', deliver: { email: 'yes' } }).success).toBe(false);
  });
});
