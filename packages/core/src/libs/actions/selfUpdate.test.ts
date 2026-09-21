import type { SelfUpdateReceipt } from './selfUpdate';
import { describe, expect, it } from 'vitest';
import { getAction } from './registry';
import {
  diffLines,
  isSelfUpdate,
  mergeSelfUpdate,
  NOUN_VERB,
  SELF_UPDATE_ACTION_IDS,
  SELF_UPDATE_KINDS,
  SELF_UPDATE_ON_THE_DIAL,
  SELF_UPDATE_RISK,
  selfUpdateGroupLabel,
  selfUpdateKind,
  selfUpdateLine,
  selfUpdateQueueHref,
} from './selfUpdate';
import '@/libs/actions/registry';

/**
 * The membership rules of the self-improvement class, as tests rather than as
 * a paragraph nobody reads.
 *
 * The important one is "everything in the class declares `undo`". That is the
 * whole argument for letting these run without a person: a change the system
 * made about itself has to be one click from being put back. A future noun
 * added to the table without an `undo` fails here rather than in production.
 */

const receipt = (over: Partial<SelfUpdateReceipt> = {}): SelfUpdateReceipt => ({
  runId: 41,
  noun: 'wiki',
  target: 'Founder voice',
  status: 'applied',
  ...over,
});

describe('which nouns are in the class', () => {
  it('names one action id per member, with no duplicates', () => {
    expect(new Set(SELF_UPDATE_ACTION_IDS).size).toBe(SELF_UPDATE_KINDS.length);
  });

  it('claims only kinds that are in the class', () => {
    expect(isSelfUpdate('wiki.write_page')).toBe(true);
    expect(isSelfUpdate('learning.adopt_rule')).toBe(true);
    expect(isSelfUpdate('agent.revise_prompt')).toBe(true);
    // Sending a person an email is the system changing the WORLD, not itself.
    expect(isSelfUpdate('gmail.send')).toBe(false);
    expect(isSelfUpdate('hubspot.update')).toBe(false);
    // A knowledge source is deliberately out: deleting one cascades its
    // documents and chunks away, so there is no one-click undo to earn it.
    expect(isSelfUpdate('source.add')).toBe(false);
  });

  it('every member declares undo — membership costs a real restore', () => {
    for (const kind of SELF_UPDATE_KINDS) {
      const action = getAction(kind.actionId);

      expect(action, `${kind.actionId} is in the class but not registered`).toBeDefined();
      expect(action!.undo, `${kind.actionId} is in the class with no undo`).toBeTypeOf('function');
    }
  });

  it('every member is internal — a self-update never reaches outside', () => {
    for (const kind of SELF_UPDATE_KINDS) {
      expect(getAction(kind.actionId)!.external, `${kind.actionId} touches the outside world`).toBe(false);
    }
  });

  it('agrees with the registry about which members ride the learning dial', () => {
    for (const kind of SELF_UPDATE_KINDS) {
      // The table says it and the action declares it, or neither does. A
      // disagreement here is a kind whose bar is not where the class says.
      expect(getAction(kind.actionId)!.selfImproving === true, `${kind.actionId} disagrees about selfImproving`).toBe(kind.onTheDial);
    }

    expect([...SELF_UPDATE_ON_THE_DIAL].sort()).toEqual(['learning.adopt_rule', 'mission.update_notes', 'playbook.write', 'wiki.write_page']);
  });

  it('holds the two kinds that change what the system DOES at medium, off the dial', () => {
    // Everything else in the class only changes what the system KNOWS — a
    // page, a rule, a note — and is low, reversible and on the dial or beside
    // it. These two change how it acts from the next turn onward: an agent
    // rewriting its own instructions, and an agent hiring a teammate that
    // will take turns and spend an allowance. Medium is what stops the ladder
    // ever offering either of them autonomy.
    const medium = SELF_UPDATE_KINDS.filter(k => k.risk === 'medium');

    expect(medium.map(k => k.actionId).sort()).toEqual(['agent.revise_prompt', 'team.hire_agent']);
    expect(medium.every(k => !k.onTheDial)).toBe(true);
    expect(SELF_UPDATE_KINDS.filter(k => k.risk !== 'medium').every(k => k.risk === 'low')).toBe(true);
    expect(selfUpdateKind('team.hire_agent')!.noun).toBe('teammate');
  });

  it('exports a risk table keyed the same way as the class', () => {
    expect(Object.keys(SELF_UPDATE_RISK).sort()).toEqual([...SELF_UPDATE_ACTION_IDS].sort());
    expect(SELF_UPDATE_RISK['agent.revise_prompt']).toBe('medium');
    expect(SELF_UPDATE_RISK['team.hire_agent']).toBe('medium');
  });

  it('gives every noun a verb', () => {
    for (const kind of SELF_UPDATE_KINDS) {
      expect(NOUN_VERB[kind.noun]).toBeTruthy();
    }
  });
});

