/**
 * Workspaces in the database, step 3: export and import.
 *
 * The acceptance case is the round trip. A workspace is applied, then changed
 * in the app the way people change one (an agent hired, a connector added, a
 * mission's goal edited, a trust rule promoted, the goal reworded); it is
 * exported; the export is imported into a fresh workspace; and the fresh one
 * exports byte-for-byte the same files (but for whose workspace it is), and
 * applied back onto the first changes nothing.
 *
 * Then what an import must and must not do: a merge never retires or deletes
 * what the upload does not mention, a replace does and says so first, a review
 * writes nothing, an apply lands only what was reviewed, a workspace whose
 * next apply would undo the import is told so instead, and the staging folder
 * is gone however the import ends.
 *
 * Real PGlite behind the DB mock, the real loader and applier, no model.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { fromRepoRoot } = await import('@/libs/repo-root');
const { applyWorkspace } = await import('@/libs/workspace/applier');
const { loadWorkspace } = await import('@/libs/workspace/loader');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');
const { zipWorkspace } = await import('@/libs/workspace/archive');
const { upsertSourceRow } = await import('@/libs/sources/upsert');
const { describeSchedule } = await import('@/libs/durable/jobs');
const { sourceScheduleIdFor } = await import('@/libs/durable/scheduleIds');
const { ensureSourceSchedule } = await import('@/services/SourceScheduleService');
const { exportWorkspace, EXPORT_REPORT_FILE } = await import('./WorkspaceExportService');
const { applyImport, previewImport, upsertMerge, WorkspaceImportError } = await import('./WorkspaceImportService');

const { agentSchema, autonomyPolicySchema, knowledgeSourceSchema, missionSchema, projectSchema, tenantAccountSchema, trustRuleSchema, workspaceFileSchema, workspaceVersionSchema } = schema;

const ACCOUNT = 'acct_cobalt_transfer';
const A = 'proj_cobalt_works';
const B = 'proj_cobalt_copy';
const TEMPLATE = fromRepoRoot('packages/core/templates/workspaces/engineering-team');
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-transfer-test-'));

/** What the fixture adds to the engineering template, so every kind the loader reads is in it. */
const EXTRAS: Record<string, string> = {
  'pages/overview.yaml': 'slug: overview\ntitle: Overview\narchetype: markdown\n',
  'pages/overview.md': '# Overview\n\nThe status page lives at {{env.COBALT_STATUS_URL}}.\n',
  'brand.yaml': 'name: Cobalt Works\npalette:\n  ink: "#101820"\nroles:\n  ink: ink\nlogos:\n  mark: brand/mark.svg\n',
  'brand/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
  'playbooks/house-style/SKILL.md': '---\nslug: house-style\nname: House style\ndescription: How Cobalt Works writes.\n---\n\n# Short sentences. Numbers first.\n',
  'objects/incident/type.yaml': 'slug: incident\nlabel: Incident\ndescription: Something burning in production.\nclassificationPromptFile: classification-prompt.md\nschema:\n  type: object\n  properties:\n    severity:\n      type: string\n',
  'objects/incident/classification-prompt.md': 'An incident is an outage or a breach of the severity matrix.\n',
  'evals/release-notes.yaml': 'slug: release-notes\nname: Release notes\nagentSlug: release-manager\nitems:\n  - input: Draft the notes for 2.4\n    expectedOutput: Names the migration first\n',
  'voice.yaml': 'never:\n  - pattern: synergy\n    reason: Says nothing.\n',
};

