import type { JudgeDeps, JudgeInput } from './handoffJudge';
import { describe, expect, it, vi } from 'vitest';
import { finalOutcome, judgeHandoff, judgeSystem, parseVerdict } from './handoffJudge';

const gate = { name: 'decision-ready', when: { field: 'state', becomes: ['in_scope'] }, producedBy: 'product-manager', require: [{ field: 'why', present: true }] };
const judge = { rubric: 'rubric-product-manager', cases: 'factory-reference', escalateBelow: 0.6, sampleRate: 1, alwaysEscalate: { riskClass: ['schema', 'billing'] } };
function input(after: Record<string, unknown> = {}): JudgeInput {
  return { typeLabel: 'Request', gate, judge, recordId: 41, title: 'Retry uploads on cellular', previous: 'triaged', after: { state: 'in_scope', ...after } };
}
function deps(raw: string): JudgeDeps & { stamp: ReturnType<typeof vi.fn>; revert: ReturnType<typeof vi.fn>; escalate: ReturnType<typeof vi.fn> } {
  return {
    compose: async () => raw,
    rubric: async () => '# The question\n**Would a product owner make the same decision?**',
    cases: async () => [{ input: 'Request 38 …', expectedOutput: 'Build. Reason: …' }],
    stamp: vi.fn(async () => undefined),
    revert: vi.fn(async () => undefined),
    escalate: vi.fn(async () => undefined),
    now: () => new Date('2026-09-24T12:00:00Z'),
  };
}

describe('the judge', () => {
  it('reads a verdict, and anything unreadable becomes an escalation, never a guess', () => {
    expect(parseVerdict('{"verdict":"return","confidence":0.9,"reasonCode":"untestable-criteria","example":"done when it works","note":"criterion 2 cannot be checked"}').verdict).toBe('return');
    expect(parseVerdict('Sure! Here is my view…').verdict).toBe('escalate');
    expect(parseVerdict('{"verdict":"pass","confidence":2}').confidence).toBe(1);
    expect(parseVerdict('{"verdict":"return","confidence":0.8,"reasonCode":"made-up"}').reasonCode).toBe('other');
  });

  it('escalates under the confidence bar and on a field the gate always escalates on', () => {
    expect(finalOutcome({ verdict: 'pass', confidence: 0.9, reasonCode: 'other', example: '', note: '' }, judge, {})).toBe('pass');
    expect(finalOutcome({ verdict: 'return', confidence: 0.4, reasonCode: 'other', example: '', note: '' }, judge, {})).toBe('escalate');
    expect(finalOutcome({ verdict: 'pass', confidence: 0.95, reasonCode: 'other', example: '', note: '' }, judge, { riskClass: 'billing' })).toBe('escalate');
  });

  it('passes: stamps the record and touches nothing else', async () => {
    const d = deps('{"verdict":"pass","confidence":0.85,"reasonCode":"other","example":"","note":"decidable"}');
    const out = await judgeHandoff(input(), d);

    expect(out.outcome).toBe('pass');
    expect(d.stamp).toHaveBeenCalledWith({ gate: expect.objectContaining({ name: 'decision-ready', judged: 'pass', confidence: 0.85, at: '2026-09-24T12:00:00.000Z' }) });
    expect(d.revert).not.toHaveBeenCalled();
    expect(d.escalate).not.toHaveBeenCalled();
  });

  it('returns: undoes the transition and names the seat, the reason and the example', async () => {
    const d = deps('{"verdict":"return","confidence":0.9,"reasonCode":"untestable-criteria","example":"\\"done when it works\\"","note":"criterion 2 cannot be checked by a person"}');
    const out = await judgeHandoff(input(), d);

    expect(out.outcome).toBe('return');
    expect(d.revert).toHaveBeenCalledWith(expect.objectContaining({ state: 'triaged', returnedTo: 'product-manager', gate: expect.objectContaining({ judged: 'return', reasonCode: 'untestable-criteria', example: '"done when it works"' }) }));
  });

  it('escalates: a person gets an ask naming the rubric and the thing in doubt', async () => {
    const d = deps('{"verdict":"pass","confidence":0.3,"reasonCode":"other","example":"the why is a guess","note":"not sure the evidence supports build"}');
    const out = await judgeHandoff(input(), d);

    expect(out.outcome).toBe('escalate');
    expect(d.escalate).toHaveBeenCalledWith({ title: 'Gate "decision-ready": Retry uploads on cellular', body: expect.stringContaining('the why is a guess') });
  });

  it('samples: below the rate it does not run, and a broken model never throws', async () => {
    const d = deps('{"verdict":"return","confidence":0.9}');

    expect(await judgeHandoff({ ...input(), judge: { ...judge, sampleRate: 0.2 } }, { ...d, random: () => 0.9 })).toEqual({ ran: false });
    expect(await judgeHandoff(input(), { ...d, compose: async () => {
      throw new Error('model down');
    } })).toEqual({ ran: false });
    expect(d.revert).not.toHaveBeenCalled();
  });

  it('builds the instruction from the seat\'s rubric and the cases', () => {
    const sys = judgeSystem(input(), '# The question', [{ input: 'Request 38', expectedOutput: 'Build.' }]);

    expect(sys).toContain('The seat that produced this work is PM');
    expect(sys).toContain('# The question');
    expect(sys).toContain('Case 1:\nRequest: Request 38\nIdeal: Build.');
    expect(sys).toContain('"verdict":"pass"|"return"|"escalate"');
  });
});
