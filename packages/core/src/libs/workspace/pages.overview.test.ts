import { describe, expect, it } from 'vitest';
import { PageManifestSchema } from './pages';

// The `overview` archetype's manifest. Schema only; what the panels COMPUTE
// is services/factory/overview.test.ts. No shipped plugin uses the archetype
// since the Factory page went on 2026-09-24.

const base = { slug: 'factory', title: 'Factory', archetype: 'overview' };
const panel = { kind: 'needsYou', title: 'Needs you' };

describe('the overview archetype', () => {
  it('is accepted with panels, and refused without them', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [panel] }).success).toBe(true);
    expect(PageManifestSchema.safeParse(base).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, panels: [] }).success).toBe(false);
  });

  it('says what an overview page is missing, rather than failing silently', () => {
    const result = PageManifestSchema.safeParse(base);

    expect(result.error?.issues.map(i => i.message)).toContain('an overview page needs panels - the ordered list it computes');
  });

  it('refuses panels on any other archetype, so a list page cannot half-become one', () => {
    const result = PageManifestSchema.safeParse({ slug: 'backlog', title: 'Backlog', archetype: 'list', panels: [panel] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(i => i.message)).toContain('panels belong to the overview archetype');
  });

  it('refuses a panel kind it does not implement, rather than drawing nothing', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'revenue', title: 'Revenue' }] }).success).toBe(false);
  });

  it('takes no rows, so it takes no live interval', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [panel], live: { every: 15 } }).success).toBe(false);
  });

  it('caps a status panel at four facts - a row a person reads in one glance', () => {
    const facts = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'field', label: `f${i}`, from: 'meta.x' }));

    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'status', title: 'S', objectType: 'product', facts: facts(4) }] }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'status', title: 'S', objectType: 'product', facts: facts(5) }] }).success).toBe(false);
  });

  it('defaults the lists a person reads first to three, and the digest to a 24 hour fallback', () => {
    const parsed = PageManifestSchema.parse({
      ...base,
      panels: [
        { kind: 'active', title: 'Now', objectType: 'request', statusIn: ['active'] },
        { kind: 'digest', title: 'Since' },
        { kind: 'next', title: 'Next', objectType: 'request' },
      ],
    });
    const [active, digest, next] = parsed.panels!;

    expect(active).toMatchObject({ kind: 'active', limit: 7 });
    expect(digest).toMatchObject({ kind: 'digest', fallbackHours: 24 });
    // Three, not seven: Next answers what the factory intends to spend effort
    // on, which is a short answer. A ranked backlog is a different page.
    expect(next).toMatchObject({ kind: 'next', limit: 3, orderBy: 'meta.priority', noteFields: ['whyNote'] });
  });
});
