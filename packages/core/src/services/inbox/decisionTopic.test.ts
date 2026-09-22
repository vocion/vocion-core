import { describe, expect, it } from 'vitest';
import { enrichmentLine, sameTopic, subjectWords, topicsOf } from '@/services/inbox/decisionTopic';

const at = (iso: string) => new Date(iso);
const item = (key: string, title: string, when: string) => ({ key, title, at: at(when) });

describe('decisionTopic', () => {
  describe('subjectWords', () => {
    it('keeps the subject and drops the factory’s own vocabulary', () => {
      expect([...subjectWords('Approve the task contracts for the nightly e2e runner')]).toEqual(['contracts', 'nightly', 'e2e', 'runner']);
    });

    it('leaves a chase with no subject at all, so chases cannot cluster on their own noise', () => {
      expect([...subjectWords('4 askers waiting 5 checks')]).toEqual([]);
    });
  });

  describe('sameTopic', () => {
    it('is true when two questions share two subject words', () => {
      expect(sameTopic(
        item('a', 'Build a two-pane admin panel for Send?', '2026-09-20T10:00:00Z'),
        item('b', 'Admin panel vs. Stamp rename: which goes next?', '2026-09-21T10:00:00Z'),
      )).toBe(true);
    });

    it('is false on one shared word: a product name is not a topic', () => {
      expect(sameTopic(
        item('a', 'Build a two-pane admin panel for Send?', '2026-09-20T10:00:00Z'),
        item('b', 'Send is RED on the nightly e2e runner', '2026-09-21T10:00:00Z'),
      )).toBe(false);
    });
  });

  describe('topicsOf', () => {
    it('folds the tradeoff into the build decision instead of filing a second one', () => {
      const build = item('ask:66', 'Build a two-pane admin panel for Send?', '2026-09-20T10:00:00Z');
      const tradeoff = item('ask:96', 'Admin panel vs. Stamp rename: which goes next?', '2026-09-21T09:00:00Z');

      const { topics } = topicsOf([build, tradeoff]);

      expect(topics).toHaveLength(1);
      expect(topics[0]!.root).toBe(build);
      expect(topics[0]!.members).toEqual([build, tradeoff]);
    });

    it('roots the topic at the oldest member, the decision owed longest', () => {
      const later = item('ask:97', 'Nightly e2e runner: what infrastructure should it use?', '2026-09-21T12:00:00Z');
      const earlier = item('ask:78', 'Is Slate e2e in scope for the nightly e2e mission?', '2026-09-21T06:00:00Z');

      expect(topicsOf([later, earlier]).topics[0]!.root).toBe(earlier);
    });

    it('is transitive: one conversation is one decision even when the vocabulary drifts', () => {
      const a = item('a', 'Nightly e2e runner infrastructure', '2026-09-20T01:00:00Z');
      const b = item('b', 'Nightly e2e runner and the Slate credentials', '2026-09-20T02:00:00Z');
      const c = item('c', 'Slate credentials rotation window', '2026-09-20T03:00:00Z');

      expect(topicsOf([a, b, c]).topics).toHaveLength(1);
    });

    it('keeps unrelated decisions apart', () => {
      const a = item('a', 'Build a two-pane admin panel for Send?', '2026-09-20T10:00:00Z');
      const b = item('b', 'Build PATCH/DELETE for the Vocion objects REST API?', '2026-09-20T11:00:00Z');

      expect(topicsOf([a, b]).topics).toHaveLength(2);
    });

    it('attaches refused items to the decision they are about, and leaves the rest unattached', () => {
      const root = item('ask:78', 'Is Slate e2e in scope for the nightly e2e mission?', '2026-09-21T06:00:00Z');
      const related = item('ask:84', 'P1 escalation: e2e runner + Slate scope, no decision', '2026-09-21T13:00:00Z');
      const unrelated = item('ask:61', 'Own the release notes for the observability releases?', '2026-09-20T20:00:00Z');

      const { topics, unattached } = topicsOf([root], [related, unrelated]);

      expect(topics[0]!.enrichments).toEqual([related]);
      expect(unattached).toEqual([unrelated]);
    });

    it('does not depend on the order rows came out of the database', () => {
      const rows = [
        item('c', 'Slate credentials rotation window', '2026-09-20T03:00:00Z'),
        item('a', 'Nightly e2e runner infrastructure', '2026-09-20T01:00:00Z'),
        item('b', 'Nightly e2e runner and the Slate credentials', '2026-09-20T02:00:00Z'),
      ];

      expect(topicsOf(rows).topics[0]!.members.map(m => m.key)).toEqual(['a', 'b', 'c']);
      expect(topicsOf([...rows].reverse()).topics[0]!.members.map(m => m.key)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('enrichmentLine', () => {
    it('says nothing when nothing was folded in', () => {
      const { topics } = topicsOf([item('a', 'Build the admin panel?', '2026-09-20T10:00:00Z')]);

      expect(enrichmentLine(topics[0]!)).toBeNull();
    });

    it('counts what the row absorbed', () => {
      const root = item('ask:78', 'Is Slate e2e in scope for the nightly e2e mission?', '2026-09-21T06:00:00Z');
      const member = item('ask:97', 'Nightly e2e runner: what infrastructure should it use?', '2026-09-21T12:00:00Z');
      const evidence = item('ask:84', 'P1 escalation: e2e runner + Slate scope', '2026-09-21T13:00:00Z');

      const { topics } = topicsOf([root, member], [evidence]);

      expect(enrichmentLine(topics[0]!)).toBe('1 related question folded in · 1 item of evidence');
    });
  });
});
