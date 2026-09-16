import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const {
  ArtifactError,
  COLLAPSE_WINDOW_MS,
  createArtifact,
  getArtifact,
  listArtifactFolders,
  listArtifacts,
  listArtifactsForConversation,
  listArtifactVersions,
  normaliseFolder,
  restoreArtifactVersion,
  setArtifactFolder,
  toPayload,
  updateArtifact,
  validateSpec,
} = await import('@/services/ArtifactService');
const { exportArtifactAsPage } = await import('@/libs/artifacts/exportPage');

const ORG = 'org_artifact_test';
const AGENT = { kind: 'agent' as const, id: 'agent:revenue-lead' };
const ALICE = { kind: 'human' as const, id: 'usr-alice' };
const BOB = { kind: 'human' as const, id: 'usr-bob' };

async function conv(title = 'Deal desk') {
  return createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: title, createdBy: 'usr-alice' });
}

/**
 * Move only the JS clock, so the collapse window elapses without touching PGlite's now().
 * @param ms
 */
function advance(ms: number) {
  const real = Date.now();
  return vi.spyOn(Date, 'now').mockImplementation(() => real + ms);
}

describe('ArtifactService', () => {
  it('validates the spec with the card schema and rejects bad payloads with a readable line', () => {
    expect(() => validateSpec('table', { columns: [], rows: [] })).toThrow(ArtifactError);
    expect(() => validateSpec('nope', {})).toThrow(/unknown artifact kind/);
    expect(validateSpec('markdown', { md: '# hi' }).kind).toBe('markdown');
  });

  it('creates an artifact at v1 with a version row attributed to its author', async () => {
    const c = await conv();
    const { artifact, version } = await createArtifact({
      orgId: ORG,
      conversationId: c.id,
      kind: 'markdown',
      title: 'Release readiness',
      spec: { md: '# Ready' },
      author: AGENT,
    });

    expect(artifact.currentVersion).toBe(1);
    expect(artifact.headVersionId).toBe(version.id);
    expect(artifact.lastAuthorKind).toBe('agent');
    expect(version).toMatchObject({ version: 1, authorKind: 'agent', authorId: 'agent:revenue-lead', changeSummary: 'Created' });
    expect(toPayload(artifact)).toMatchObject({ version: 1, authorKind: 'agent', folder: null });
  });

  it('every agent edit is a new version and the artifact mirrors the head', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Plan', spec: { md: 'one' }, author: AGENT });

    const second = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'one\ntwo', author: AGENT, changeSummary: 'added a risks section' });
    const third = await updateArtifact({ orgId: ORG, id: artifact.id, title: 'Plan v2', author: AGENT, changeSummary: 'retitled' });

    expect(second.collapsed).toBe(false);
    expect(second.version.version).toBe(2);
    expect(third.version.version).toBe(3);
    expect(third.artifact.currentVersion).toBe(3);
    expect(third.artifact.title).toBe('Plan v2');
    expect(third.artifact.spec).toMatchObject({ md: 'one\ntwo' });

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: artifact.id });

    expect(versions.map(v => v.version)).toEqual([3, 2, 1]);
    expect(versions[1]!.changeSummary).toBe('added a risks section');
  });

  it('collapses a burst of saves by the same human, but not across the window or across people', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Notes', spec: { md: 'a' }, author: AGENT });

    // First human save lands as v2 (the head was the agent's).
    const first = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'ab', author: ALICE, changeSummary: 'Edited by hand' });

    expect(first.collapsed).toBe(false);
    expect(first.version.version).toBe(2);

    // Same person, immediately after: folds into v2 instead of making v3.
    const second = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'abc', author: ALICE, changeSummary: 'Edited by hand' });

    expect(second.collapsed).toBe(true);
    expect(second.version.version).toBe(2);
    expect(second.artifact.currentVersion).toBe(2);
    expect(second.artifact.spec).toMatchObject({ md: 'abc' });

    // A different person never folds into someone else's version.
    const other = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'abcd', author: BOB, changeSummary: 'Edited by hand' });

    expect(other.collapsed).toBe(false);
    expect(other.version.version).toBe(3);

    // Past the window, the same person starts a new version.
    const spy = advance(COLLAPSE_WINDOW_MS + 1000);
    try {
      const later = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'abcde', author: BOB, changeSummary: 'Edited by hand' });

      expect(later.collapsed).toBe(false);
      expect(later.version.version).toBe(4);
    } finally {
      spy.mockRestore();
    }
  });

  it('restoring an older version writes a NEW head and never rewrites history', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Brief', spec: { md: 'original' }, author: AGENT });
    await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'rewritten', author: AGENT, changeSummary: 'rewrote it' });

    const restored = await restoreArtifactVersion({ orgId: ORG, id: artifact.id, version: 1, author: ALICE });

    expect(restored.version.version).toBe(3);
    expect(restored.version.changeSummary).toBe('Restored v1');
    expect(restored.version.authorKind).toBe('human');
    expect(restored.artifact.spec).toMatchObject({ md: 'original' });

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: artifact.id });

    expect(versions.map(v => v.version)).toEqual([3, 2, 1]);
    expect(versions.find(v => v.version === 2)?.spec).toMatchObject({ md: 'rewritten' });
  });

  it('a restore never folds into the save before it, even inside the collapse window', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Note', spec: { md: 'original' }, author: AGENT });
    await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'mine', author: ALICE, changeSummary: 'Edited by hand' });

    const restored = await restoreArtifactVersion({ orgId: ORG, id: artifact.id, version: 1, author: ALICE });

    expect(restored.version.version).toBe(3);
    expect(restored.version.changeSummary).toBe('Restored v1');
    expect((await listArtifactVersions({ orgId: ORG, artifactId: artifact.id })).map(v => v.changeSummary)).toEqual(['Restored v1', 'Edited by hand', 'Created']);
  });

  it('refuses a write whose expected version has moved on, and allows the deliberate overwrite', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Race', spec: { md: 'a' }, author: ALICE });
    await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'agent wrote', author: AGENT, changeSummary: 'agent edit' });

    await expect(updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'mine', author: ALICE, changeSummary: 'mine', ifVersion: 1 }))
      .rejects
      .toThrow(/is at v2, not v1/);

    // "Keep mine" sends no ifVersion and lands on top.
    const kept = await updateArtifact({ orgId: ORG, id: artifact.id, contentMarkdown: 'mine', author: ALICE, changeSummary: 'kept mine' });

    expect(kept.version.version).toBe(3);
    expect(kept.artifact.spec).toMatchObject({ md: 'mine' });
  });

  it('rejects an edit that would break the kind’s schema, leaving the head untouched', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({
      orgId: ORG,
      conversationId: c.id,
      kind: 'table',
      title: 'Open deals',
      spec: { columns: [{ key: 'name' }], rows: [{ name: 'Acme' }] },
      author: AGENT,
    });

    await expect(updateArtifact({ orgId: ORG, id: artifact.id, spec: { columns: [], rows: [] }, author: ALICE, changeSummary: 'broke it' }))
      .rejects
      .toThrow(/invalid table spec/);

    expect((await getArtifact({ orgId: ORG, id: artifact.id }))?.currentVersion).toBe(1);
  });

  it('is tenant-scoped', async () => {
    const c = await conv();
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'link', title: 'Docs', spec: { href: '/dashboard/docs', title: 'Docs' }, author: AGENT });

    expect(await getArtifact({ orgId: 'other_org', id: artifact.id })).toBeNull();
    expect(await listArtifactsForConversation({ orgId: 'other_org', conversationId: c.id })).toHaveLength(0);
    await expect(updateArtifact({ orgId: 'other_org', id: artifact.id, title: 'Stolen', author: ALICE, changeSummary: 'x' })).rejects.toThrow(/not found/);
  });

  it('normalises folders, moves without making a version, and groups the log', async () => {
    expect(normaliseFolder(' Revenue / Weekly Ops ')).toBe('revenue/weekly-ops');
    expect(normaliseFolder('../../etc')).toBe('etc');
    expect(normaliseFolder('   ')).toBeNull();

    const c = await conv('Weekly');
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Weekly note', spec: { md: 'x' }, folder: 'Revenue/Weekly', author: AGENT });

    expect(artifact.folder).toBe('revenue/weekly');

    const moved = await setArtifactFolder({ orgId: ORG, id: artifact.id, folder: 'ops' });

    expect(moved?.folder).toBe('ops');
    expect(moved?.currentVersion).toBe(1);

    const folders = await listArtifactFolders({ orgId: ORG });

    expect(folders.map(f => f.folder)).toContain('ops');
  });

  it('lists the log newest-edited first with version counts and the source conversation', async () => {
    const c = await conv('Pipeline review');
    const { artifact } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'chart', title: 'Pipeline by stage', spec: { type: 'bar', x: ['a'], series: [{ name: 's', values: [1] }] }, author: AGENT });
    await updateArtifact({ orgId: ORG, id: artifact.id, title: 'Pipeline by stage (Q3)', author: AGENT, changeSummary: 'scoped to Q3' });

    const rows = await listArtifacts({ orgId: ORG, kinds: ['chart'] });
    const row = rows.find(r => r.id === artifact.id);

    expect(row).toMatchObject({ title: 'Pipeline by stage (Q3)', versions: 2, version: 2, conversationTitle: 'Pipeline review' });
    expect(rows[0]!.updatedAt >= rows.at(-1)!.updatedAt).toBe(true);

    expect((await listArtifacts({ orgId: ORG, search: 'pipeline by stage' })).map(r => r.id)).toContain(artifact.id);
  });

  it('exports a markdown artifact as a workspace page and refuses the kinds that have no archetype', async () => {
    const c = await conv();
    const { artifact: doc } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Deal desk · Monday', spec: { md: 'Call the account.' }, author: AGENT });
    const page = exportArtifactAsPage(doc);

    expect(page.slug).toBe('deal-desk-monday');
    expect(page.files.map(f => f.path)).toEqual(['pages/deal-desk-monday.yaml', 'pages/deal-desk-monday.md']);
    expect(page.files[0]!.content).toContain('archetype: markdown');
    expect(page.files[1]!.content).toContain('Call the account.');
    expect(page.unsupported).toBeNull();

    const { artifact: table } = await createArtifact({
      orgId: ORG,
      conversationId: c.id,
      kind: 'table',
      title: 'Open deals',
      spec: { columns: [{ key: 'name', label: 'Deal' }, { key: 'amount', type: 'currency' }], rows: [{ name: 'Acme', amount: 1200 }] },
      author: AGENT,
    });

    expect(exportArtifactAsPage(table).files[1]!.content).toContain('| Deal | amount |');

    const { artifact: chart } = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'chart', title: 'Trend', spec: { type: 'line', x: ['a'], series: [{ name: 's', values: [1] }] }, author: AGENT });

    expect(exportArtifactAsPage(chart).unsupported).toMatchObject({ kind: 'chart' });
  });
});
