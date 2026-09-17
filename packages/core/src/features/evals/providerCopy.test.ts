/**
 * What the grader badge tells a person.
 *
 * The bug this guards against is an empty or silent badge: a score whose
 * grader we cannot name still has to say something, because "AgentCore said
 * 70%" and "our judge said 90%" are the whole reason both numbers are on the
 * page.
 */
import { describe, expect, it } from 'vitest';
import { describeProvider } from './providerCopy';

describe('describeProvider', () => {
  it('says where the judging happens and who is billed', () => {
    // The two facts people ask about the first time they see the label.
    expect(describeProvider('agentcore').explanation).toContain('AWS');
    expect(describeProvider('agentcore').explanation).toContain('bills your own account');
    // The cases leave Vocion too, not only the transcript — someone deciding
    // whether to put customer wording in an eval needs that said up front.
    expect(describeProvider('agentcore').explanation).toContain('copied into AgentCore');
    expect(describeProvider('vocion').explanation).toContain('Nothing leaves Vocion');
  });

  it('still names a grader it has never heard of', () => {
    const copy = describeProvider('azure-foundry');

    expect(copy.label).toBe('azure-foundry');
    expect(copy.explanation).toContain('azure-foundry');
  });
});