/** A fresh copy of the fixture workspace: the engineering template, every kind added, the wiki plugin on. */
function fixture(): string {
  const dir = mkdtempSync(join(ROOT, 'ws-'));
  cpSync(TEMPLATE, dir, { recursive: true });
  for (const [rel, body] of Object.entries(EXTRAS)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  writeFileSync(join(dir, 'workspace.yaml'), `${readFileSync(join(dir, 'workspace.yaml'), 'utf8')}plugins:\n  - wiki\n`);
  return dir;
}

async function project(id: string, slug: string, name: string): Promise<void> {
  await db.insert(projectSchema).values({ id, accountId: ACCOUNT, slug, name });
}

/**
 * The first workspace, applied and then changed in the app the ways people
 * change one — each a change no workspace file says.
 */
async function appliedAndChangedInTheApp(): Promise<void> {
  const result = await applyWorkspace(loadWorkspace(fixture()), { orgId: A, appliedBy: 'vitest' });

  expect(result.errors).toEqual([]);

  // An agent hired in the app (CatalogService writes the row, no file).
  await db.insert(agentSchema).values({
    orgId: A,
    projectId: A,
    slug: 'release-scribe',
    name: 'Release scribe',
    systemPrompt: 'You write the release notes Cobalt Works sends.',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
    skillSlugs: ['draft-release-notes'],
    role: 'lead',
    initiative: 'normal',
    team: 'engineering',
    teamSlug: 'engineering',
    harnessConfig: {},
  });
  // A connector added on the Connect page (the API's writer, no manifest folder).
  await upsertSourceRow(A, { slug: 'status-page', name: 'Status page', kind: 'web', config: { urls: ['https://status.cobalt.example'] }, enabled: true }, { known: { learningSteps: new Set(), agentSlugs: new Set() } });
  // A mission's goal edited in the app since its file.
  await db.update(missionSchema).set({ goal: 'Keep main releasable every weekday.' }).where(and(eq(missionSchema.orgId, A), eq(missionSchema.slug, 'keep-main-releasable')));
  // A trust rule a promotion raised.
  await db.insert(trustRuleSchema).values({ orgId: A, actionId: 'gmail.draft', threshold: 0.9, enabled: 'false' });
  // The workspace's goal reworded in the app.
  await db.update(projectSchema).set({ goal: 'Ship every weekday without an unreviewed release.' }).where(eq(projectSchema.id, A));
}

/**
 * The export as path → text, less its report.
 * @param orgId - The workspace.
 */
async function exported(orgId: string): Promise<Map<string, string>> {
  const out = await exportWorkspace(orgId);
  return new Map(out.files.filter(f => f.path !== EXPORT_REPORT_FILE).map(f => [f.path, f.encoding === 'base64' ? `base64:${f.content}` : f.content]));
}

async function zipOf(orgId: string): Promise<Uint8Array> {
  const out = await exportWorkspace(orgId);
  return zipWorkspace(out.files, 'cobalt-workspace');
}

/**
 * A zip of exactly these files, as an admin might make one by hand.
 * @param files - Path → text.
 */
function zipFiles(files: Record<string, string>): Uint8Array {
  return zipWorkspace(Object.entries(files).map(([path, content]) => ({ path, content, encoding: 'utf8' as const })), 'upload');
}

async function liveAgents(orgId: string): Promise<string[]> {
  const rows = await db.select({ slug: agentSchema.slug, active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, orgId));
  return rows.filter(r => r.active !== 'false').map(r => r.slug).sort();
}

const ORIGINAL = { VOCION_SCHEDULE_OWNER: process.env.VOCION_SCHEDULE_OWNER, VOCION_MAIL_DOMAIN: process.env.VOCION_MAIL_DOMAIN, WORKSPACE_PATH: process.env.WORKSPACE_PATH, VOCION_WORKSPACE_MAP: process.env.VOCION_WORKSPACE_MAP, WORKSPACE_TEMPLATE_VARS: process.env.WORKSPACE_TEMPLATE_VARS, COBALT_STATUS_URL: process.env.COBALT_STATUS_URL, TMPDIR: process.env.TMPDIR };

beforeEach(async () => {
  for (const table of [workspaceFileSchema, workspaceVersionSchema, trustRuleSchema, autonomyPolicySchema, knowledgeSourceSchema, missionSchema, agentSchema, schema.teamSchema, schema.automationSchema, schema.workflowSchema, schema.playbookSchema, schema.businessObjectTypeSchema, schema.evalDatasetSchema, schema.memoryNamespaceSchema, schema.notificationRuleSchema, schema.memorySchema, schema.accountMembershipSchema, projectSchema, schema.userSchema, tenantAccountSchema]) {
    await db.delete(table);
  }
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Cobalt Works', slug: 'cobalt-works' } as never);
  await project(A, 'cobalt', 'Cobalt Works');
  await project(B, 'cobalt-copy', 'Cobalt Works (copy)');
  invalidateCurrentContextShaCache();
  // No folder on this host for either workspace: the Cloud case.
  delete process.env.WORKSPACE_PATH;
  delete process.env.VOCION_WORKSPACE_MAP;
  process.env.WORKSPACE_TEMPLATE_VARS = 'COBALT_STATUS_URL';
  process.env.COBALT_STATUS_URL = 'https://status.cobalt.example';
});

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('export', () => {
  it('carries every kind the loader reads: authored files as authored, and what the app changed from its rows', async () => {
    await appliedAndChangedInTheApp();
    const out = await exportWorkspace(A);
    const files = new Map(out.files.map(f => [f.path, f.content]));

    expect(out.report.base).toBe('stored');
    // As authored: skill bodies, pages with their tokens unresolved, the brand and its logo, the playbook, the object type and its prompt.
    expect(files.get('skills/draft-release-notes/SKILL.md')).toBe(readFileSync(join(TEMPLATE, 'skills/draft-release-notes/SKILL.md'), 'utf8'));
    expect(files.get('pages/overview.md')).toContain('{{env.COBALT_STATUS_URL}}');
    expect(files.get('brand.yaml')).toBe(EXTRAS['brand.yaml']);
    expect(files.has('brand/mark.svg')).toBe(true);
    expect(files.get('playbooks/house-style/SKILL.md')).toBe(EXTRAS['playbooks/house-style/SKILL.md']);
    expect(files.get('objects/incident/classification-prompt.md')).toBe(EXTRAS['objects/incident/classification-prompt.md']);
    expect(files.get('agents/engineering-lead.yaml')).toBe(readFileSync(join(TEMPLATE, 'agents/engineering-lead.yaml'), 'utf8'));

    // From the rows: what no file says (a git workspace never stored these), and what the app changed since its file.
    const fromRows = out.report.fromRows.map(r => `${r.kind}:${r.slug}:${r.why}`);

    expect(fromRows).toEqual(expect.arrayContaining([
      'agent:release-scribe:not in the files',
      'connector:status-page:not in the files',
      'mission:keep-main-releasable:changed in the app',
      'learning step:code_review:not in the files',
      'eval dataset:release-notes:not in the files',
      'trust rules:trust.yaml:not in the files',
      'voice rules:voice.yaml:not in the files',
      'settings:workspace.yaml:changed in the app',
    ]));
    expect(parseYaml(files.get('missions/keep-main-releasable.yaml')!).goal).toBe('Keep main releasable every weekday.');
    expect(parseYaml(files.get('workspace.yaml')!).goal).toBe('Ship every weekday without an unreviewed release.');
    // The manifest keeps its authored comments where only one setting moved.
    expect(files.get('workspace.yaml')).toContain('# Placeholder');
    // Seeded learning rules go with their step.
    expect(parseYaml(files.get('learnings/code_review.yaml')!).rules.map((r: { id: string }) => r.id)).toContain('quote-the-line');

    // A plugin's resources come back from `plugins:`, never as workspace files.
    expect([...files.keys()].some(p => p.includes('wiki-curator') || p.includes('wiki-researcher'))).toBe(false);
    expect(parseYaml(files.get('workspace.yaml')!).plugins).toEqual(['wiki']);

    // Nothing that opens anything, and nothing about this host.
    const source = parseYaml(files.get('sources/status-page.yaml')!);

    expect(source).toEqual({ slug: 'status-page', name: 'Status page', kind: 'web', config: { urls: ['https://status.cobalt.example'] } });
    expect([...files.values()].join('\n')).not.toMatch(/_manifestDir|_connector|vocion-transfer-test/);

    expect(files.get(EXPORT_REPORT_FILE)).toContain('Credentials, connector logins and API tokens');
    expect(out.report.problems).toEqual([]);
  });

  it('applies back onto the workspace it came from as a no-op', async () => {
    await appliedAndChangedInTheApp();
    const preview = await previewImport(A, await zipOf(A), { replace: true });

    expect(preview.errors).toEqual([]);
    expect(preview.changes).toEqual([]);
  });

  it('writes a workspace nothing was ever stored for from its rows alone', async () => {
    // A personal workspace: one agent row, seeded straight into the database.
    await db.insert(agentSchema).values({ orgId: B, projectId: B, slug: 'assistant', name: 'Assistant', systemPrompt: 'You help one person.', role: 'lead', initiative: 'normal', harnessConfig: {} });
    await db.update(projectSchema).set({ leadAgentSlug: 'assistant' }).where(eq(projectSchema.id, B));
    const out = await exportWorkspace(B);
    const files = new Map(out.files.map(f => [f.path, f.content]));

    expect(out.report.base).toBe('rows');
    expect(parseYaml(files.get('workspace.yaml')!)).toMatchObject({ version: 1, orgId: B, name: 'Cobalt Works (copy)', lead: 'assistant' });
    expect(files.get('agents/assistant.system-prompt.md')).toBe('You help one person.\n');
    expect(out.report.problems).toEqual([]);
  });
});

describe('the round trip: export → import into a fresh workspace → identical', () => {
  it('imports into a fresh workspace, which then exports the same files and applies back as a no-op', async () => {
    await appliedAndChangedInTheApp();
    const before = await exported(A);
    const upload = await zipOf(A);

    const preview = await previewImport(B, upload);

    expect(preview.blockedBy).toBeNull();
    expect(preview.errors).toEqual([]);
    // Everything is new to B but its own project row, whose settings the
    // import changes — named by the key that says each.
    expect(preview.changes.filter(c => c.resource !== 'settings').every(c => c.outcome === 'created')).toBe(true);
    expect(preview.changes.filter(c => c.resource === 'settings').map(c => c.slug)).toEqual(expect.arrayContaining(['plugins', 'goal', 'voice.yaml']));
    // The pages, brand and logo it stores are named by path.
    expect(preview.changes.filter(c => c.resource === 'files').map(c => c.slug)).toEqual(expect.arrayContaining(['pages/overview.md', 'brand.yaml', 'brand/mark.svg']));
    // Connectors that read the server's disk come across, and the review says they will read nothing here.
    expect(preview.refused).toEqual([]);
    expect(preview.warnings.filter(w => w.resource === 'source').map(w => w.slug).sort()).toEqual(['handbook', 'incidents', 'pull-requests']);
    expect(preview.counts.agents.created).toBeGreaterThan(5);
    // A review writes nothing.
    expect(await liveAgents(B)).toEqual([]);
    expect(await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, B))).toEqual([]);

    const result = await applyImport(B, upload, { sha: preview.sha, appliedBy: 'workspace.import:vitest' });

    expect(result.errors).toEqual([]);

    const after = await exported(B);
    const manifest = (files: Map<string, string>) => ({ ...parseYaml(files.get('workspace.yaml')!), orgId: 'x' });

    expect([...after.keys()]).toEqual([...before.keys()]);

    for (const [path, content] of before) {
      if (path !== 'workspace.yaml') {
        expect({ path, content: after.get(path) }).toEqual({ path, content });
      }
    }

    expect(manifest(after)).toEqual(manifest(before));
    expect(parseYaml(after.get('workspace.yaml')!).orgId).toBe(B);

    // The manifest is the source's text, comments and all, made B's own.
    const sourceOrg = parseYaml(before.get('workspace.yaml')!).orgId;

    expect(after.get('workspace.yaml')).toBe(before.get('workspace.yaml')!.replace(`orgId: ${sourceOrg}`, `orgId: ${B}`));

    // Identical in the applier's own terms, both ways: each workspace applied
    // onto the other creates, updates and retires nothing.
    expect((await previewImport(A, await zipOf(B), { replace: true })).changes).toEqual([]);
    expect((await previewImport(B, upload, { replace: true })).changes).toEqual([]);

    const [version] = await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, B));

    expect(version).toMatchObject({ appliedBy: 'workspace.import:vitest', sourcePath: 'import', sha: result.sha });
  });
});

