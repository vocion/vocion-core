import { describe, expect, it, vi } from 'vitest';
import { DIRECTIVE_CONFIDENCE, HEDGED_CONFIDENCE } from './workCorrections';

vi.mock('@/services/ActionService', () => ({
  proposeAction: vi.fn(async () => ({ runId: 41, status: 'done', outcome: 'created', result: { outcome: 'adopted' } })),
}));

const { proposeAction } = await import('@/services/ActionService');
const {
  correctionInTurn,
  directivesIn,
  learnFromWorkCorrection,
  learningReceipt,
  parseDraftedRules,
  ruleConfidence,
} = await import('./workCorrections');

describe('directivesIn', () => {
  it('reads the corrections from the evening that started this, in the words they were given in', () => {
    // Paraphrased onto the fixture cast — the FORM is what is under test.
    const message = [
      'Put the client\'s logo lockup and a three-month strip on the cover.',
      'Give the gap sheet a deliberately plain window showing the spreadsheet they use now.',
      'Render the three products as side-by-side windows.',
    ].join(' ');
    const found = directivesIn(message);

    expect(found.map(d => d.confidence)).toEqual([DIRECTIVE_CONFIDENCE, DIRECTIVE_CONFIDENCE, DIRECTIVE_CONFIDENCE]);
    expect(found[0]!.text).toContain('logo lockup');
    expect(found[0]!.why).toContain('own words');
  });

  it('takes a standing word anywhere in the sentence, whatever it opens with', () => {
    const found = directivesIn('A sheet should never be a wall of text.');

    expect(found).toHaveLength(1);
    expect(found[0]!.why).toContain('standing instruction');
  });

  it('reads a bulleted list of corrections', () => {
    const found = directivesIn('Three things:\n- cut the second FAQ answer\n- move the Gantt to sheet 7\n2. never lead with the negative');

    expect(found.map(d => d.text)).toEqual([
      'cut the second FAQ answer',
      'move the Gantt to sheet 7',
      'never lead with the negative',
    ]);
  });

  it('marks a hedge as a suggestion, which will ask rather than adopt', () => {
    const [d] = directivesIn('Maybe put a caption under the window as well.');

    expect(d?.confidence).toBe(HEDGED_CONFIDENCE);
    expect(d?.why).toContain('hedged');
  });

  it('finds nothing in a question, an approval, or plain conversation', () => {
    expect(directivesIn('Could the cover carry their logo?')).toEqual([]);
    expect(directivesIn('Looks great, ship it.')).toEqual([]);
    expect(directivesIn('Thanks — that reads much better now.')).toEqual([]);
    expect(directivesIn('The client called this afternoon and confirmed the kickoff date.')).toEqual([]);
    expect(directivesIn('Yes')).toEqual([]);
  });

  it('is strict about what counts: an unrecognised opening produces nothing at all', () => {
    // No candidate beats a wrong one. "Interpolate the…" is an instruction in
    // English and not one this list knows; it files nothing rather than
    // guessing at a rule.
    expect(directivesIn('Interpolate the sheet order from the decision log.')).toEqual([]);
  });

  it('ignores a fragment too short to be a rule and a paragraph too long to be one', () => {
    expect(directivesIn('cut it.')).toEqual([]);
    expect(directivesIn(`put ${'a very long clause '.repeat(20)}on the cover`)).toEqual([]);
  });

  it('stops at six, so one long message cannot flood the ladder', () => {
    const message = Array.from({ length: 12 }, (_, i) => `Cut paragraph ${i + 1} from that sheet.`).join(' ');

    expect(directivesIn(message)).toHaveLength(6);
  });
});

describe('correctionInTurn', () => {
  const message = 'Put the client\'s logo lockup on the cover.';

  it('fires only when the turn actually changed a document', () => {
    expect(correctionInTurn({ message, toolNames: ['read_data_room', 'edit_document'] })?.via).toBe('edit_document');
    expect(correctionInTurn({ message, toolNames: ['render_document'] })?.via).toBe('render_document');
  });

  it('stays quiet when the turn only looked at the work', () => {
    expect(correctionInTurn({ message, toolNames: ['read_document', 'verify_document'] })).toBeNull();
    expect(correctionInTurn({ message, toolNames: [] })).toBeNull();
  });

  it('stays quiet when a document changed but nobody instructed', () => {
    expect(correctionInTurn({ message: 'Looks great, ship it.', toolNames: ['edit_document'] })).toBeNull();
  });
});

describe('parseDraftedRules', () => {
  it('reads the shape and defaults `generalises` to true when the model omits it', () => {
    const out = parseDraftedRules('sure! {"rules":[{"rule":"Every sheet carries a component or says why it does not.","generalises":true},{"rule":"Put the buyer\'s logo lockup on the cover."}]}');

    expect(out).toEqual([
      { rule: 'Every sheet carries a component or says why it does not.', generalises: true },
      { rule: 'Put the buyer\'s logo lockup on the cover.', generalises: true },
    ]);
  });

  it('keeps a false `generalises` — the rule that is only about this client', () => {
    expect(parseDraftedRules('{"rules":[{"rule":"Price Northwind per yard, not per structure.","generalises":false}]}'))
      .toEqual([{ rule: 'Price Northwind per yard, not per structure.', generalises: false }]);
  });

  it('caps at three', () => {
    const rules = Array.from({ length: 8 }, (_, i) => ({ rule: `Rule number ${i} about the sheets.`, generalises: true }));

    expect(parseDraftedRules(JSON.stringify({ rules }))).toHaveLength(3);
  });

  it('fails closed on anything it cannot read', () => {
    expect(parseDraftedRules('I could not do that.')).toEqual([]);
    expect(parseDraftedRules('{"rules": "nope"}')).toEqual([]);
    expect(parseDraftedRules('{ broken json')).toEqual([]);
    expect(parseDraftedRules('{"rules":[{"rule":"short"}]}')).toEqual([]);
  });
});

