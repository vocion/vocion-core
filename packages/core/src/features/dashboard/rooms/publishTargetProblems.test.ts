import { describe, expect, it } from 'vitest';
import { PUBLISH_TARGET_EXAMPLE, publishTargetProblems } from './publishTargetEdit';

describe('the Publishing editor says what the server would refuse (SEO walk 2)', () => {
  it('its own example holds', () => {
    expect(publishTargetProblems(PUBLISH_TARGET_EXAMPLE)).toEqual([]);
    expect(publishTargetProblems('')).toEqual([]);
  });

  it('names the field: a path with no {slug}, not JSON at all', () => {
    const wrong = '[{"id": "site", "kind": "github", "config": {"repo": "example-org/northwind-site", "branch": "main", "path": "content/"}}]';

    expect(publishTargetProblems(wrong).join(' ')).toMatch(/path .*\{slug\}/);
    expect(publishTargetProblems('[{')[0]).toMatch(/^Not JSON/);
  });
});
