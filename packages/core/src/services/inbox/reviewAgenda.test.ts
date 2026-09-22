import type { AgendaCandidate } from '@/services/inbox/reviewAgenda';
import { describe, expect, it } from 'vitest';
import { reviewAgenda } from '@/services/inbox/reviewAgenda';

let clock = 0;
const ask = (key: string, title: string, over: Partial<AgendaCandidate> = {}): AgendaCandidate => ({
  key,
  kind: 'ruling',
  title,
  at: new Date(Date.UTC(2026, 8, 20, clock++)),
  ...over,
});

/**
 * The live squatch-factory queue on 2026-09-21, the one Chris red-teamed:
 * twenty-two open asks and thirteen proposed actions.
 */
function liveQueue(): AgendaCandidate[] {
  clock = 0;
  return [
    ask('ask:59', 'Build PATCH/DELETE for the Vocion objects REST API?', { kind: 'recommendation' }),
    ask('ask:61', 'Own the release notes for the observability releases (req 41)?', { kind: 'approval' }),
    ask('ask:62', 'Own the release notes for squatch-factory worker 20260920-2010?', { kind: 'approval' }),
    ask('ask:63', 'Own the release notes for squatch-factory worker 20260920-2040?', { kind: 'approval' }),
    ask('ask:64', 'Own the release notes for the multi-team releases (req 39)?', { kind: 'approval' }),
    ask('ask:65', 'Let a failed worker run carry its kept branch and draft PR?', { kind: 'recommendation' }),
    ask('ask:66', 'Build a two-pane admin panel for Send?', { kind: 'recommendation' }),
    ask('ask:67', 'Asks #61 and #64 open 2 checks - req 39 and 41 askers still waiting'),
    ask('ask:68', 'Asks #61–64 open 2 checks: 4 askers still waiting on notes ownership'),
    ask('ask:69', 'CRITICAL: 4 askers waiting 3+ checks - decide notes ownership now'),
    ask('ask:70', 'CRITICAL (check 7): 4 askers still waiting - decide notes ownership now'),
    ask('ask:71', 'SYSTEM FAILURE: 4 askers waiting 5 checks - decide notes ownership now'),
    ask('ask:76', 'Send: no nightly e2e against deployed URL - approve bug record?', { kind: 'approval' }),
    ask('ask:77', 'CHECK 10 ESCALATION: 4 askers uncontacted - direct owner action needed'),
    ask('ask:78', 'Is Slate e2e in scope for the nightly e2e mission?'),
    ask('ask:79', 'CRITICAL (check 10): 4 askers waiting 13+ hrs - rule on agent release notes'),
    ask('ask:80', 'Approve task contracts for nightly e2e runner (Send is RED)', { kind: 'approval' }),
    ask('ask:81', 'Slate has no counter stamp - what are the product record IDs?', { kind: 'input' }),
    ask('ask:84', 'P1 escalation: e2e runner + Slate scope - 3 checks, no decision'),
    ask('ask:95', '3 notify.requester proposals still pending - approve or unblock?'),
    ask('ask:96', 'Admin panel vs. Stamp rename: which goes next?'),
    ask('ask:97', 'Nightly e2e runner: what infrastructure should it use?'),
    ...['1922', '1945', '1964', '2189', '2194', '2195', '2208'].map(id => ask(`proposal:${id}`, 'Action · objects.update_meta', { kind: 'proposal', actionId: 'objects.update_meta' })),
    ask('proposal:1456', 'Action · wiki.write_page', { kind: 'proposal', actionId: 'wiki.write_page' }),
    ask('proposal:2209', 'Action · ask.file', { kind: 'proposal', actionId: 'ask.file' }),
    ask('proposal:2584', 'Action · objects.propose_candidate', { kind: 'proposal', actionId: 'objects.propose_candidate' }),
    ...['2630', '2631', '2632'].map(id => ask(`proposal:${id}`, 'Action · notify.requester', { kind: 'proposal', actionId: 'notify.requester' })),
  ];
}

describe('reviewAgenda', () => {
  describe('the live queue of 2026-09-21', () => {
    const candidates = liveQueue();
    const agenda = reviewAgenda(candidates);

    it('starts from thirty-five candidates', () => {
      expect(candidates).toHaveLength(35);
    });

    it('puts four decisions in front of a person', () => {
      expect(agenda.entries).toHaveLength(4);
    });

    it('asks about direction and priority, and nothing about bookkeeping', () => {
      expect(agenda.entries.map(e => e.topic.root.key).sort()).toEqual(['ask:59', 'ask:65', 'ask:66', 'ask:78']);
      expect(new Set(agenda.entries.flatMap(e => e.grounds))).toEqual(new Set(['direction', 'priority']));
    });

    it('folds the admin-versus-Stamp tradeoff into the admin decision', () => {
      const admin = agenda.entries.find(e => e.topic.root.key === 'ask:66')!;

      expect(admin.topic.members.map(m => m.key)).toEqual(['ask:66', 'ask:96']);
      expect(admin.grounds).toEqual(['direction', 'priority']);
    });

    it('folds the e2e infrastructure question and its chases into one decision', () => {
      const e2e = agenda.entries.find(e => e.topic.root.key === 'ask:78')!;

      expect(e2e.topic.members.map(m => m.key)).toEqual(['ask:78', 'ask:80', 'ask:97']);
      expect(e2e.topic.enrichments.map(m => m.key).sort()).toEqual(['ask:76', 'ask:84']);
    });

    it('accounts for every single candidate: nothing is silently dropped', () => {
      const seen = new Set([...agenda.entries.flatMap(e => e.topic.members.map(m => m.key)), ...agenda.reclassified.map(r => r.item.key)]);

      expect(seen.size).toBe(candidates.length);
    });

    it('sends the thirteen proposed actions to a standing policy or back to the factory', () => {
      const proposals = agenda.reclassified.filter(r => r.item.key.startsWith('proposal:'));

      expect(proposals).toHaveLength(13);
      expect(proposals.every(r => r.destination !== 'evidence' || r.policy !== null)).toBe(true);
    });

    it('reports the chasing as one missing rule rather than eleven rows', () => {
      const askers = agenda.policyGaps.find(g => g.policy === 'every-asker-hears-back')!;

      expect(askers.chases).toBeGreaterThanOrEqual(4);
      expect(askers.summary).toMatch(/The rule needs changing, not the items answering/);
    });
  });

  it('gives every reclassified item a reason', () => {
    const { reclassified } = reviewAgenda(liveQueue());

    expect(reclassified.every(r => r.because.length > 0)).toBe(true);
  });

  it('marks an item folded onto a decision as evidence for that decision', () => {
    const { reclassified } = reviewAgenda(liveQueue());
    const chase = reclassified.find(r => r.item.key === 'ask:84')!;

    expect(chase.destination).toBe('evidence');
    expect(chase.topicKey).toBe('topic:ask:78');
    expect(chase.because).toMatch(/enriches a decision already on the agenda/);
  });

  it('shows nothing when the factory has nothing that needs a person', () => {
    const agenda = reviewAgenda([ask('proposal:1', 'Action · notify.requester', { kind: 'proposal', actionId: 'notify.requester' })]);

    expect(agenda.entries).toEqual([]);
    expect(agenda.policyGaps.map(g => g.policy)).toEqual(['every-asker-hears-back']);
  });
});