describe('import', () => {
  /** A small upload: a new agent, and a changed one, with the minimum manifest. */
  const SMALL = {
    'workspace.yaml': `version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\n`,
    'agents/changelog-keeper.yaml': 'slug: changelog-keeper\nname: Changelog keeper\nsystemPrompt: You keep the changelog true.\n',
    'agents/docs-writer.yaml': 'slug: docs-writer\nname: Docs Writer\nsystemPrompt: You keep the docs true, and nothing else.\n',
  };

  it('merges by default: what the upload names is created or updated, and nothing it leaves out changes', async () => {
    await appliedAndChangedInTheApp();
    const agentsBefore = await liveAgents(A);
    const rulesBefore = await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, A));

    const preview = await previewImport(A, zipFiles(SMALL));

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map(c => `${c.resource}:${c.slug}:${c.outcome}`).sort()).toEqual(['agents:changelog-keeper:created', 'agents:docs-writer:updated']);

    await applyImport(A, zipFiles(SMALL), { sha: preview.sha, appliedBy: 'workspace.import:vitest' });

    expect(await liveAgents(A)).toEqual([...agentsBefore, 'changelog-keeper'].sort());
    expect((await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, A))).length).toBe(rulesBefore.length);

    const [p] = await db.select().from(projectSchema).where(eq(projectSchema.id, A));

    // A manifest that names no plugin turns none off, and the goal set in the app stays.
    expect(p!.enabledPlugins).toEqual(['wiki']);
    expect(p!.goal).toBe('Ship every weekday without an unreviewed release.');

    const [docs] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, A), eq(agentSchema.slug, 'docs-writer')));

    expect(docs!.systemPrompt).toBe('You keep the docs true, and nothing else.');
  });

  it('replaces when asked, and the review says what would be retired before anything is', async () => {
    await appliedAndChangedInTheApp();
    const preview = await previewImport(A, zipFiles(SMALL), { replace: true });
    const retired = preview.changes.filter(c => c.outcome === 'retired').map(c => `${c.resource}:${c.slug}`);

    expect(retired).toEqual(expect.arrayContaining(['agents:release-scribe', 'agents:engineering-lead', 'missions:keep-main-releasable', 'automations:release-readiness', 'workflows:release-approval']));
    expect(preview.counts.agents.retired).toBeGreaterThan(0);
    // Still only a review.
    expect(await liveAgents(A)).toContain('release-scribe');

    await applyImport(A, zipFiles(SMALL), { replace: true, sha: preview.sha, appliedBy: 'workspace.import:vitest' });

    expect(await liveAgents(A)).toEqual(['changelog-keeper', 'docs-writer']);
    // Rows are retired, never deleted.
    expect((await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, A), eq(agentSchema.slug, 'release-scribe')))).length).toBe(1);
    expect(await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, A))).toEqual([]);
  });

  it('applies only what was reviewed: a workspace that changed since asks for a new review', async () => {
    await appliedAndChangedInTheApp();
    const preview = await previewImport(A, zipFiles(SMALL));
    await db.update(missionSchema).set({ goal: 'Changed again after the review.' }).where(and(eq(missionSchema.orgId, A), eq(missionSchema.slug, 'keep-main-releasable')));

    await expect(applyImport(A, zipFiles(SMALL), { sha: preview.sha, appliedBy: 'vitest' })).rejects.toMatchObject({ code: 'CHANGED' });
    expect(await liveAgents(A)).not.toContain('changelog-keeper');
  });

  it('tells a workspace a deploy applies from git that its next deploy would undo the import, and does not apply it', async () => {
    await applyWorkspace(loadWorkspace(fixture()), { orgId: A, appliedBy: 'deploy-bot' });
    invalidateCurrentContextShaCache();

    const preview = await previewImport(A, zipFiles(SMALL));

    expect(preview.blockedBy).toContain('applied from git');
    await expect(applyImport(A, zipFiles(SMALL), { sha: preview.sha, appliedBy: 'vitest' })).rejects.toBeInstanceOf(WorkspaceImportError);
  });

  it('tells a workspace this host applies from its own folder to change the folder, and exports from that folder', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'workspace.yaml'), readFileSync(join(dir, 'workspace.yaml'), 'utf8').replace(/^orgId: .*$/m, `orgId: ${B}`));
    process.env.WORKSPACE_PATH = dir;

    const out = await exportWorkspace(B);

    expect(out.report.base).toBe('folder');
    expect(out.files.map(f => f.path)).toEqual(expect.arrayContaining(['skills/triage-incident/SKILL.md', 'pages/overview.md', 'agents/pr-reviewer.yaml']));

    const preview = await previewImport(B, zipFiles(SMALL));

    expect(preview.blockedBy).toContain('applied from its folder on this host');
    await expect(applyImport(B, zipFiles(SMALL), { sha: preview.sha, appliedBy: 'vitest' })).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('gives a copied workspace its own mailbox, not the address of the workspace it came from', async () => {
    process.env.VOCION_MAIL_DOMAIN = 'mail.cobalt.example';
    const withMailbox = { ...SMALL, 'workspace.yaml': `${SMALL['workspace.yaml']}mailbox:\n  enabled: true\n  address: cobalt@mail.cobalt.example\n` };
    const preview = await previewImport(B, zipFiles(withMailbox), { replace: true });
    await applyImport(B, zipFiles(withMailbox), { replace: true, sha: preview.sha, appliedBy: 'vitest' });
    const [copy] = await db.select().from(projectSchema).where(eq(projectSchema.id, B));

    expect(copy).toMatchObject({ mailboxEnabled: true, mailboxAddress: 'cobalt-copy@mail.cobalt.example' });
  });

  it('says why an upload that does not load as a workspace cannot be imported, naming the file', async () => {
    const broken = { ...SMALL, 'agents/broken.yaml': 'slug: broken\nname: Broken\n' };

    await expect(previewImport(B, zipFiles(broken))).rejects.toThrow(/agents\/broken\.yaml/);
  });

  it('leaves no staging folder behind, whether the import lands or fails', async () => {
    const staging = mkdtempSync(join(ROOT, 'tmp-'));
    process.env.TMPDIR = staging;
    const preview = await previewImport(B, zipFiles(SMALL));
    await applyImport(B, zipFiles(SMALL), { sha: preview.sha, appliedBy: 'vitest' });

    await expect(previewImport(B, zipFiles({ ...SMALL, 'agents/broken.yaml': 'slug: broken\n' }))).rejects.toThrow();

    expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  });
});