describe('what the chip says for each kind', () => {
  it('leads with the verb for the noun and names what it touched', () => {
    expect(selfUpdateLine(receipt())).toBe('Updated the wiki · Founder voice');
  });

  it('says how much moved when the change has a size', () => {
    expect(selfUpdateLine(receipt({ noun: 'prompt', target: 'Proposal Writer', change: '+12 −4 lines' })))
      .toBe('Revised its own instructions · Proposal Writer · +12 −4 lines');
  });

  it('uses the mission, playbook, memory and capability words', () => {
    expect(selfUpdateLine(receipt({ noun: 'mission', target: 'Weekly sweep' }))).toBe('Updated mission notes · Weekly sweep');
    expect(selfUpdateLine(receipt({ noun: 'playbook', target: 'Discovery summary' }))).toBe('Revised a playbook · Discovery summary');
    expect(selfUpdateLine(receipt({ noun: 'memory', target: 'global' }))).toBe('Remembered a rule · global');
    expect(selfUpdateLine(receipt({ noun: 'capability', target: 'wiki' }))).toBe('Turned on a capability · wiki');
  });

  it('says so when it is waiting on a person instead of done', () => {
    expect(selfUpdateLine(receipt({ status: 'proposed' }))).toBe('Updated the wiki · Founder voice — waiting on you');
  });
});

describe('grouping several updates in a turn', () => {
  it('keeps one update as its own sentence', () => {
    expect(selfUpdateGroupLabel([receipt()])).toBe('Updated the wiki · Founder voice');
  });

  it('collapses several into one chip that counts them', () => {
    const rs = [receipt(), receipt({ runId: 42, noun: 'mission', target: 'Weekly sweep' })];

    expect(selfUpdateGroupLabel(rs)).toBe('Taught itself 2 things');
  });

  it('says how many of them are still waiting on a person', () => {
    const rs = [
      receipt(),
      receipt({ runId: 42, noun: 'prompt', target: 'Proposal Writer', status: 'proposed' }),
      receipt({ runId: 43, noun: 'playbook', target: 'Discovery summary', status: 'proposed' }),
    ];

    expect(selfUpdateGroupLabel(rs)).toBe('Taught itself 3 things · 2 waiting on you');
  });

  it('says nothing for a turn that taught itself nothing', () => {
    expect(selfUpdateGroupLabel([])).toBe('');
  });

  it('leaves ONE entry when the same run is refreshed mid-turn', () => {
    const first = receipt({ status: 'proposed' });
    const settled = receipt({ status: 'applied', change: 'v3' });

    expect(mergeSelfUpdate([first], settled)).toEqual([settled]);
  });

  it('keeps updates to different things side by side, newest last', () => {
    const wiki = receipt();
    const mission = receipt({ runId: 42, noun: 'mission', target: 'Weekly sweep' });

    expect(mergeSelfUpdate([wiki], mission).map(r => r.runId)).toEqual([41, 42]);
  });
});

describe('the diff a prompt change is read with', () => {
  it('counts the lines that arrived and the lines that went', () => {
    const d = diffLines('one\ntwo\nthree', 'one\ntwo point five\nthree\nfour');

    expect(d.removed).toBe(1);
    expect(d.added).toBe(2);
    expect(d.summary).toBe('+2 −1 lines');
  });

  it('reads a new file as all additions', () => {
    expect(diffLines('', 'a\nb').summary).toBe('+2 −0 lines');
  });

  it('does not call a reordering a rewrite', () => {
    const d = diffLines('a\nb\nc', 'c\nb\na');

    expect(d.summary).toBe('no lines changed');
  });

  it('ignores trailing whitespace and blank lines, which are not a change', () => {
    expect(diffLines('a\n\nb  ', 'a\nb').summary).toBe('no lines changed');
  });

  it('previews the changed lines themselves, signed', () => {
    const d = diffLines('keep\ndrop', 'keep\nadd');

    expect(d.preview).toEqual(['− drop', '+ add']);
  });
});

describe('everything it has taught itself, in one move', () => {
  it('is the review queue filtered to the class, not a second history page', () => {
    const href = selfUpdateQueueHref();

    expect(href.startsWith('/dashboard/inbox?tab=decided&kind=proposal&actionKind=')).toBe(true);

    for (const id of SELF_UPDATE_ACTION_IDS) {
      expect(href).toContain(id);
    }
  });

  it('can point at what is still waiting instead', () => {
    expect(selfUpdateQueueHref('open')).toContain('tab=open');
  });
});
