import { describe, expect, it } from 'vitest';
import { autoFloor, contextFloor, INFER_SYSTEM, inferEffort, LONG_CONTEXT_CHARS, parseEffort } from './effort';
import { recentExchange } from './priorTurn';

// Chris, 2026-11-10: "try again", after a filing that had failed, ran Quick. The fast model
// got a 40-second ceiling, and its last line ("Let me try with the proper structure:") was
// posted to the Slack thread as the answer.
describe('a turn is sized by what it continues and what it sits in', () => {
  it('words that resume earlier work are never Quick', () => {
    expect(autoFloor({ drafts: false, systems: 1, resumes: true })).toEqual({ level: 'standard', reason: 'continuing earlier work' });
    expect(autoFloor({ drafts: false, systems: 1, resumes: false })).toBeNull();
    expect(parseEffort('{"level":"quick","reason":"two words","drafts":false,"systems":1,"resumes":true}')).toMatchObject({ level: 'standard', reason: 'continuing earlier work' });
    // A stronger fact about the resumed work still wins.
    expect(parseEffort('{"level":"quick","reason":"retry","drafts":false,"systems":1,"outward":true,"resumes":true}')).toMatchObject({ level: 'standard', reason: 'changing something outside the workspace' });
    expect(INFER_SYSTEM).toContain('"resumes": true | false');
  });

  it('a follow-up to a turn whose tools failed is never Quick, whatever it says', () => {
    expect(contextFloor({ level: 'quick', reason: 'short question' }, { chars: 12, priorErrors: 1 })).toMatchObject({ level: 'standard', reason: 'retrying after errors' });
    expect(contextFloor({ level: 'quick', reason: 'short question' }, { chars: 12, priorErrors: 0 })).toEqual({ level: 'quick', reason: 'short question' });
  });

  it('a long thread to read is never Quick; size raises and never lowers', () => {
    expect(contextFloor({ level: 'quick', reason: 'a lookup' }, { chars: LONG_CONTEXT_CHARS, priorErrors: 0 })).toMatchObject({ level: 'standard', reason: 'a long thread to read' });
    expect(contextFloor({ level: 'quick', reason: 'a lookup' }, { chars: LONG_CONTEXT_CHARS - 1, priorErrors: 0 })).toMatchObject({ level: 'quick' });
    expect(contextFloor({ level: 'deep', reason: 'an audit' }, { chars: 10, priorErrors: 3 })).toEqual({ level: 'deep', reason: 'an audit' });
  });

  it('the read is handed the last exchanges, who said what, so "try again" has the work beside it', async () => {
    const history = [
      { role: 'user', content: 'the recording lost the mic audio, this is a bug' },
      { role: 'assistant', content: 'Recorded as feedback.' },
      { role: 'tool', content: 'ignored' },
      { role: 'user', content: '   ' },
    ];

    expect(recentExchange(history)).toBe('Person: the recording lost the mic audio, this is a bug\nAssistant: Recorded as feedback.');
    expect(recentExchange([])).toBeUndefined();

    let seen = '';
    await inferEffort({ orgId: 'org', message: 'try again', previous: recentExchange(history)!, model: async (_system, user) => {
      seen = user;

      return { text: '{"level":"quick","reason":"retry","drafts":false,"systems":1,"resumes":true}' };
    } });

    expect(seen).toBe('Earlier in the conversation:\nPerson: the recording lost the mic audio, this is a bug\nAssistant: Recorded as feedback.\n\nRequest: try again');
  });
});