/**
 * The code of what an import threw, and its message.
 * @param run - The import.
 */
async function refusal(run: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WorkspaceImportError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error('the import went through');
}

describe('an import cannot read outside what it uploads', () => {
  const MANIFEST = 'version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\n';
  const ESCAPES = '../../../../../../../../../../etc/hosts';

  for (const replace of [false, true]) {
    it(`refuses a prompt file that climbs out of the upload or is absolute, naming no host path (${replace ? 'replace' : 'merge'})`, async () => {
      if (!replace) {
        await appliedAndChangedInTheApp();
      }
      const uploads = {
        'agent prompt, ../': { 'workspace.yaml': MANIFEST, 'agents/leak.yaml': `slug: leak\nname: Leak\nsystemPromptFile: ${ESCAPES}\n` },
        'agent prompt, absolute': { 'workspace.yaml': MANIFEST, 'agents/leak.yaml': 'slug: leak\nname: Leak\nsystemPromptFile: /etc/hosts\n' },
        'subagent prompt, ../': { 'workspace.yaml': MANIFEST, 'agents/leak.yaml': `slug: leak\nname: Leak\nsystemPrompt: Hi.\nsubagents:\n  - name: helper\n    description: Helps.\n    systemPromptFile: ${ESCAPES}\n` },
        'classification prompt, ../': { 'workspace.yaml': MANIFEST, 'objects/leak/type.yaml': `slug: leak\nlabel: Leak\nclassificationPromptFile: ${ESCAPES}\n` },
        'classification prompt, absolute': { 'workspace.yaml': MANIFEST, 'objects/leak/type.yaml': 'slug: leak\nlabel: Leak\nclassificationPromptFile: /etc/hosts\n' },
      };
      for (const [name, files] of Object.entries(uploads)) {
        const reviewed = await refusal(previewImport(A, zipFiles(files), { replace }));

        expect({ name, code: reviewed.code }).toEqual({ name, code: 'INVALID' });
        expect(reviewed.message).toMatch(/PromptFile: must/);
        expect(reviewed.message).not.toContain(tmpdir());
        expect(reviewed.message).not.toContain('localhost');

        // Applying it with any sha lands nothing.
        expect((await refusal(applyImport(A, zipFiles(files), { replace, sha: 'review-anything', appliedBy: 'vitest' }))).code).toBe('INVALID');
      }
      const agents = await db.select({ slug: agentSchema.slug, systemPrompt: agentSchema.systemPrompt }).from(agentSchema).where(eq(agentSchema.orgId, A));

      expect(agents.map(a => a.slug)).not.toContain('leak');
      expect(agents.some(a => a.systemPrompt.includes('localhost'))).toBe(false);
    });
  }
});

