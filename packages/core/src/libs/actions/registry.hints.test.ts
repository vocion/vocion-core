import { describe, expect, it } from 'vitest';
import { actionInputHints } from './registry';

describe('the fields each action takes, for a model', () => {
  it('names the fields with * on the required ones, through refinements, for the actions cards are refused on', () => {
    const hints = actionInputHints(['objects.propose_candidate', 'git.merge', 'ask.file']);

    expect(hints).toMatch(/^objects\.propose_candidate: .*objectType\*/m);
    // Required by the refine, not the shape, until 2026-09-25 — and so unmarked, and left out (the last refusal standing on walk 17).
    expect(hints).toMatch(/objects\.propose_candidate: .*dedupOn\*=\[…\]/);
    expect(hints).toMatch(/^git\.merge: .*title\*.*summary\*.*commitSha\*/m);
    expect(hints).toMatch(/^git\.merge: .*taskId(?!\*)/m);
    expect(hints).toMatch(/^ask\.file: .*title\*/m);
    // Values too: the enum's options, a number — what the second wave of refusals was about.
    expect(hints).toMatch(/^ask\.file: .*kind\*?=approval\|input\|ruling/m);
    expect(hints).toMatch(/^ask\.file: .*decisionCost\*?=number/m);
    // An array of objects names its element's fields (walk 19's refusal: objectRefs.0.type).
    expect(hints).toMatch(/^ask\.file: .*objectRefs\*?=\[\{type\*/m);
    expect(hints).toMatch(/^git\.merge: .*riskClass\*=docs\|deps/m);
  });

  it('describes every registered action when asked for none in particular', () => {
    expect(actionInputHints().split('\n').length).toBeGreaterThan(10);
  });
});
