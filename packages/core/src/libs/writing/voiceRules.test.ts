import type { VoiceRules } from './voiceRules';
import { describe, expect, it } from 'vitest';
import {
  countAsks,
  countWords,
  describeViolations,
  lintCopy,
  lintSends,
  mergeVoiceRules,
  outboundCopy,
  phraseToRegex,
  PLATFORM_DEFAULT_VOICE_RULES,
} from './voiceRules';

/**
 * The send that started this. Fixture-ised: no real prospect, company, product
 * or claim survives, only the SHAPE of the complaint — a register
 * announcement in the opener, a "Curious about…" pivot, and a "No pitch, just
 * curious" sign-off.
 */
const OFFENDING_SEND = [
  'Quick one on the AI/data-science build.',
  'Saw you grabbed the eBook.',
  'Curious about something on the technical side.',
  'When you roll out X, is that built in-house or with partners?',
  'No pitch, just curious how that works day to day.',
].join(' ');

/**
 * What a workspace adds on top of the floor — the same shape a real
 * `voice.yaml` authors, trimmed to what these tests need.
 */
const WORKSPACE_RULES: VoiceRules = {
  never: [
    { id: 'quick-one', pattern: 'Quick one', reason: 'Register announcement. Nothing is made shorter by calling it quick.' },
    { id: 'saw-you-grabbed', pattern: /\bsaw you (grabbed|downloaded|picked up)\b/, reason: 'Names the tracked behaviour back at the reader.' },
  ],
  maxWordsPerSend: 120,
  maxAsksPerSend: 1,
  noExclamation: true,
};

const RULES = mergeVoiceRules(PLATFORM_DEFAULT_VOICE_RULES, WORKSPACE_RULES);

/**
 * Sends in the shape a calibration set has: name, one specific fact, one move
 * or none, minimal close. Fixture-ised — no real recipient, company or detail
 * appears in this repo — but structurally identical to the real ones, which
 * is what the rules have to leave alone. Between them they cover the three
 * things most likely to trip a false positive: an ask ending in a question
 * mark, an open door with no ask, and a send carrying both an em-dash and a
 * typographic apostrophe.
 */
const CALIBRATION = [
  'Riley, enjoyed your session yesterday. A lot of what you covered on platform consolidation lines up with what we\'re working through, and I\'d like to go deeper. Do you have 30 minutes in the next couple of weeks?',
  'Morgan, good to meet you yesterday. If anything comes up on the data side where I can help, reach out anytime.',
  'Alex, good to meet you yesterday \u2014 enjoyed the hiking talk. Three dogs keeps it lively. Let\u2019s stay in touch.',
];

describe('lintCopy — the offending send', () => {
  const result = lintCopy(OFFENDING_SEND, RULES);

  it('rejects it', () => {
    expect(result.ok).toBe(false);
  });

  it.each([
    ['Quick one', 'quick-one'],
    ['Curious about', 'curious-about'],
    ['No pitch', 'no-pitch'],
    ['just curious', 'just-curious'],
  ])('flags %s', (span) => {
    const spans = result.violations.map(v => v.span.toLowerCase());

    expect(spans.some(s => s.includes(span.toLowerCase().split(' ')[0]!))).toBe(true);
  });

  it('names every offending span and its reason', () => {
    const report = describeViolations(result.violations);

    expect(report).toContain('Quick one');
    expect(report).toContain('Curious about');
    expect(report).toContain('No pitch');
    expect(report).toContain('is banned —');
  });

  it('reports the offset of each span', () => {
    for (const v of result.violations) {
      if (v.index >= 0) {
        expect(OFFENDING_SEND.slice(v.index, v.index + v.span.length)).toBe(v.span);
      }
    }
  });

  it('catches the tells on the platform floor alone, with no workspace rules', () => {
    const floorOnly = lintCopy(OFFENDING_SEND, PLATFORM_DEFAULT_VOICE_RULES);

    expect(floorOnly.ok).toBe(false);

    const report = describeViolations(floorOnly.violations);

    expect(report).toContain('Curious about');
    expect(report).toContain('No pitch');
  });
});

