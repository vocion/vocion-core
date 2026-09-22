import { describe, expect, it, vi } from 'vitest';
import { correctionNote, detectCorrection, reflectOnCorrection } from './correctionReflector';

vi.mock('@/services/feedback/ruleRecorder', () => ({
  recordProposedRule: vi.fn(async () => ({ outcome: 'created', candidateId: 9 })),
}));

const { recordProposedRule } = await import('@/services/feedback/ruleRecorder');

describe('detectCorrection', () => {
  const prev = 'Room\'s built. One gap: no Zoom recording exists for the Sept 16 call (title lookup came back empty), so I relied on the Granola notes.';

  it('sees an absence claim answered by the thing itself', () => {
    const c = detectCorrection(prev, 'here\'s Sammy\'s zoom call, do you have the transcript? https://zoom.example/rec/abc');

    expect(c?.claim).toContain('no Zoom recording exists');
    expect(c?.supplied).toContain('https://zoom.example/rec/abc');
  });

  it('stays quiet when nothing was denied, or nothing was supplied', () => {
    expect(detectCorrection('Filed the transcript into the room.', 'here is the link https://x.example')).toBeNull();
    expect(detectCorrection(prev, 'ok thanks, draft the proposal')).toBeNull();
    expect(detectCorrection(undefined, 'https://x.example')).toBeNull();
  });

  it('writes the note the agent reads under the message', () => {
    const note = correctionNote({ claim: 'no Zoom recording exists', supplied: 'https://x' });

    expect(note).toContain('Last turn you said: "no Zoom recording exists"');
    expect(note).toContain('do not file another');
  });
});

describe('reflectOnCorrection', () => {
  it('files the drafted rule as a correcting candidate with the correction as its note', async () => {
    const res = await reflectOnCorrection({
      orgId: 'org_1',
      agentSlug: 'revenue-director',
      userId: 'usr_1',
      correction: { claim: 'no Zoom recording exists', supplied: 'https://x' },
      draft: async () => ({ rule: 'Before saying a call was not recorded, list Zoom recordings around its date.', gap: 'No lookup by date or topic.' }),
    });

    expect(res.filed).toBe(true);
    expect(vi.mocked(recordProposedRule).mock.calls[0]![0]).toMatchObject({
      orgId: 'org_1',
      polarity: 'correct',
      ruleText: 'Before saying a call was not recorded, list Zoom recordings around its date.',
      agentSlug: 'revenue-director',
      submittedBy: 'usr_1',
    });
    expect(vi.mocked(recordProposedRule).mock.calls[0]![0].note).toContain('Tooling gap: No lookup by date or topic.');
  });

  it('files nothing when no rule could be drafted', async () => {
    const res = await reflectOnCorrection({ orgId: 'org_1', correction: { claim: 'x', supplied: 'y' }, draft: async () => null });

    expect(res).toEqual({ filed: false, reason: 'no rule drafted' });
  });
});
