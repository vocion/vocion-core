import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { REASON_CODES } from './reasonCodes';

/**
 * The write side and the read side must name the same nine codes.
 *
 * `reasonCodes.ts` is the closed list, and the read side quietly sets aside
 * anything not on it rather than rendering it. So a tenth code added to a
 * type's enum and nowhere else would be written by an agent, accepted by the
 * record, and then be invisible on the page forever. That is the worst
 * failure available to a field whose whole value is that a person can trust
 * it, and it would never throw. This test is the seam between the two sides.
 *
 * Exercised through the REAL shipped types
 * (`templates/plugins/software-factory`), the way `records.test.ts` is.
 */

function shippedType(slug: string): { properties: Record<string, { type?: string; items?: { enum?: string[] } }> } {
  const file = join(process.cwd(), 'templates/plugins/software-factory/objects', slug, 'type.yaml');
  return (parseYaml(readFileSync(file, 'utf8')) as { schema: { properties: Record<string, { type?: string; items?: { enum?: string[] } }> } }).schema;
}

describe('the reason codes the factory writes', () => {
  it.each(['request', 'engineering_task'])('%s accepts exactly the closed list, in its order', (slug) => {
    const why = shippedType(slug).properties.why;

    expect(why?.type).toBe('array');
    expect(why?.items?.enum).toEqual([...REASON_CODES]);
  });

  it.each(['request', 'engineering_task'])('%s declares whyNote, so the codes can be grounded in evidence', (slug) => {
    expect(shippedType(slug).properties.whyNote?.type).toBe('string');
  });
});