describe('lintCopy — the calibration set passes', () => {
  it.each(CALIBRATION)('accepts %s', (text) => {
    expect(lintCopy(text, RULES)).toEqual({ ok: true, violations: [] });
  });

  it('accepts them on the floor alone too', () => {
    for (const text of CALIBRATION) {
      expect(lintCopy(text, PLATFORM_DEFAULT_VOICE_RULES).ok).toBe(true);
    }
  });
});

describe('matching', () => {
  const rules: VoiceRules = { never: [{ pattern: 'just curious', reason: 'r' }] };

  it('is case-insensitive', () => {
    expect(lintCopy('Just Curious what you use.', rules).ok).toBe(false);
  });

  it('is word-boundary aware', () => {
    expect(lintCopy('We adjust curiousness metrics.', rules).ok).toBe(true);
  });

  it('tolerates a line wrap inside the phrase', () => {
    expect(lintCopy('just\n  curious', rules).ok).toBe(false);
  });

  it('matches either apostrophe', () => {
    const apos: VoiceRules = { never: [{ pattern: 'I\'d love to', reason: 'r' }] };

    expect(lintCopy('I’d love to hear more.', apos).ok).toBe(false);
    expect(lintCopy('I\'d love to hear more.', apos).ok).toBe(false);
  });

  it('reports a repeated phrase once', () => {
    const { violations } = lintCopy('just curious, and still just curious', rules);

    expect(violations).toHaveLength(1);
  });

  it('accepts an authored RegExp', () => {
    const re: VoiceRules = { never: [{ pattern: /\bsynerg\w+/, reason: 'r' }] };

    expect(lintCopy('Real synergies here.', re).ok).toBe(false);
  });

  it('escapes regex metacharacters in a literal phrase', () => {
    expect(phraseToRegex('thoughts?').test('Thoughts?')).toBe(true);
    expect(phraseToRegex('thoughts?').test('thought')).toBe(false);
  });
});

describe('whole-text rules', () => {
  it('flags exclamation points when the workspace bans them', () => {
    expect(lintCopy('Good to meet you!', RULES).ok).toBe(false);
  });

  it('flags emoji on the platform floor', () => {
    expect(lintCopy('Good to meet you \u{1F44B}', PLATFORM_DEFAULT_VOICE_RULES).ok).toBe(false);
  });

  it('does NOT ban em-dashes on the floor — real founder notes use them', () => {
    expect(lintCopy('Alex, good to meet you — enjoyed the talk.', PLATFORM_DEFAULT_VOICE_RULES).ok).toBe(true);
  });

  it('flags a send over the word ceiling', () => {
    const long = `${'word '.repeat(130)}.`;
    const { violations } = lintCopy(long, RULES);

    expect(violations.some(v => v.kind === 'max-words')).toBe(true);
  });

  it('flags a second ask', () => {
    const { violations } = lintCopy('Is that in-house? Do you have 30 minutes?', RULES);

    expect(violations.some(v => v.kind === 'max-asks')).toBe(true);
  });

  it('counts words and asks', () => {
    expect(countWords('one two  three')).toBe(3);
    expect(countAsks('a? b? c.')).toBe(2);
  });
});

describe('prefer rules are advisory', () => {
  const rules: VoiceRules = {
    never: [],
    prefer: [{ pattern: 'utilize', use: 'use', reason: 'Plain words.' }],
  };

  it('reports without blocking', () => {
    const { ok, violations } = lintCopy('We utilize that.', rules);

    expect(ok).toBe(true);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.blocking).toBe(false);
    expect(violations[0]!.reason).toContain('Write "use" instead.');
  });

  it('is left out of the retry report', () => {
    expect(describeViolations(lintCopy('We utilize that.', rules).violations)).toBe('');
  });
});

