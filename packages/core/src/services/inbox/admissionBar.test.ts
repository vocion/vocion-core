import { describe, expect, it } from 'vitest';
import { admit, clearsBar } from '@/services/inbox/admissionBar';

const ask = (title: string, extra: Partial<Parameters<typeof admit>[0]> = {}) => ({ kind: 'ruling', title, ...extra });

describe('admissionBar', () => {
  describe('what it admits, one category at a time', () => {
    it('admits a direction question: what the company builds', () => {
      const v = admit(ask('Build a two-pane admin panel for Send?', { kind: 'recommendation' }));

      expect(v).toMatchObject({ admitted: true, grounds: 'direction' });
    });

    it('admits a priority question: what goes first, and therefore what stops', () => {
      const v = admit(ask('Admin panel vs. Stamp rename: which goes next?'));

      expect(v).toMatchObject({ admitted: true, grounds: 'priority' });
    });

    it('admits a consequence question even when it is phrased as a chore', () => {
      const v = admit({ kind: 'approval', title: 'Apply the new pricing to existing customers', actionId: 'stripe.update_price' });

      expect(v).toMatchObject({ admitted: true, grounds: 'consequence' });
    });

    it('admits an authority question: who is allowed to act', () => {
      const v = admit(ask('Who approves a deploy to production on a Friday?'));

      expect(v).toMatchObject({ admitted: true, grounds: 'authority' });
    });

    it('admits a policy question: answered once, applied afterwards', () => {
      const v = admit(ask('Should the factory merge dependency bumps automatically from now on?'));

      expect(v).toMatchObject({ admitted: true, grounds: 'policy' });
    });

    it('admits a credential as a grant of authority', () => {
      const v = admit({ kind: 'credential', title: 'Slate API key needed for the nightly run' });

      expect(v).toMatchObject({ admitted: true, grounds: 'authority' });
    });
  });

  describe('what it refuses, and where each one goes', () => {
    it('sends a refused worker contract back to the factory', () => {
      const v = admit({ kind: 'exception', title: 'send-engineer refused the contract for task 0005' });

      expect(v).toMatchObject({ admitted: false, destination: 'resolve' });
    });

    it('sends a failed typecheck back to the factory', () => {
      expect(admit({ kind: 'exception', title: 'Worker run 349: typecheck failed' })).toMatchObject({ admitted: false, destination: 'resolve' });
    });

    it('sends a timeout and a no-change run back to the factory', () => {
      expect(admit({ kind: 'exception', title: 'Worker run 351 timed out after 30m' })).toMatchObject({ admitted: false, destination: 'resolve' });
      expect(admit({ kind: 'exception', title: 'Worker run 352 made no changes' })).toMatchObject({ admitted: false, destination: 'resolve' });
    });

    it('delegates a ranking metadata update under the factory’s own policy', () => {
      const v = admit({ kind: 'proposal', title: 'Action · objects.update_meta', actionId: 'objects.update_meta' });

      expect(v).toMatchObject({ admitted: false, destination: 'delegate', policy: 'ranking-is-the-factory’s-job' });
    });

    it('delegates release-note ownership to a standing owner', () => {
      const v = admit({ kind: 'approval', title: 'Own the release notes for the observability releases (req 41)?' });

      expect(v).toMatchObject({ admitted: false, destination: 'delegate', policy: 'release-notes-have-a-standing-owner' });
    });

    it('delegates telling a requester their thing shipped', () => {
      const v = admit({ kind: 'proposal', title: 'Action · notify.requester', actionId: 'notify.requester' });

      expect(v).toMatchObject({ admitted: false, destination: 'delegate', policy: 'every-asker-hears-back' });
    });

    it('delegates creating a bug record', () => {
      const v = admit({ kind: 'approval', title: 'Send: no nightly e2e against deployed URL - approve bug record?' });

      expect(v).toMatchObject({ admitted: false, destination: 'delegate', policy: 'the-factory-files-its-own-bugs' });
    });

    it('resolves missing data rather than asking for it', () => {
      const v = admit({ kind: 'input', title: 'Slate has no counter stamp - what are the product record IDs?' });

      expect(v).toMatchObject({ admitted: false, destination: 'resolve' });
    });

    it('turns a chase into evidence, never a second decision', () => {
      const v = admit(ask('P1 escalation: e2e runner + Slate scope - 3 checks, no decision'));

      expect(v).toMatchObject({ admitted: false, destination: 'evidence' });
    });

    it('turns a chase about a delegated topic into evidence that the policy is missing', () => {
      const v = admit(ask('CRITICAL (check 10): 4 askers waiting 13+ hrs - rule on agent release notes'));

      expect(v).toMatchObject({ admitted: false, destination: 'evidence', policy: 'release-notes-have-a-standing-owner' });
    });

    it('delegates a wiki write-up of what the factory already did', () => {
      expect(admit({ kind: 'approval', title: 'Write the wiki page for worker run 349' })).toMatchObject({ admitted: false, destination: 'delegate', policy: 'the-factory-writes-its-own-notes' });
    });
  });

  describe('declared grounds', () => {
    it('believes a filer that says what its answer changes', () => {
      expect(admit({ kind: 'approval', title: 'Rename the workspace', grounds: 'direction' })).toMatchObject({ admitted: true, grounds: 'direction' });
    });

    it('believes it over a text rule, so an escalation the factory cannot recover still reaches a person', () => {
      const v = admit({ kind: 'exception', title: 'send-engineer: typecheck failed on the third attempt', grounds: 'policy' });

      expect(v).toMatchObject({ admitted: true, grounds: 'policy' });
    });

    it('does not let a declaration rescue bookkeeping', () => {
      const v = admit({ kind: 'proposal', title: 'Action · objects.update_meta', actionId: 'objects.update_meta', grounds: 'direction' });

      expect(v.admitted).toBe(false);
    });
  });

  it('does not mistake a direction question for a consequence one just because it says delete', () => {
    expect(admit({ kind: 'recommendation', title: 'Build PATCH/DELETE for the Vocion objects REST API?' })).toMatchObject({ admitted: true, grounds: 'direction' });
  });

  it('reads the body for admission but not for refusal', () => {
    // A real product question that happens to quote a failed check must not be
    // refused for the quote.
    const v = admit({ kind: 'recommendation', title: 'Should we split the deploy pipeline?', body: 'The typecheck failed twice last week.' });

    expect(v.admitted).toBe(true);
  });

  describe('what it does NOT refuse', () => {
    it('admits a proposed action that touches the world outside Vocion', () => {
      const v = admit({ kind: 'proposal', title: 'Enroll Jamie Smith in the MQL sequence', actionId: 'hubspot.enroll' });

      expect(v).toMatchObject({ admitted: true, grounds: 'consequence' });
    });

    it('reaches for consequence when the subject is one, whatever kind it was filed as', () => {
      expect(admit({ kind: 'input', title: 'Which pricing tier should the Orlin proposal quote?' })).toMatchObject({ admitted: true, grounds: 'consequence' });
    });

    it('admits a suggested rule as the policy change it is', () => {
      expect(admit({ kind: 'learning', title: 'Always name the discovery call date in the first line' })).toMatchObject({ admitted: true, grounds: 'policy' });
    });

    it('admits a run that stopped and is waiting for permission', () => {
      expect(admit({ kind: 'run', title: 'Nightly outreach \u2014 workflow paused at an approval gate' })).toMatchObject({ admitted: true, grounds: 'authority' });
    });

    it('admits a question it has no rule for, rather than swallowing it', () => {
      const v = admit({ kind: 'input', title: 'Which tone should the Orlin proposal take?' });

      expect(v).toMatchObject({ admitted: true, grounds: 'direction' });
    });
  });

  it('clearsBar is the shorthand', () => {
    expect(clearsBar({ kind: 'recommendation', title: 'Build a two-pane admin panel for Send?' })).toBe(true);
    expect(clearsBar({ kind: 'proposal', title: 'Action · wiki.write_page', actionId: 'wiki.write_page' })).toBe(false);
  });
});