describe('an import cannot take another workspace\'s mailbox', () => {
  /** The address belongs to A; B uploads a manifest that reaches it through a YAML alias. */
  const ALIASED = {
    'workspace.yaml': 'version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\nx-box: &mb {enabled: true, address: northwind-ops@mail.cobalt.example}\nmailbox: *mb\n',
    'agents/docs-writer.yaml': 'slug: docs-writer\nname: Docs Writer\nsystemPrompt: You keep the docs true.\n',
  };

  for (const replace of [false, true]) {
    it(`reads the address as the loader does, alias and all, and gives B its own (${replace ? 'replace' : 'merge'})`, async () => {
      process.env.VOCION_MAIL_DOMAIN = 'mail.cobalt.example';
      await db.update(projectSchema).set({ mailboxEnabled: true, mailboxAddress: 'northwind-ops@mail.cobalt.example' }).where(eq(projectSchema.id, A));

      const preview = await previewImport(B, zipFiles(ALIASED), { replace });
      await applyImport(B, zipFiles(ALIASED), { replace, sha: preview.sha, appliedBy: 'vitest' });
      const [copy] = await db.select().from(projectSchema).where(eq(projectSchema.id, B));

      expect(copy).toMatchObject({ mailboxEnabled: true, mailboxAddress: 'cobalt-copy@mail.cobalt.example' });
      expect((await db.select().from(projectSchema).where(eq(projectSchema.mailboxAddress, 'northwind-ops@mail.cobalt.example'))).map(p => p.id)).toEqual([A]);
    });
  }
});

