import { describe, expect, it } from 'vitest';
import { agentSkillsNameError, isAgentSkillsName, toAgentSkillsName, withSpecCompliantName } from './name';

/**
 * Vocion's SKILL.md has two identity fields (`slug` + a human `name`); the
 * Agent Skills specification has one (`name`, which must be a slug matching
 * the folder). Every mounted skill therefore logged
 * "does not follow Agent Skills specification" on every turn.
 *
 * The fix is split: `workspace:check` validates the SLUG against the spec
 * (loud, once, at apply time) and the mount hands deepagents frontmatter whose
 * `name` is that slug, keeping the human label as `title`.
 */
describe('agentSkillsNameError', () => {
  it.each([
    ['pipeline-health', null],
    ['queue-health-report', null],
    ['a', null],
    ['café-notes', null],
  ])('accepts %j', (name, expected) => {
    expect(agentSkillsNameError(name)).toBe(expected);
  });

  it.each([
    ['', /empty/],
    ['Pipeline Health', /not a lowercase letter/],
    ['pipeline_health', /not a lowercase letter/],
    ['-pipeline', /starts or ends with a hyphen/],
    ['pipeline-', /starts or ends with a hyphen/],
    ['pipeline--health', /doubled hyphen/],
    ['a'.repeat(65), /the limit is 64/],
  ])('rejects %j', (name, reason) => {
    expect(agentSkillsNameError(name)).toMatch(reason);
    expect(isAgentSkillsName(name)).toBe(false);
  });
});

describe('toAgentSkillsName', () => {
  it.each([
    ['Pipeline Health', 'pipeline-health'],
    ['Daily Revenue Brief — format + rules', 'daily-revenue-brief-format-rules'],
    ['pipeline_health', 'pipeline-health'],
    ['???', 'skill'],
  ])('slugifies %j to %j', (raw, expected) => {
    expect(toAgentSkillsName(raw)).toBe(expected);
  });
});

describe('withSpecCompliantName', () => {
  const body = [
    '---',
    'slug: pipeline-health',
    'name: Pipeline Health',
    'description: >-',
    '  Summarize the open pipeline.',
    'version: 1',
    '---',
    '',
    '# Pipeline health',
    '',
    'Body stays exactly as written.',
  ].join('\n');

  it('replaces the human name with the slug and keeps the label as a title', () => {
    const out = withSpecCompliantName(body, 'pipeline-health');

    expect(out).toContain('name: pipeline-health');
    expect(out).toContain('title: Pipeline Health');
    expect(isAgentSkillsName('pipeline-health')).toBe(true);
  });

  it('leaves the markdown body byte-for-byte alone', () => {
    const out = withSpecCompliantName(body, 'pipeline-health');

    expect(out.split('---\n').pop()).toBe(body.split('---\n').pop());
    expect(out).toContain('Body stays exactly as written.');
    expect(out).toContain('description: >-');
  });

  it('is a no-op when the name is already the slug', () => {
    const already = '---\nslug: x\nname: x\n---\n\nbody';

    expect(withSpecCompliantName(already, 'x')).toBe(already);
  });

  it('adds a name when the file has none', () => {
    const out = withSpecCompliantName('---\nslug: brand-voice\n---\n\nbody', 'brand-voice');

    expect(out).toContain('name: brand-voice');
    expect(out).toContain('body');
  });

  it('returns a file with no frontmatter untouched', () => {
    expect(withSpecCompliantName('# just markdown', 'x')).toBe('# just markdown');
  });
});
