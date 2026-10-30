import type { DecisionView } from '@/libs/decisions/decision';
import { describe, expect, it } from 'vitest';
import { connectReturnLine, openConnectSteps, stepForConnector, withoutConnectParams } from './useAnswerOnConnectReturn';

const setup = (id: number, optionIds: string[]): DecisionView => ({ id, kind: 'setup', question: 'Connect', options: optionIds.map(o => ({ id: o, label: o })), allowOther: true, multiple: false, state: 'open', agentSlug: null, ownerUserId: null, conversationId: 7 });

describe('a connect coming back', () => {
  it('finds the setup step that opened this connector\'s login or token form', () => {
    const decisions = [setup(1, ['connect:jira']), setup(2, ['connect:github', 'paste:github'])];

    expect(stepForConnector(decisions, 'github')).toEqual({ view: decisions[1], optionId: 'connect:github' });
    expect(stepForConnector([setup(3, ['paste:notion'])], 'notion')).toEqual({ view: expect.objectContaining({ id: 3 }), optionId: 'paste:notion' });
    expect(stepForConnector(decisions, 'slack')).toBeNull();
  });

  it('the coverage card\'s Install and Request options are answered by the install coming back, and never by GitHub being connected elsewhere', () => {
    const coverage = setup(4, ['install:github', 'request:github']);

    expect(stepForConnector([coverage], 'github')).toEqual({ view: coverage, optionId: 'install:github' });
    expect(openConnectSteps([coverage])).toEqual([]);
  });

  it('a request sent to an owner reads as waiting, not as failed', () => {
    expect(connectReturnLine({ ok: false, connector: 'github', reason: 'installation_requested' })).toMatch(/^Install requested: waiting for an owner/);
    expect(connectReturnLine({ ok: false, connector: 'github', reason: 'access_denied' })).toMatch(/didn't work \(access_denied\)/);
  });

  it('keeps everything in the URL but the connect outcome', () => {
    expect(withoutConnectParams('?conversation=7&connect=ok&connector=github&source=github')).toBe('?conversation=7');
    expect(withoutConnectParams('?connect=error&reason=access_denied')).toBe('');
  });
});

describe('sign-in cards that wait on a connector', () => {
  it('lists each card\'s login option and its connector, and nothing else', () => {
    const decisions = [setup(1, ['connect:github', 'paste:github']), setup(2, ['start']), setup(3, ['approve'])];

    expect(openConnectSteps(decisions)).toEqual([{ view: decisions[0], optionId: 'connect:github', connector: 'github' }]);
  });
});
