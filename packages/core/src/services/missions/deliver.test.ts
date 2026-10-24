import { beforeEach, describe, expect, it, vi } from 'vitest';

const job = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/services/jobs/dailyTeamReport', () => ({ runDailyTeamReportJob: job.run }));
// The failure path reads the project for its link and its accountable person;
// here there is none, so the note reports that instead of sending.
vi.mock('@/libs/DB', () => {
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => [] };
  return { db: { select: () => chain } };
});

const { deliverCheckResult, failureNote } = await import('./deliver');

const MISSION = { name: 'Daily marketing update', agentSlug: 'marketing-lead', deliver: { email: true as const } };
const STARTED = new Date('2026-11-02T14:30:00Z');

describe('a check delivers when it finishes (ADR 0008)', () => {
  beforeEach(() => job.run.mockReset());

  it('mails the briefing this check published, read only from after the check started', async () => {
    job.run.mockResolvedValue({ mail: { sent: true, id: 'm1' } });
    const out = await deliverCheckResult({ orgId: 'org_kestrel', mission: MISSION, runId: 7, failed: null, startedAt: STARTED });

    expect(out).toEqual({ delivered: 'briefing', mail: { sent: true } });
    expect(job.run).toHaveBeenCalledWith('org_kestrel', expect.objectContaining({ briefing: { agentSlug: 'marketing-lead' }, since: STARTED.toISOString(), requireFresh: true, publish: false }));
  });

  it('sends nothing when the check finished and published nothing', async () => {
    job.run.mockResolvedValue({ mail: { sent: false, reason: 'no briefing was published in this window' } });

    await expect(deliverCheckResult({ orgId: 'org_kestrel', mission: MISSION, runId: 7, failed: null, startedAt: STARTED }))
      .resolves
      .toEqual({ delivered: 'nothing', reason: 'the check published no briefing' });
  });

  it('never mails an older briefing for a failed check: it sends the failure note instead', async () => {
    const out = await deliverCheckResult({ orgId: 'org_kestrel', mission: MISSION, runId: 7, failed: 'Google Ads refused the report', startedAt: STARTED });

    expect(job.run).not.toHaveBeenCalled();
    expect(out.delivered).toBe('failure-note');
  });

  it('does nothing for a mission that delivers nowhere', async () => {
    await expect(deliverCheckResult({ orgId: 'org_kestrel', mission: { ...MISSION, deliver: null }, runId: 7, failed: null, startedAt: STARTED }))
      .resolves
      .toEqual({ delivered: 'nothing', reason: 'the mission delivers nowhere' });
    expect(job.run).not.toHaveBeenCalled();
  });

  it('words the failure note plainly, with the reason and the run', () => {
    const note = failureNote('Daily marketing update', 'Google Ads refused the report\n(quota)', 'https://agents.example.com/w/kestrel/dashboard/missions/runs/7');

    expect(note.subject).toBe('Daily marketing update did not finish');
    expect(note.text).toContain('Google Ads refused the report (quota)');
    expect(note.text).toContain('Nothing older was sent in its place.');
    expect(note.html).toContain('href="https://agents.example.com/w/kestrel/dashboard/missions/runs/7"');
  });
});