describe('mergeVoiceRules', () => {
  it('keeps the floor and adds the workspace list', () => {
    expect(RULES.never.length).toBe(PLATFORM_DEFAULT_VOICE_RULES.never.length + 2);
  });

  it('takes the stricter numeric ceiling', () => {
    const merged = mergeVoiceRules(
      { never: [], maxWordsPerSend: 200 },
      { never: [], maxWordsPerSend: 120 },
    );

    expect(merged.maxWordsPerSend).toBe(120);
  });

  it('ORs the booleans', () => {
    expect(RULES.noEmoji).toBe(true);
    expect(RULES.noExclamation).toBe(true);
  });

  it('lets a workspace opt out of a named floor rule, and only that one', () => {
    const merged = mergeVoiceRules(PLATFORM_DEFAULT_VOICE_RULES, { never: [], allow: ['leverage'] });

    expect(lintCopy('We leverage that.', merged).ok).toBe(true);
    expect(lintCopy('No pitch here.', merged).ok).toBe(false);
  });

  it('returns the floor untouched when a workspace has authored nothing', () => {
    expect(mergeVoiceRules(PLATFORM_DEFAULT_VOICE_RULES, null)).toBe(PLATFORM_DEFAULT_VOICE_RULES);
  });
});

describe('outboundCopy — the zod gate', () => {
  const schema = outboundCopy(RULES, 'body of send 1');

  it('rejects banned copy as a zod issue that names the phrase and the reason', () => {
    const parsed = schema.safeParse(OFFENDING_SEND);

    expect(parsed.success).toBe(false);

    const messages = parsed.error!.issues.map(i => i.message);

    expect(messages.some(m => m.includes('body of send 1: "Curious about" is banned'))).toBe(true);
    expect(messages.some(m => m.includes('Ask the question'))).toBe(true);
  });

  it('passes clean copy through unchanged', () => {
    expect(schema.parse(CALIBRATION[1]!)).toBe(CALIBRATION[1]);
  });

  it('does not raise an issue for a prefer hit', () => {
    const soft = outboundCopy({ never: [], prefer: [{ pattern: 'utilize', use: 'use' }] });

    expect(soft.safeParse('We utilize that.').success).toBe(true);
  });
});

describe('lintSends — the proposal-level gate', () => {
  it('names the field and the send number', () => {
    const { ok, report, count } = lintSends(
      [
        { step: 1, subject: 'Quick question', body: CALIBRATION[1]! },
        { step: 2, subject: 'Following up', body: OFFENDING_SEND },
      ],
      RULES,
    );

    expect(ok).toBe(false);
    expect(count).toBeGreaterThan(1);
    expect(report).toContain('subject of send 1: "Quick question" is banned');
    expect(report).toContain('body of send 2:');
  });

  it('passes a clean set', () => {
    expect(lintSends([{ step: 1, subject: 'Yesterday', body: CALIBRATION[0]! }], RULES).ok).toBe(true);
  });

  it('ignores empty fields rather than inventing a violation', () => {
    expect(lintSends([{ step: 1, subject: '', body: '' }], RULES).ok).toBe(true);
  });
});

describe('the platform floor is documented', () => {
  it('gives every default rule a stable id and a reason', () => {
    for (const rule of PLATFORM_DEFAULT_VOICE_RULES.never) {
      expect(rule.id, String(rule.pattern)).toBeTruthy();
      expect(rule.reason.length, String(rule.pattern)).toBeGreaterThan(10);
    }
  });

  it('uses unique ids', () => {
    const ids = PLATFORM_DEFAULT_VOICE_RULES.never.map(r => r.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves taste to the workspace — no exclamation or em-dash ban on the floor', () => {
    expect(PLATFORM_DEFAULT_VOICE_RULES.noExclamation).toBeUndefined();
    expect(PLATFORM_DEFAULT_VOICE_RULES.noEmDash).toBeUndefined();
    expect(PLATFORM_DEFAULT_VOICE_RULES.maxWordsPerSend).toBeUndefined();
  });
});

describe('one line per thing to fix', () => {
  it('reports a span once even when two rules catch it, with the later rule\'s reason', () => {
    const merged = mergeVoiceRules(
      { never: [{ id: 'floor', pattern: 'no pitch', reason: 'Floor reason.' }] },
      { never: [{ id: 'ws', pattern: /no\s+pitch/, reason: 'Workspace reason.' }] },
    );
    const { violations } = lintCopy('No pitch here.', merged);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toBe('Workspace reason.');
  });

  it('orders violations by where they appear, not by rule order', () => {
    const indexes = lintCopy(OFFENDING_SEND, RULES).violations.filter(v => v.kind === 'never').map(v => v.index);

    expect(indexes.length).toBeGreaterThan(1);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});
