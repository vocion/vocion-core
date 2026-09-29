import { describe, expect, it } from 'vitest';
import { evalAddCaseAction } from './eval-add-case';

const input = {
  datasetSlug: 'rfi-writer-regression',
  input: 'Draft an RFI with two options',
  expectedOutput: 'Names the recommended option and why.',
  note: 'Name the option you recommend.',
  reason: 'Every RFI with options, not just this one.',
};

describe('eval.add_case', () => {
  it('is a gated, reversible self-improving kind', () => {
    expect(evalAddCaseAction.selfImproving).toBe(true);
    expect(evalAddCaseAction.external).toBe(false);
    expect(evalAddCaseAction.undo).toBeTypeOf('function');
  });

  it('refuses a case with no expected answer', () => {
    expect(evalAddCaseAction.inputSchema.safeParse({ ...input, expectedOutput: '' }).success).toBe(false);
  });

  it('keys the same case the same way, whatever its spacing', () => {
    const a = evalAddCaseAction.dedupKeyFor!(evalAddCaseAction.inputSchema.parse(input));
    const b = evalAddCaseAction.dedupKeyFor!(evalAddCaseAction.inputSchema.parse({ ...input, input: '  Draft an   RFI with two options ' }));

    expect(a).toBe(b);
  });

  it('shows the person the case, the good answer and their own words', async () => {
    const card = await evalAddCaseAction.reviewCard!({} as never, evalAddCaseAction.inputSchema.parse(input));
    const labels = card.fields?.map(f => f.label);

    expect(labels).toEqual(expect.arrayContaining(['The check', 'A good answer', 'They said']));
    expect(card.verbs?.approve).toBe('Add the check');
  });
});
