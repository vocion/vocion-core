import { describe, expect, it } from 'vitest';
import { decideResume, parseConversationParam } from './resumeRule';

describe('decideResume — new chat unless intentionally returning', () => {
  it('starts fresh when neither the session nor the URL names a thread', () => {
    expect(decideResume({ explicitId: null, sessionId: null })).toEqual({ resume: false, reason: 'fresh' });
  });

  it('resumes the thread this browser session was already in', () => {
    expect(decideResume({ explicitId: null, sessionId: 12 })).toEqual({ resume: true, conversationId: 12, reason: 'session' });
  });

  it('the URL wins over the session', () => {
    expect(decideResume({ explicitId: 7, sessionId: 12 })).toEqual({ resume: true, conversationId: 7, reason: 'url' });
  });

  it('ignores junk ids', () => {
    expect(decideResume({ explicitId: 0, sessionId: -3 })).toEqual({ resume: false, reason: 'fresh' });
    expect(parseConversationParam('abc')).toBeNull();
    expect(parseConversationParam('42')).toBe(42);
    expect(parseConversationParam(undefined)).toBeNull();
  });
});