describe('ruleConfidence', () => {
  it('keeps the person\'s own certainty when the rule generalises', () => {
    expect(ruleConfidence({ text: 'x', confidence: 0.9, why: '' }, { rule: 'r', generalises: true })).toBe(0.9);
  });

  it('pulls a rule that is only about this client below the bar, however plainly it was said', () => {
    expect(ruleConfidence({ text: 'x', confidence: 0.9, why: '' }, { rule: 'r', generalises: false })).toBe(HEDGED_CONFIDENCE);
  });
});

describe('learnFromWorkCorrection', () => {
  it('proposes one rule per drafted rule and hands back one receipt for the turn', async () => {
    vi.mocked(proposeAction)
      .mockResolvedValueOnce({ runId: 41, status: 'done', outcome: 'created', result: { outcome: 'adopted' } } as never)
      .mockResolvedValueOnce({ runId: 42, status: 'pending', outcome: 'created' } as never);

    const out = await learnFromWorkCorrection({
      orgId: 'org_1',
      agentSlug: 'proposal-writer',
      userId: 'usr_1',
      correction: {
        via: 'edit_document',
        directives: [
          { text: 'Never let a sheet be a wall of text.', confidence: 0.9, why: 'a standing instruction in the person\'s own words' },
          { text: 'Maybe drop the second FAQ answer.', confidence: 0.5, why: 'hedged — a suggestion rather than a directive' },
        ],
      },
      draft: async () => [
        { rule: 'Every sheet carries a component from the vocabulary, or says in one line why it needs none.', generalises: true },
        { rule: 'Keep the FAQ to one answer per question.', generalises: true },
      ],
    });

    expect(out.learned.map(l => l.state)).toEqual(['executed', 'pending']);
    expect(vi.mocked(proposeAction).mock.calls[0]![0]).toMatchObject({
      actionId: 'learning.adopt_rule',
      proposal: { confidence: 0.9 },
    });
    expect(vi.mocked(proposeAction).mock.calls[1]![0].proposal?.confidence).toBe(0.5);
    // The evidence carried on every proposal is the person's own words.
    expect((vi.mocked(proposeAction).mock.calls[0]![0].input as { note: string }).note).toContain('Never let a sheet be a wall of text.');
    expect(out.receipt).toContain('1 rule now standing');
    expect(out.receipt).toContain('run #41');
    expect(out.receipt).toContain('waiting on you in Review');
  });

  it('files nothing when the model drafted no standing rule', async () => {
    const out = await learnFromWorkCorrection({
      orgId: 'org_1',
      correction: { via: 'edit_document', directives: [{ text: 'Cut that line.', confidence: 0.9, why: '' }] },
      draft: async () => [],
    });

    expect(out).toEqual({ learned: [], receipt: null });
  });

  it('survives a refused proposal without losing the others', async () => {
    vi.mocked(proposeAction)
      .mockRejectedValueOnce(new Error('VALIDATION_FAILED: rule too short'))
      .mockResolvedValueOnce({ runId: 44, status: 'done', outcome: 'created', result: { outcome: 'adopted' } } as never);

    const out = await learnFromWorkCorrection({
      orgId: 'org_1',
      correction: {
        via: 'render_document',
        directives: [
          { text: 'Put their lockup on the cover.', confidence: 0.9, why: '' },
          { text: 'Never promise a business outcome.', confidence: 0.9, why: '' },
        ],
      },
      draft: async () => [
        { rule: 'Put the buyer\'s own logo lockup beside the seller\'s on the cover.', generalises: true },
        { rule: 'Never promise a business outcome; commit capabilities and measure together.', generalises: true },
      ],
    });

    expect(out.learned.map(l => l.state)).toEqual(['failed', 'executed']);
    expect(out.receipt).toContain('run #44');
  });
});

describe('learningReceipt', () => {
  it('is one receipt for the turn, each rule undoable on its own', () => {
    const receipt = learningReceipt(
      [
        { rule: 'A', confidence: 0.9, runId: 1, state: 'executed' },
        { rule: 'B', confidence: 0.9, runId: 2, state: 'executed' },
        { rule: 'C', confidence: 0.5, runId: 3, state: 'pending' },
        { rule: 'D', confidence: 0.9, runId: 4, state: 'duplicate' },
      ],
      'proposal-feedback',
    );

    expect(receipt).toContain('2 rules now standing in **proposal-feedback**');
    expect(receipt).toContain('- A · undo in Review › Decided (run #1)');
    expect(receipt).toContain('1 rule is waiting on you in Review');
    expect(receipt).toContain('occurrence count went up instead');
  });

  it('says nothing when nothing happened', () => {
    expect(learningReceipt([], 'proposal-feedback')).toBeNull();
    expect(learningReceipt([{ rule: 'A', confidence: 0.9, runId: 0, state: 'failed' }], undefined)).toBeNull();
  });
});