describe('an import keeps what it does not mention', () => {
  it('leaves the sync schedule of a connector added in the app as it is, whether the upload leaves it out or carries it without one', async () => {
    process.env.VOCION_SCHEDULE_OWNER = '1';
    await appliedAndChangedInTheApp();
    const [row] = await db.select().from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, A), eq(knowledgeSourceSchema.slug, 'status-page')));
    // What the Connect page gives a connector it saves (`connect/newSourceSync.ts`).
    await ensureSourceSchedule({ orgId: A, sourceId: row!.id, sourceSlug: 'status-page', cron: '17 * * * *' });

    const small = zipFiles({ 'workspace.yaml': 'version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\n', 'agents/changelog-keeper.yaml': 'slug: changelog-keeper\nname: Changelog keeper\nsystemPrompt: You keep the changelog true.\n' });
    const first = await previewImport(A, small);
    const applied = await applyImport(A, small, { sha: first.sha, appliedBy: 'vitest' });

    expect(applied.errors).toEqual([]);
    expect((await describeSchedule(sourceScheduleIdFor(A, 'status-page')))?.cron).toBe('17 * * * *');

    // Its own export carries the connector, and no schedule — which says nothing about one.
    const whole = await zipOf(A);
    const again = await previewImport(A, whole);
    await applyImport(A, whole, { sha: again.sha, appliedBy: 'vitest' });

    expect((await describeSchedule(sourceScheduleIdFor(A, 'status-page')))?.cron).toBe('17 * * * *');
  });
});

