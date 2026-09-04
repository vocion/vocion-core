/**
 * The two-stage duplicate check: trigram shortlist, then one model call that
 * judges the shortlist. Covers the shortlist's own behaviour and every way the
 * judge can fail — all of which must resolve to "not a duplicate", because a
 * duplicate in the queue is recoverable and dropped feedback is not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }),
}));

// Tracing is a no-op here: left real it would try to reach a local Langfuse.
vi.mock('@/libs/Langfuse', () => ({
  cleanUsageDetails: (details: unknown) => details,
  traceFor: () => ({
    update: () => {},
    generation: () => ({ end: () => {} }),
  }),
}));

const { findDuplicateRule, shortlistForJudge } = await import('@/services/feedback/duplicateDetection');

const ORG = 'org_dedupe';
const STEP = 'crm-updates';

/**
 * A rule already on file, in the shape the detector consumes.
 * @param id
 * @param ruleText
 */
function existingCandidate(id: number, ruleText: string) {
  return { kind: 'candidate' as const, id, ruleText };
}

function judgeReplies(text: string) {
  return { content: text, usage_metadata: { input_tokens: 8, output_tokens: 4 } };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('shortlistForJudge', () => {
  it('puts the textually closest rule first', () => {
    const shortlist = shortlistForJudge('always cite the source line', [
      existingCandidate(1, 'greet the customer by first name'),
      existingCandidate(2, 'always cite the source line eventually'),
      existingCandidate(3, 'always cite the source line'),
    ]);

    expect(shortlist[0]?.id).toBe(3);
  });

  it('still includes a rule with no shared wording, which is the duplicate trigram cannot see', () => {
    const shortlist = shortlistForJudge('always cite the source line for every number', [
      existingCandidate(1, 'never state a number without pointing at where it came from'),
    ]);

    expect(shortlist.map(rule => rule.id)).toEqual([1]);
  });

  it('lists every rule once, however it earned its place', () => {
    const shortlist = shortlistForJudge('always cite the source line', [
      existingCandidate(1, 'always cite the source line'),
      existingCandidate(2, 'greet the customer by first name'),
    ]);

    expect(shortlist.map(rule => rule.id)).toEqual([1, 2]);
  });

  it('caps how many rules the model is asked to judge at once', () => {
    const many = Array.from({ length: 30 }, (_, index) => existingCandidate(index + 1, `rule number ${index}`));

    expect(shortlistForJudge('always cite the source line', many)).toHaveLength(12);
  });

  it('returns nothing when there is nothing on file', () => {
    expect(shortlistForJudge('always cite the source line', [])).toEqual([]);
  });
});

describe('findDuplicateRule', () => {
  it('does not call the model when there is nothing on file', async () => {
    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'lead with the weighted pipeline total',
      existing: [],
    });

    expect(verdict).toEqual({ duplicate: false });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reports the matched rule when the judge names a shortlisted id', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate_of": 1, "reason": "same instruction, different words"}'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({
      duplicate: true,
      matched: existingCandidate(7, 'always cite the source line for each number'),
      reason: 'same instruction, different words',
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('judges the whole shortlist in a single call', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate_of": null}'));

    await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line',
      existing: [
        existingCandidate(1, 'always cite the source line for each number'),
        existingCandidate(2, 'always cite the source line in the summary'),
      ],
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('tells a candidate and a rule that share an id apart', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate_of": 2}'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line',
      existing: [
        { kind: 'candidate', id: 7, ruleText: 'greet the customer by first name' },
        { kind: 'learning', id: 7, ruleText: 'never quote a number without a range' },
      ],
    });

    expect(verdict).toMatchObject({ duplicate: true, matched: { kind: 'learning', id: 7 } });
  });

  it('treats the rule as new when the judge answers null', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate_of": null, "reason": "narrower situation"}'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({ duplicate: false });
  });

  it('treats the rule as new when the judge names a line it was not shown', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate_of": 999}'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({ duplicate: false });
  });

  it('treats the rule as new when the judge returns prose', async () => {
    invokeMock.mockResolvedValue(judgeReplies('These look like the same rule to me.'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({ duplicate: false });
  });

  it('treats the rule as new when the judge returns the wrong shape', async () => {
    invokeMock.mockResolvedValue(judgeReplies('{"duplicate": true}'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({ duplicate: false });
  });

  it('treats the rule as new when the model call fails outright', async () => {
    invokeMock.mockRejectedValue(new Error('429 rate limited'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toEqual({ duplicate: false });
  });

  it('reads a fenced JSON reply', async () => {
    invokeMock.mockResolvedValue(judgeReplies('```json\n{"duplicate_of": 1, "reason": "same"}\n```'));

    const verdict = await findDuplicateRule({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      existing: [existingCandidate(7, 'always cite the source line for each number')],
    });

    expect(verdict).toMatchObject({ duplicate: true });
  });
});
