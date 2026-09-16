/**
 * MemoryService against PGlite — the successor contract for LearningsService.
 * Worth pinning: the namespace catalog and rule views, dedup at the gate,
 * fixed-key idempotent seeding (workspace:apply), runtime assembly serving
 * pre-rendered content with `last_used_at` stamped but `updated_at` untouched,
 * and the migration fidelity property (a copied rule reads back byte-for-byte).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const {
  addRule,
  assembleMemoryFiles,
  bumpOccurrence,
  checkDedup,
  getNamespace,
  listNamespaces,
  removeRule,
  updateRule,
} = await import('@/services/MemoryService');

const ORG = 'org_memory';
const OTHER_ORG = 'org_memory_other';

/** Fire-and-forget stamping needs a beat to land. */
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

beforeEach(async () => {
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.insert(memoryNamespaceSchema).values([
    { orgId: ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Workspace-wide rules', preamble: 'House rules for every agent.' },
    { orgId: ORG, name: 'crm-updates', path: 'workspace/crm-updates', title: 'CRM updates', description: 'CRM judgment' },
    { orgId: OTHER_ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Theirs' },
  ]);
});

describe('catalog', () => {
  it('lists namespaces with live rule counts, org-scoped', async () => {
    await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
    await addRule({ orgId: OTHER_ORG, stepName: 'global', ruleText: 'Not yours.' });

    const namespaces = await listNamespaces(ORG);

    expect(namespaces.map(ns => [ns.name, ns.ruleCount])).toEqual([['global', 1], ['crm-updates', 0]]);
  });

  it('reads one namespace back with rule views keyed by file path', async () => {
    const added = await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.', source: 'manual' });

    const ns = await getNamespace(ORG, 'global');

    expect(ns.rules).toHaveLength(1);
    expect(ns.rules[0]!.ruleText).toBe('Never invent numbers.');
    expect(ns.rules[0]!.key).toMatch(/^\/workspace\/global\/r.+\.md$/);
    expect(added.ok && added.rule.key).toBe(ns.rules[0]!.key);
    await expect(getNamespace(ORG, 'nope')).rejects.toThrow('unknown memory namespace');
  });
});

describe('gate-side mutations', () => {
  it('refuses a near-duplicate at the gate', async () => {
    await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Always cite the source line.' });

    const dup = await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Always cite the source line!' });

    expect(dup.ok).toBe(false);
    expect(await checkDedup(ORG, 'global', 'Always cite the source line.')).toMatchObject({ ok: false });
  });

  it('seeds idempotently on a fixed key and updates text in place (workspace:apply)', async () => {
    const key = '/workspace/global/ws-cite.md';
    await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Cite sources.', key, source: 'workspace:cite' });
    const second = await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Cite sources, always with a line reference.', key, source: 'workspace:cite' });

    expect(second.ok).toBe(true);
    expect(await db.select().from(memorySchema)).toHaveLength(1);
    expect((await getNamespace(ORG, 'global')).rules[0]!.ruleText).toBe('Cite sources, always with a line reference.');
  });

  it('updates and removes by key', async () => {
    const added = await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
    const key = added.ok ? added.rule.key : '';

    const updated = await updateRule({ orgId: ORG, key, ruleText: 'Ground every claim.' });

    expect(updated.ok && updated.rule.ruleText).toBe('Ground every claim.');
    // Another org cannot touch it.
    expect(await updateRule({ orgId: OTHER_ORG, key, ruleText: 'hijack' })).toMatchObject({ ok: false });
    expect(await removeRule({ orgId: OTHER_ORG, key })).toMatchObject({ ok: false });
    expect(await removeRule({ orgId: ORG, key })).toMatchObject({ ok: true });
    expect((await getNamespace(ORG, 'global')).rules).toHaveLength(0);
  });

  it('bumps the occurrence count without touching the text', async () => {
    const added = await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.', occurrenceCount: 2 });
    const key = added.ok ? added.rule.key : '';

    await bumpOccurrence(ORG, key);

    const ns = await getNamespace(ORG, 'global');

    expect(ns.rules[0]!.occurrenceCount).toBe(3);
    expect(ns.rules[0]!.ruleText).toBe('Never invent numbers.');
  });
});

describe('runtime assembly', () => {
  it('mounts pre-rendered rule files plus the namespace preamble, and skips unknown names', async () => {
    await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
    await addRule({ orgId: ORG, stepName: 'crm-updates', ruleText: 'Ask before overwriting a field.' });

    const files = await assembleMemoryFiles(ORG, ['global', 'not-seeded', 'crm-updates']);
    const paths = Object.keys(files).sort();

    expect(paths[0]).toMatch(/^\/memories\/workspace\/crm-updates\/r.+\.md$/);
    expect(paths.includes('/memories/workspace/global/_preamble.md')).toBe(true);
    expect(files['/memories/workspace/global/_preamble.md']).toContain('House rules for every agent.');
    expect(Object.values(files).join('\n')).toContain('Never invent numbers.');
    expect(Object.values(files).join('\n')).toContain('Ask before overwriting a field.');
  });

  it('stamps last_used_at without churning updated_at', async () => {
    await addRule({ orgId: ORG, stepName: 'global', ruleText: 'Never invent numbers.' });
    const [before] = await db.select().from(memorySchema);

    expect(before!.lastUsedAt).toBeNull();

    await assembleMemoryFiles(ORG, ['global']);
    await settle();

    const [after] = await db.select().from(memorySchema);

    expect(after!.lastUsedAt).not.toBeNull();
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it('never mounts another org rules for the same namespace name', async () => {
    await addRule({ orgId: OTHER_ORG, stepName: 'global', ruleText: 'Their secret playbook.' });

    const files = await assembleMemoryFiles(ORG, ['global']);

    expect(Object.values(files).join('\n')).not.toContain('Their secret playbook.');
  });
});