describe('the review names everything an apply would change', () => {
  const MANIFEST = 'version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\n';

  it('a page alone: named by path, applied, and stored', async () => {
    await appliedAndChangedInTheApp();
    const upload = zipFiles({ 'workspace.yaml': MANIFEST, 'pages/overview.md': '# Overview\n\nWhat changed this week, first.\n' });
    const preview = await previewImport(A, upload);

    expect(preview.changes.map(c => `${c.resource}:${c.slug}:${c.outcome}`)).toEqual(['files:pages/overview.md:updated']);

    await applyImport(A, upload, { sha: preview.sha, appliedBy: 'vitest' });
    const [stored] = await db.select().from(workspaceFileSchema).where(and(eq(workspaceFileSchema.orgId, A), eq(workspaceFileSchema.path, 'pages/overview.md')));

    expect(stored!.content).toContain('What changed this week, first.');
  });

  it('a trust rule alone: named by action, applied', async () => {
    await appliedAndChangedInTheApp();
    const upload = zipFiles({ 'workspace.yaml': MANIFEST, 'trust.yaml': 'rules:\n  - action: gmail.send\n    autoApproveAbove: 0.95\n    enabled: false\n' });
    const preview = await previewImport(A, upload);

    expect(preview.changes.map(c => `${c.resource}:${c.slug}:${c.outcome}`)).toEqual(['trustRules:gmail.send:updated']);

    await applyImport(A, upload, { sha: preview.sha, appliedBy: 'vitest' });
    const [rule] = await db.select().from(trustRuleSchema).where(and(eq(trustRuleSchema.orgId, A), eq(trustRuleSchema.actionId, 'gmail.send')));

    expect(rule!.threshold).toBeCloseTo(0.95);
  });

  it('a replace names the trust rules, settings and files it drops', async () => {
    await appliedAndChangedInTheApp();
    const preview = await previewImport(A, zipFiles({ 'workspace.yaml': MANIFEST, 'agents/docs-writer.yaml': 'slug: docs-writer\nname: Docs Writer\nsystemPrompt: You keep the docs true.\n' }), { replace: true });
    const named = preview.changes.map(c => `${c.resource}:${c.slug}:${c.outcome}`);

    expect(named).toEqual(expect.arrayContaining(['trustRules:gmail.send:retired', 'trustRules:gmail.draft:retired', 'settings:plugins:updated', 'settings:voice.yaml:updated', 'files:pages/overview.md:retired', 'files:brand.yaml:retired']));
  });

  it('a replace reviewed, then the workspace changed: asked to review again, and what changed is kept', async () => {
    await appliedAndChangedInTheApp();
    const upload = zipFiles({ 'workspace.yaml': MANIFEST, 'agents/docs-writer.yaml': 'slug: docs-writer\nname: Docs Writer\nsystemPrompt: You keep the docs true.\n' });
    const preview = await previewImport(A, upload, { replace: true });
    // Hired after the review: the review never named it, so the replace may not retire it.
    await db.insert(agentSchema).values({ orgId: A, projectId: A, slug: 'late-hire', name: 'Late hire', systemPrompt: 'You arrived after the review.', role: 'lead', initiative: 'normal', harnessConfig: {} });

    expect((await refusal(applyImport(A, upload, { replace: true, sha: preview.sha, appliedBy: 'vitest' }))).code).toBe('CHANGED');
    expect(await liveAgents(A)).toContain('late-hire');
  });
});

describe('an owner is someone who can open the workspace', () => {
  it('answers the same for an email nobody has and one that belongs to another company, and stores no owner', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct_kestrel_other', name: 'Kestrel Capital', slug: 'kestrel-capital' } as never);
    await db.insert(schema.userSchema).values([
      { id: 'usr_kestrel_dana', name: 'Dana', email: 'dana@kestrel.example' },
      { id: 'usr_cobalt_riley', name: 'Riley', email: 'riley@cobalt.example' },
    ]);
    await db.insert(schema.accountMembershipSchema).values([
      { accountId: 'acct_kestrel_other', userId: 'usr_kestrel_dana', role: 'admin' },
      { accountId: ACCOUNT, userId: 'usr_cobalt_riley', role: 'member' },
    ]);
    const owned = (email: string) => zipFiles({ 'workspace.yaml': `version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\naccountableUser: ${email}\n` });
    const said = async (email: string) => (await previewImport(B, owned(email), { replace: true })).errors.map(e => ({ ...e, message: e.message.replace(email, '<email>') }));

    const elsewhere = await said('dana@kestrel.example');

    expect(elsewhere).toEqual(await said('nobody@kestrel.example'));
    expect(elsewhere).toEqual([{ resource: 'workspace', slug: 'workspace.yaml', message: expect.stringContaining('is not a member of this workspace') }]);

    const preview = await previewImport(B, owned('dana@kestrel.example'), { replace: true });
    await applyImport(B, owned('dana@kestrel.example'), { replace: true, sha: preview.sha, appliedBy: 'vitest' });

    expect((await db.select().from(projectSchema).where(eq(projectSchema.id, B)))[0]!.accountableUserId).toBeNull();

    // Someone in the workspace's own account resolves as before.
    const mine = await previewImport(B, owned('riley@cobalt.example'), { replace: true });

    expect(mine.errors).toEqual([]);

    await applyImport(B, owned('riley@cobalt.example'), { replace: true, sha: mine.sha, appliedBy: 'vitest' });

    expect((await db.select().from(projectSchema).where(eq(projectSchema.id, B)))[0]!.accountableUserId).toBe('usr_cobalt_riley');
  });
});

