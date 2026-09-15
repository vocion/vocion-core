import { describe, expect, it } from 'vitest';
import { firstParagraph, isNearDuplicate, sentenceCase, splitBody, verbosityHints } from './askText';

const LONG_BODY = 'The Slack surface needs an identity model before #253 can ship. The company recommends one app per Slack-workspace × Vocion-project, with per-agent identity via chat:write.customize. A dedicated app would only be needed when an agent must be addressable directly. This has been open since cycle 52 and blocks the manifest reinstall in 035.\n\nSee the approval file for the trade-offs and the three alternatives the board considered.';

describe('splitBody', () => {
  it('shows the first two sentences and keeps the rest for Details', () => {
    const { lead, rest } = splitBody(LONG_BODY);

    expect(lead).toBe('The Slack surface needs an identity model before #253 can ship. The company recommends one app per Slack-workspace × Vocion-project, with per-agent identity via chat:write.customize.');
    expect(rest).toMatch(/^A dedicated app/);
    expect(rest).toMatch(/three alternatives/);
  });

  it('cuts a single run-on sentence at a word inside ~240 chars, with an ellipsis', () => {
    const body = 'word '.repeat(120).trim();
    const { lead, rest } = splitBody(body);

    expect(lead.length).toBeLessThanOrEqual(241);
    expect(lead.endsWith('…')).toBe(true);
    expect(rest).not.toBeNull();
  });

  it('leaves a short body whole', () => {
    expect(splitBody('Squash-merge #33. Five of five red-team publish.')).toEqual({ lead: 'Squash-merge #33. Five of five red-team publish.', rest: null });
    expect(splitBody(null)).toEqual({ lead: '', rest: null });
    expect(splitBody('One line, no period')).toEqual({ lead: 'One line, no period', rest: null });
  });

  it('treats a blank line as a sentence end', () => {
    const { lead, rest } = splitBody('First paragraph without a period\n\nSecond paragraph. Third sentence.');

    expect(lead).toBe('First paragraph without a period\n\nSecond paragraph.');
    expect(rest).toBe('Third sentence.');
  });
});

describe('isNearDuplicate', () => {
  const paragraph = firstParagraph(LONG_BODY);

  it('hides an option description that repeats the body (prefix, contained, or lightly reworded)', () => {
    expect(isNearDuplicate('The Slack surface needs an identity model before #253 can ship.', paragraph)).toBe(true);
    expect(isNearDuplicate('The company recommends one app per Slack-workspace × Vocion-project, with per-agent identity via chat:write.customize.', paragraph)).toBe(true);
    expect(isNearDuplicate('the slack surface needs an identity model before 253 can ship — the company recommends one app per workspace', paragraph)).toBe(true);
  });

  it('keeps a description that says something the body does not', () => {
    expect(isNearDuplicate('Per-agent identity via chat:write.customize; a dedicated app only when an agent must be addressable.', paragraph)).toBe(false);
    expect(isNearDuplicate('Each agent is its own Slack app and bot user.', paragraph)).toBe(false);
    expect(isNearDuplicate('', paragraph)).toBe(false);
    expect(isNearDuplicate('Yes', null)).toBe(false);
  });
});

describe('sentenceCase + verbosityHints', () => {
  it('capitalises only the first letter', () => {
    expect(sentenceCase('one Slack app per WORKSPACE, or one per agent?')).toBe('One Slack app per WORKSPACE, or one per agent?');
    expect(sentenceCase('  ')).toBe('');
  });

  it('hints on a long title or body, and stays quiet otherwise', () => {
    expect(verbosityHints({ title: 'Merge #33', body: 'Short.' })).toEqual([]);
    expect(verbosityHints({ title: 'x'.repeat(81), body: 'y'.repeat(401) })).toEqual([
      'title is 81 chars (aim for ≤ 80)',
      'body is 401 chars (aim for ≤ 400; put the long form in contextMd)',
    ]);
  });
});
