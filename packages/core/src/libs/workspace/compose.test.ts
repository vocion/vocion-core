import type { PackRaw, RawEntry } from './compose';
import { describe, expect, it } from 'vitest';
import { composeKind, resolveActivation } from './compose';

// Ticket 007 · step 3 — the per-slug compose ladder + agent-rooted activation.
// Pure logic over in-memory raw entries; the base pack's own resources land in
// step 4, exercised end-to-end there.

const entry = (slug: string, raw: Record<string, unknown> = {}): RawEntry => ({
  slug,
  raw: { slug, ...raw },
  sourceFile: `base/${slug}.yaml`,
});
const wsEntry = (slug: string, raw: Record<string, unknown> = {}): RawEntry => ({
  slug,
  raw: { slug, ...raw },
  sourceFile: `ws/${slug}.yaml`,
});
const asMap = (...es: RawEntry[]) => new Map(es.map(e => [e.slug, e]));

function pack(): PackRaw {
  return {
    agents: asMap(
      entry('director', { skills: ['proposal-brief'], objectTypes: ['proposal'] }),
      entry('writer', { skills: [] }),
    ),
    objectTypes: asMap(entry('proposal')),
    missions: asMap(entry('m1')),
    skills: new Map([
      ['proposal-brief', { slug: 'proposal-brief', playbooks: ['house-style'] }],
      ['pipeline-brief', { slug: 'pipeline-brief', playbooks: [] }],
    ]),
    playbooks: new Map([
      ['house-style', { slug: 'house-style', playbooks: [] }],
      ['etiquette', { slug: 'etiquette', playbooks: [] }],
    ]),
  };
}

describe('resolveActivation', () => {
  it('`use: all` activates every kind', () => {
    const a = resolveActivation(pack(), 'all');

    expect([...a.agents.keys()]).toEqual(['director', 'writer']);
    expect([...a.skills]).toEqual(['proposal-brief', 'pipeline-brief']);
    expect([...a.playbooks]).toEqual(['house-style', 'etiquette']);
    expect([...a.objectTypes.keys()]).toEqual(['proposal']);
    expect([...a.missions.keys()]).toEqual(['m1']);
  });

  it('naming an agent pulls its skills + object types + the skills\' playbooks transitively (and nothing else)', () => {
    const a = resolveActivation(pack(), { agents: ['director'] });

    expect([...a.agents.keys()]).toEqual(['director']);
    expect([...a.skills]).toEqual(['proposal-brief']); // pipeline-brief NOT pulled
    expect([...a.playbooks]).toEqual(['house-style']); // travels with the skill; etiquette NOT pulled
    expect([...a.objectTypes.keys()]).toEqual(['proposal']);
    expect([...a.missions.keys()]).toEqual([]); // missions only under `use: all`
  });

  it('a standalone skill or playbook activates without an agent', () => {
    const a = resolveActivation(pack(), { skills: ['pipeline-brief'], playbooks: ['etiquette'] });

    expect([...a.agents.keys()]).toEqual([]);
    expect([...a.skills]).toEqual(['pipeline-brief']);
    expect([...a.playbooks]).toEqual(['etiquette']);
  });

  it('omitting `use` (null) activates nothing', () => {
    const a = resolveActivation(pack(), null);

    expect(a.agents.size).toBe(0);
    expect(a.skills.size).toBe(0);
    expect(a.playbooks.size).toBe(0);
  });

  it('`disable` subtracts even under `use: all`', () => {
    const a = resolveActivation(pack(), 'all', { agents: ['writer'], skills: ['pipeline-brief'] });

    expect([...a.agents.keys()]).toEqual(['director']);
    expect([...a.skills]).toEqual(['proposal-brief']);
  });

  it('naming an agent the pack does not ship throws', () => {
    expect(() => resolveActivation(pack(), { agents: ['ghost'] }))
      .toThrow(/names "ghost", which the base pack does not ship/);
  });
});

describe('composeKind — the per-slug ladder', () => {
  const allBase = new Set(['director', 'writer']);

  it('an activated base default with no workspace file is inherited (origin: core)', () => {
    const out = composeKind('agent', [], asMap(entry('director')), allBase);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ origin: 'core', sourceFile: 'base/director.yaml' });
  });

  it('a workspace-only resource with no base twin is origin: workspace', () => {
    const out = composeKind('agent', [wsEntry('custom')], new Map(), new Set());

    expect(out[0]).toMatchObject({ origin: 'workspace' });
    expect(out[0]!.raw.slug).toBe('custom');
  });

  it('`extends: core` deep-merges onto the activated base (origin: merged)', () => {
    const base = asMap(entry('director', { model: 'sonnet', skills: ['proposal-brief'] }));
    const patch = wsEntry('director', { extends: 'core', model: 'opus', skills: { $append: ['triage'] } });
    const out = composeKind('agent', [patch], base, allBase);

    expect(out[0]!.origin).toBe('merged');
    expect(out[0]!.raw.model).toBe('opus'); // scalar replaced
    expect(out[0]!.raw.skills).toEqual(['proposal-brief', 'triage']); // $append extended
    expect(out[0]!.raw.extends).toBeUndefined(); // marker stripped
    expect(out[0]!.sourceFile).toBe('ws/director.yaml'); // the override "owns" it
  });

  it('a colliding slug WITHOUT `extends: core` is a hard error', () => {
    expect(() => composeKind('agent', [wsEntry('director')], asMap(entry('director')), allBase))
      .toThrow(/collides with a base default/);
  });

  it('overriding a base default that is not activated is a hard error', () => {
    // director is in the pack (allBase) but not in the activated map
    expect(() => composeKind('agent', [wsEntry('director', { extends: 'core' })], new Map(), allBase))
      .toThrow(/isn't active — add it to workspace.yaml `use:`/);
  });

  it('`extends: core` on a slug the pack does not ship is a hard error', () => {
    expect(() => composeKind('agent', [wsEntry('ghost', { extends: 'core' })], new Map(), new Set()))
      .toThrow(/the base pack ships no such agent/);
  });
});