describe('what an import may not set', () => {
  const MANIFEST = 'version: 1\norgId: proj_somewhere_else\nname: Cobalt Works\n';
  const agent = (slug: string, harness: string) => `slug: ${slug}\nname: ${slug}\nsystemPrompt: You help.\nharness:\n${harness}`;

  it('refuses an agent put on AgentCore, by name, and applies nothing', async () => {
    const upload = zipFiles({
      'workspace.yaml': MANIFEST,
      'agents/managed.yaml': agent('managed', '  runsOn: aws-managed-harness\n'),
      'agents/container.yaml': agent('container', '  runsOn: agentcore-container\n'),
      'agents/on-bedrock.yaml': agent('on-bedrock', '  modelProvider: bedrock\n'),
      'agents/here.yaml': agent('here', '  runsOn: in-process\n'),
      'agents/outside.yaml': agent('outside', '  runsOn: external-worker\n'),
    });
    const preview = await previewImport(B, upload, { replace: true });

    expect(preview.refused.map(r => `${r.resource}:${r.slug}`).sort()).toEqual(['agents:container', 'agents:managed', 'agents:on-bedrock']);
    expect(preview.refused.find(r => r.slug === 'managed')!.message).toContain('harness.runsOn "aws-managed-harness"');
    expect(preview.refused.find(r => r.slug === 'on-bedrock')!.message).toContain('harness.modelProvider "bedrock"');

    expect((await refusal(applyImport(B, upload, { replace: true, sha: preview.sha, appliedBy: 'vitest' }))).code).toBe('REFUSED');
    expect(await liveAgents(B)).toEqual([]);
  });

  it('leaves an agent where an operator put it: only a change is judged', async () => {
    await appliedAndChangedInTheApp();
    await db.update(agentSchema).set({ harnessConfig: { runsOn: 'agentcore-container' } }).where(and(eq(agentSchema.orgId, A), eq(agentSchema.slug, 'docs-writer')));
    const preview = await previewImport(A, zipFiles({ 'workspace.yaml': MANIFEST, 'agents/docs-writer.yaml': agent('docs-writer', '  runsOn: agentcore-container\n') }));

    expect(preview.refused).toEqual([]);
  });

  it('refuses a connector pointed at the server\'s disk outside its folder, and warns about one that will read nothing', async () => {
    const source = (slug: string, directory: string) => `slug: ${slug}\nname: ${slug}\nkind: local-files\nconfig:\n  directory: ${JSON.stringify(directory)}\n`;
    const upload = zipFiles({
      'workspace.yaml': MANIFEST,
      'sources/absolute.yaml': source('absolute', '/etc'),
      'sources/climbs.yaml': source('climbs', '../../../../etc'),
      'sources/notes.yaml': source('notes', 'data/notes'),
    });
    const preview = await previewImport(B, upload, { replace: true });

    expect(preview.refused.map(r => `${r.resource}:${r.slug}`).sort()).toEqual(['sources:absolute', 'sources:climbs']);
    expect(preview.warnings.filter(w => w.resource === 'source').map(w => w.slug)).toEqual(['notes']);
    expect((await refusal(applyImport(B, upload, { replace: true, sha: preview.sha, appliedBy: 'vitest' }))).code).toBe('REFUSED');
    expect(await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, B))).toEqual([]);
  });
});

describe('upsertMerge', () => {
  it('keeps what only the workspace has, takes the upload\'s values, and adds to lists', () => {
    expect(upsertMerge(
      { name: 'Here', plugins: ['wiki'], defaults: { model: 'a', timezone: 'UTC' } },
      { name: 'There', plugins: ['proposals'], defaults: { model: 'b' } },
    )).toEqual({ name: 'There', plugins: ['wiki', 'proposals'], defaults: { model: 'b', timezone: 'UTC' } });
  });

  it('merges a list of rules or kinds item by item, on what each is about', () => {
    expect(upsertMerge(
      { rules: [{ action: 'gmail.send', autoApproveAbove: 0.99, enabled: false }, { action: 'hubspot.update', autoApproveAbove: 0.9, enabled: true }] },
      { rules: [{ action: 'gmail.send', autoApproveAbove: 0.95, enabled: false }, { action: 'gmail.draft', autoApproveAbove: 0.8, enabled: true }] },
    )).toEqual({ rules: [
      { action: 'gmail.send', autoApproveAbove: 0.95, enabled: false },
      { action: 'hubspot.update', autoApproveAbove: 0.9, enabled: true },
      { action: 'gmail.draft', autoApproveAbove: 0.8, enabled: true },
    ] });
  });
});
