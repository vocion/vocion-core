import type { DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it } from 'vitest';
import { stepForConnector, withoutConnectParams } from './useAnswerOnConnectReturn';

const setup = (id: number, optionIds: string[]): DecisionView => ({ id, kind: 'setup', question: 'Connect', options: optionIds.map(o => ({ id: o, label: o })), allowOther: true, multiple: false, state: 'open', agentSlug: null, ownerUserId: null, conversationId: 7 });

describe('a connect coming back', () => {
  it('finds the setup step that opened this connector\'s login or token form', () => {
    const decisions = [setup(1, ['connect:jira']), setup(2, ['connect:github', 'paste:github'])];

    expect(stepForConnector(decisions, 'github')).toEqual({ view: decisions[1], optionId: 'connect:github' });
    expect(stepForConnector([setup(3, ['paste:notion'])], 'notion')).toEqual({ view: expect.objectContaining({ id: 3 }), optionId: 'paste:notion' });
    expect(stepForConnector(decisions, 'slack')).toBeNull();
  });

  it('keeps everything in the URL but the connect outcome', () => {
    expect(withoutConnectParams('?conversation=7&connect=ok&connector=github&source=github')).toBe('?conversation=7');
    expect(withoutConnectParams('?connect=error&reason=access_denied')).toBe('');
  });
});
