import { describe, expect, it } from 'vitest';
import { PlaybookManifestSchema } from './schemas';

/**
 * A SKILL.md folder is mounted as an Agent Skill, and that specification
 * validates the name against the folder. Vocion's slug IS that name, so a slug
 * the spec refuses makes the runtime log a warning on every turn of every
 * agent that mounts it. `workspace:check` refuses it once instead.
 */
const base = { name: 'Pipeline Health', description: 'Summarize the open pipeline.' };

describe('PlaybookManifestSchema — skill folder slugs', () => {
  it('keeps the human-readable `name` — it is the catalog label, not an identity', () => {
    const parsed = PlaybookManifestSchema.parse({ ...base, slug: 'pipeline-health' });

    expect(parsed.name).toBe('Pipeline Health');
    expect(parsed.slug).toBe('pipeline-health');
  });

  it.each([
    ['pipeline_health', /Agent Skills specification/],
    ['pipeline--health', /doubled hyphen/],
    ['pipeline-health-', /starts or ends with a hyphen/],
    [`a${'-b'.repeat(40)}`, /the limit is 64/],
  ])('refuses %j at apply time rather than warning at runtime', (slug, reason) => {
    const result = PlaybookManifestSchema.safeParse({ ...base, slug });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(i => i.message).join(' ')).toMatch(reason);
  });

  it('still refuses what SlugSchema always refused', () => {
    expect(PlaybookManifestSchema.safeParse({ ...base, slug: 'Pipeline-Health' }).success).toBe(false);
    expect(PlaybookManifestSchema.safeParse({ ...base, slug: '1-health' }).success).toBe(false);
  });
});
