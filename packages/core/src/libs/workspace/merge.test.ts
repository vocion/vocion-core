import { describe, expect, it } from 'vitest';
import { isArrayDirective, MergeError, mergeManifest } from './merge';

describe('merge — directive detection', () => {
  it('recognizes $append / $remove objects', () => {
    expect(isArrayDirective({ $append: ['a'] })).toBe(true);
    expect(isArrayDirective({ $remove: ['a'] })).toBe(true);
    expect(isArrayDirective({ $append: ['a'], $remove: ['b'] })).toBe(true);
  });

  it('treats plain objects, arrays, and scalars as non-directives', () => {
    expect(isArrayDirective({ model: 'x' })).toBe(false);
    expect(isArrayDirective({ $append: ['a'], other: 1 })).toBe(false); // mixed keys → plain object
    expect(isArrayDirective(['a', 'b'])).toBe(false);
    expect(isArrayDirective('core')).toBe(false);
    expect(isArrayDirective({})).toBe(false);
    expect(isArrayDirective(null)).toBe(false);
  });
});

describe('merge — scalars & objects replace', () => {
  it('replaces a scalar', () => {
    expect(mergeManifest({ model: 'a', name: 'n' }, { model: 'b' })).toEqual({ model: 'b', name: 'n' });
  });

  it('replaces an object wholesale (no deep merge)', () => {
    const base = { searchConfig: { maxResults: 10, minRelevance: 0.5 } };
    const patch = { searchConfig: { maxResults: 20 } };

    expect(mergeManifest(base, patch)).toEqual({ searchConfig: { maxResults: 20 } });
  });

  it('merges harness key by key, so pinning a model keeps the base\'s tool exclusions', () => {
    const base = { harness: { excludeTools: ['render_document', 'generate_image'], recommendActionBackstop: true } };
    const patch = { harness: { modelProvider: 'anthropic', model: 'claude-opus-5' } };

    expect(mergeManifest(base, patch)).toEqual({ harness: { excludeTools: ['render_document', 'generate_image'], recommendActionBackstop: true, modelProvider: 'anthropic', model: 'claude-opus-5' } });
    // A list inside harness still replaces whole, or takes a directive.
    expect(mergeManifest(base, { harness: { excludeTools: ['propose_action'] } }).harness).toMatchObject({ excludeTools: ['propose_action'] });
    expect(mergeManifest(base, { harness: { excludeTools: { $remove: ['generate_image'] } } }).harness).toMatchObject({ excludeTools: ['render_document'] });
  });

  it('adds an override\'s grantTools to the base\'s, so an override never loses a plugin grant', () => {
    // The squatch-factory change-reviewer (2026-10-01): the override named two tools and the
    // plugin's check_live vanished.
    const base = { harness: { grantTools: ['record_verdict', 'product_access', 'check_live'] } };
    const patch = { harness: { model: 'claude-opus-5', grantTools: ['record_verdict', 'product_access', 'github_read_check_logs'] } };

    expect(mergeManifest(base, patch).harness).toEqual({
      model: 'claude-opus-5',
      grantTools: ['record_verdict', 'product_access', 'check_live', 'github_read_check_logs'],
    });
  });

  it('replaces grantTools only when the override says grantToolsMode: replace, and never stores the mode', () => {
    const base = { harness: { grantTools: ['record_verdict', 'check_live'] } };

    expect(mergeManifest(base, { harness: { grantTools: ['product_access'], grantToolsMode: 'replace' } }).harness)
      .toEqual({ grantTools: ['product_access'] });
    expect(mergeManifest(base, { harness: { grantTools: { $remove: ['check_live'] } } }).harness)
      .toEqual({ grantTools: ['record_verdict'] });
    expect(mergeManifest({}, { harness: { grantTools: ['a'], grantToolsMode: 'replace' } }).harness)
      .toEqual({ grantTools: ['a'] });
  });

  it('keeps grantTools additive only inside harness', () => {
    expect(mergeManifest({ grantTools: ['a'] }, { grantTools: ['b'] })).toEqual({ grantTools: ['b'] });
  });

  it('inherits base keys not named in the patch', () => {
    const base = { slug: 'x', name: 'X', model: 'a', skills: ['s1'] };

    expect(mergeManifest(base, { model: 'b' })).toEqual({ slug: 'x', name: 'X', model: 'b', skills: ['s1'] });
  });
});

describe('merge — array behavior', () => {
  it('a bare array replaces', () => {
    expect(mergeManifest({ skills: ['a', 'b'] }, { skills: ['c'] })).toEqual({ skills: ['c'] });
  });

  it('$append extends the base list, de-duping and preserving order', () => {
    expect(mergeManifest({ skills: ['a', 'b'] }, { skills: { $append: ['b', 'c'] } }))
      .toEqual({ skills: ['a', 'b', 'c'] });
  });

  it('$append onto a missing base key starts from empty', () => {
    expect(mergeManifest({ name: 'X' }, { connectorSources: { $append: ['drive'] } }))
      .toEqual({ name: 'X', connectorSources: ['drive'] });
  });

  it('$remove subtracts from the base list', () => {
    expect(mergeManifest({ sources: ['a', 'b', 'c'] }, { sources: { $remove: ['b'] } }))
      .toEqual({ sources: ['a', 'c'] });
  });

  it('$remove then $append compose in one directive', () => {
    expect(mergeManifest({ s: ['a', 'b'] }, { s: { $remove: ['a'], $append: ['c'] } }))
      .toEqual({ s: ['b', 'c'] });
  });

  it('throws when a directive targets a non-list base value', () => {
    expect(() => mergeManifest({ model: 'a' }, { model: { $append: ['x'] } })).toThrow(MergeError);
  });

  it('throws when $append is not a list', () => {
    expect(() => mergeManifest({ s: [] }, { s: { $append: 'x' as never } })).toThrow(MergeError);
  });
});

describe('merge — immutability', () => {
  it('does not mutate base or patch', () => {
    const base = { skills: ['a'], model: 'm' };
    const patch = { skills: { $append: ['b'] } };
    const result = mergeManifest(base, patch);

    expect(base).toEqual({ skills: ['a'], model: 'm' });
    expect(patch).toEqual({ skills: { $append: ['b'] } });
    expect(result).toEqual({ skills: ['a', 'b'], model: 'm' });
  });
});
