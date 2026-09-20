/**
 * The mission / playbook source descriptor: what a file is allowed to say
 * before it is written, and the shape its mirror takes.
 */
import { describe, expect, it } from 'vitest';
import { sourceArtifactKind, sourceContentOf, sourceKindOf, sourceRecord, sourceRelPath, sourceSpec, SourceValidationError, splitFrontmatter, validateSourceText } from './source';

const MISSION = 'slug: keep-main-releasable\nname: Keep main releasable\ngoal: Every merge to main ships.\nagent: release-lead\n';
const SKILL = '---\nslug: house-style\nname: House style\ndescription: How we write.\n---\n\n# House style\n\nShort sentences.\n';

describe('validateSourceText', () => {
  it('accepts a mission through the real schema and reads its title', () => {
    const v = validateSourceText('mission', 'keep-main-releasable', MISSION);

    expect(v.title).toBe('Keep main releasable');
    expect(v.manifest.agent).toBe('release-lead');
    expect(v.body).toBeNull();
  });

  it('refuses a mission whose slug disagrees with the file it is written as', () => {
    expect(() => validateSourceText('mission', 'other-slug', MISSION)).toThrow(/slug "keep-main-releasable".*other-slug/);
  });

  it('refuses YAML that is not a mission, naming the field', () => {
    expect(() => validateSourceText('mission', 'x', 'slug: x\nname: X\n')).toThrow(SourceValidationError);
    expect(() => validateSourceText('mission', 'x', 'slug: x\nname: X\n')).toThrow(/goal/);
    expect(() => validateSourceText('mission', 'x', 'slug: [unclosed')).toThrow(/not valid YAML/);
    expect(() => validateSourceText('mission', 'x', '- a list\n')).toThrow(/YAML mapping/);
  });

  it('lets an `extends: core` patch carry only the fields it changes', () => {
    const v = validateSourceText('mission', 'keep-main-releasable', 'extends: core\nslug: keep-main-releasable\ngoal: A tighter goal.\n');

    expect(v.manifest.goal).toBe('A tighter goal.');
    // No `name:` in the patch, so the slug stands in for the title.
    expect(v.title).toBe('keep-main-releasable');
  });

  it('accepts a SKILL.md and separates frontmatter from body', () => {
    const v = validateSourceText('playbook', 'house-style', SKILL);

    expect(v.title).toBe('House style');
    expect(v.description).toBe('How we write.');
    expect(v.body).toMatch(/^# House style/);
  });

  it('refuses a SKILL.md with no frontmatter, a bad slug, or a mismatched slug', () => {
    expect(() => validateSourceText('playbook', 'house-style', '# Just a heading\n')).toThrow(/frontmatter/);
    expect(() => validateSourceText('skill', 'Bad Slug', SKILL)).toThrow(/not a valid slug/);
    expect(() => validateSourceText('playbook', 'another', SKILL)).toThrow(/frontmatter says slug "house-style"/);
    expect(() => validateSourceText('playbook', 'house-style', '')).toThrow(/empty/);
  });
});

describe('the mirror shape', () => {
  it('names the file the loader reads', () => {
    expect(sourceRelPath('mission', 'keep_main')).toBe('missions/keep-main.yaml');
    expect(sourceRelPath('playbook', 'house-style')).toBe('playbooks/house-style/SKILL.md');
    expect(sourceRelPath('skill', 'triage')).toBe('skills/triage/SKILL.md');
  });

  it('mirrors a skill as a playbook artifact and says which folder in the spec', () => {
    expect(sourceArtifactKind('skill')).toBe('playbook');
    expect(sourceSpec('skill', 'triage', SKILL)).toEqual({ slug: 'triage', kind: 'skill', md: SKILL });
    expect(sourceSpec('mission', 'm', MISSION)).toEqual({ slug: 'm', yaml: MISSION });
    expect(sourceRecord('skill', 'triage')).toEqual({ type: 'playbook', id: 'triage', role: 'source' });
    expect(sourceRecord('mission', 'm')).toEqual({ type: 'mission', id: 'm', role: 'source' });
  });

  it('reads the kind and the text back off a spec', () => {
    expect(sourceKindOf('mission', { yaml: MISSION })).toBe('mission');
    expect(sourceKindOf('playbook', { kind: 'skill', md: SKILL })).toBe('skill');
    expect(sourceKindOf('playbook', { md: SKILL })).toBe('playbook');
    expect(sourceKindOf('markdown', { md: 'x' })).toBeNull();
    expect(sourceContentOf({ yaml: MISSION })).toBe(MISSION);
    expect(sourceContentOf({ md: SKILL })).toBe(SKILL);
    expect(sourceContentOf({ html: '<p/>' })).toBeNull();
  });

  it('splits frontmatter tolerant of CRLF and reports bad YAML plainly', () => {
    expect(splitFrontmatter('---\r\nslug: a\r\n---\r\nbody').data).toEqual({ slug: 'a' });
    expect(() => splitFrontmatter('---\nslug: [\n---\n')).toThrow(/not valid YAML/);
  });
});
