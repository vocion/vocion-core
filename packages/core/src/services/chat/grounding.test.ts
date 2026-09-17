/**
 * The P0 the CEO opened with: the chat said "there's no brief or proposal to
 * review here" beside a page rendering a brief, and asserted engagement facts
 * on a brief that marked those fields unavailable
 * (`docs/specs/personalization-v2.md`).
 *
 * These tests are the proof that a turn from that page CANNOT be answered
 * without the brief, the recommendation and the sequence in front of the
 * model, and that "unavailable" travels as unavailable.
 */
import { describe, expect, it } from 'vitest';
import { artifactText, describeGrounding, GROUNDING_RULE } from './grounding';
import { readPageContext, withPageContext } from './pageContext';

const BRIEF = {
  id: 11,
  title: 'Dana Reyes — research brief',
  kind: 'markdown',
  version: 3,
  role: 'brief',
  text: '# Dana Reyes — research brief\n\n## What we know\n\nDirector of Operations at Kestrel Capital.\n\n## What we couldn\'t verify\n\n- Engagement fields were unavailable; nothing can be inferred from them.',
  truncated: false,
};

const RECOMMENDATION = {
  id: 12,
  title: 'Dana Reyes — outreach recommendation',
  kind: 'markdown',
  version: 1,
  role: 'recommendation',
  text: '## What\n\nEnroll in **Personalized Nurture** · 4 sends.',
  truncated: false,
};

const SEQUENCE = {
  id: 13,
  title: 'Dana Reyes — Personalized Nurture',
  kind: 'sequence',
  version: 2,
  role: 'sequence',
  text: 'Sequence: Personalized Nurture\n4 sends\n\nSend 1 · Day 0\nSubject: A question\nHow are you handling reporting today?',
  truncated: false,
};

describe('artifactText', () => {
  it('flattens a typed sequence so a send has a referent the person can name', () => {
    const text = artifactText({
      kind: 'sequence',
      title: 'Draft',
      spec: {
        sequenceName: 'Personalized Nurture',
        rationale: 'Curiosity, not fabricated personalization.',
        sends: [
          { step: 1, day: 0, subject: 'A question', body: 'One line.' },
          { step: 2, day: 4, subject: 'Following up', body: 'Another.' },
        ],
      },
    });

    expect(text).toContain('Sequence: Personalized Nurture');
    expect(text).toContain('Send 2 · Day 4');
    expect(text).toContain('Subject: Following up');
  });

  it('a markdown artifact travels as its markdown, not as JSON', () => {
    expect(artifactText({ kind: 'markdown', title: 'B', spec: { md: '# Hello' } })).toBe('# Hello');
  });
});

describe('describeGrounding', () => {
  const block = describeGrounding([BRIEF, RECOMMENDATION, SEQUENCE], [
    { label: 'Tab', value: 'Brief' },
    { label: 'Decision', value: 'waiting' },
  ])!;

  it('puts the artifacts\' actual content in the turn, so "there is no brief here" is contradicted by the turn itself', () => {
    expect(block).toContain('Dana Reyes — research brief');
    expect(block).toContain('Director of Operations at Kestrel Capital.');
    expect(block).toContain('Enroll in **Personalized Nurture**');
    expect(block).toContain('Send 1 · Day 0');
  });

  it('names the four epistemic classes, and says that unavailable is not zero', () => {
    expect(block).toContain('CRM fact');
    expect(block).toContain('Research finding');
    expect(block).toContain('Inference');
    expect(block).toContain('UNAVAILABLE IS NOT ZERO AND NOT A FINDING');
    expect(block).toContain('may not say the contact has not engaged');
  });

  it('forbids the exact sentence the chat produced', () => {
    expect(GROUNDING_RULE).toContain('Never say there is no brief, no recommendation or no proposal here when one is attached');
  });

  it('carries the version, so the answer is about what is on screen', () => {
    expect(block).toContain('artifact 11, v3');
    expect(block).toContain('artifact 13, v2');
  });

  it('carries the user-visible state', () => {
    expect(block).toContain('Tab: Brief · Decision: waiting');
  });

  it('attaches nothing when the page is showing nothing', () => {
    expect(describeGrounding([])).toBeNull();
  });
});

describe('withPageContext — the grounding rides every turn', () => {
  const ctx = readPageContext({
    path: '/gtm/lead/88301',
    title: 'Dana Reyes',
    record: { type: 'lead', id: '412', label: 'Dana Reyes' },
    artifacts: [
      { type: 'artifact', id: '11', label: 'Dana Reyes — research brief' },
      { type: 'artifact', id: '13', label: 'Dana Reyes — Personalized Nurture' },
    ],
    state: [{ label: 'Tab', value: 'Sequence' }],
  })!;

  it('reads the artifacts and the state off the wire', () => {
    expect(ctx.artifacts).toHaveLength(2);
    expect(ctx.artifacts![0]!.type).toBe('artifact');
    expect(ctx.state).toEqual([{ label: 'Tab', value: 'Sequence' }]);
  });

  it('a malformed artifact ref is dropped, never fails the turn', () => {
    const bad = readPageContext({ path: '/x', title: 'x', artifacts: [{ type: 'nope', id: '1' }, { type: 'artifact', id: '9' }] })!;

    expect(bad.artifacts).toEqual([{ type: 'artifact', id: '9' }]);
  });

  it('appends the grounding LAST, after the message and the where-I-am note', () => {
    const grounded = describeGrounding([BRIEF, SEQUENCE])!;
    const out = withPageContext('make this less salesy', ctx, [], grounded);

    expect(out.indexOf('make this less salesy')).toBe(0);
    expect(out.indexOf('--- where I am ---')).toBeGreaterThan(0);
    expect(out.indexOf('--- what the page is showing (canonical) ---')).toBeGreaterThan(out.indexOf('--- where I am ---'));
    expect(out).toContain('Engagement fields were unavailable');
  });

  it('the page state reaches the model even with no grounding block', () => {
    expect(withPageContext('what is this?', ctx)).toContain('What the page currently shows: Tab: Sequence.');
  });

  it('a turn with no page context and no grounding is left exactly as typed', () => {
    expect(withPageContext('hello', null)).toBe('hello');
  });
});
