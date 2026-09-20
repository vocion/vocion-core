/**
 * A mission and a playbook edited as artifacts, against PGlite and a scratch
 * workspace — the whole loop the pane, the tools and the applier share.
 *
 * What has to hold: the file is written FIRST and the version comes out of
 * it; the applier's own mirror step adds nothing after; a refused load puts
 * the file back; a stale save is refused; a restore writes forward; an
 * agent's edit waits for a person by default, then executes and undoes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, artifactVersionSchema, missionSchema, playbookSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const { applyWorkspace, loadWorkspace } = await import('@/libs/workspace');
const { listArtifactVersions } = await import('@/services/ArtifactService');
const { executeAction, proposeAction, undoAction } = await import('@/services/ActionService');
const { ensureSourceArtifact, getSourceArtifact, restoreWorkspaceSource, writeWorkspaceSource } = await import('./WorkspaceSourceService');
const { workspaceWriteMissionAction } = await import('@/libs/actions/workspace-source');
const { readMissionTool, writePlaybookTool } = await import('@/services/agents/tools/workspaceSource');

const ORG = 'org_source_edit';
const MISSION = 'slug: keep-main-releasable\nname: Keep main releasable\ngoal: Every merge to main ships.\nagent: release-lead\nsuccessCriteria:\n  - main is green at 09:00\n';
const PLAYBOOK = '---\nslug: house-style\nname: House style\ndescription: How we write.\n---\n\n# House style\n\nShort sentences.\n';
const SKILL = '---\nslug: triage\nname: Triage\ndescription: Sort the inbox.\nplaybooks: [house-style]\n---\n\n# Triage\n\nRead, sort, reply.\n';

let dir: string;
const envBefore = process.env.WORKSPACE_PATH;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-source-edit-'));
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: source-edit\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'release-lead.yaml'), 'slug: release-lead\nname: Release lead\nsystemPrompt: Ship.\n');
  mkdirSync(join(dir, 'missions'));
  writeFileSync(join(dir, 'missions', 'keep-main-releasable.yaml'), MISSION);
  mkdirSync(join(dir, 'playbooks', 'house-style'), { recursive: true });
  writeFileSync(join(dir, 'playbooks', 'house-style', 'SKILL.md'), PLAYBOOK);
  mkdirSync(join(dir, 'skills', 'triage'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'triage', 'SKILL.md'), SKILL);
  process.env.WORKSPACE_PATH = dir;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(async () => {
  if (envBefore === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = envBefore;
  }
  rmSync(dir, { recursive: true, force: true });
  await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
  await db.delete(artifactVersionSchema).where(eq(artifactVersionSchema.orgId, ORG));
  await db.delete(artifactSchema).where(eq(artifactSchema.orgId, ORG));
  await db.delete(missionSchema).where(eq(missionSchema.orgId, ORG));
  await db.delete(playbookSchema).where(eq(playbookSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

const missionFile = () => readFileSync(join(dir, 'missions', 'keep-main-releasable.yaml'), 'utf8');
const versionsOf = async (id: number) => (await listArtifactVersions({ orgId: ORG, artifactId: id, limit: 50 })).map(v => ({ version: v.version, authorKind: v.authorKind, changeSummary: v.changeSummary }));
const applies = async () => (await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG))).length;
const missionGoal = async () => (await db.select({ goal: missionSchema.goal }).from(missionSchema).where(and(eq(missionSchema.orgId, ORG), eq(missionSchema.slug, 'keep-main-releasable'))))[0]?.goal;

describe('the applier mirrors every mission, skill and playbook', () => {
  it('creates one source artifact per file at v1, and a second apply adds nothing', async () => {
    const first = await applyWorkspace(loadWorkspace(dir), { orgId: ORG });

    expect(first.errors).toEqual([]);

    const mission = await getSourceArtifact(ORG, 'mission', 'keep-main-releasable');
    const playbook = await getSourceArtifact(ORG, 'playbook', 'house-style');
    const skill = await getSourceArtifact(ORG, 'skill', 'triage');

    expect(mission).toMatchObject({ kind: 'mission', title: 'Keep main releasable', folder: 'workspace/missions', currentVersion: 1, recordType: 'mission', recordId: 'keep-main-releasable', recordRole: 'source' });
    expect(mission!.spec).toEqual({ slug: 'keep-main-releasable', yaml: MISSION });
    expect(playbook).toMatchObject({ kind: 'playbook', title: 'House style', folder: 'workspace/playbooks', currentVersion: 1 });
    expect(playbook!.spec).toEqual({ slug: 'house-style', kind: 'playbook', md: PLAYBOOK });
    expect(skill).toMatchObject({ kind: 'playbook', title: 'Triage', folder: 'workspace/skills', recordType: 'playbook', recordId: 'triage' });
    expect(skill!.spec).toMatchObject({ kind: 'skill' });

    await applyWorkspace(loadWorkspace(dir), { orgId: ORG });

    expect((await getSourceArtifact(ORG, 'mission', 'keep-main-releasable'))!.currentVersion).toBe(1);
    expect(await versionsOf(mission!.id)).toEqual([{ version: 1, authorKind: 'system', changeSummary: expect.stringMatching(/^Applied from the workspace/) }]);
  });

  it('ensureSourceArtifact returns the mirror the applier made, and makes one from disk when none exists', async () => {
    const existing = await ensureSourceArtifact(ORG, 'mission', 'keep-main-releasable');

    expect(existing!.currentVersion).toBe(1);

    // A file the applier never saw — the page still gets its pane.
    writeFileSync(join(dir, 'missions', 'late.yaml'), 'slug: late\nname: Late\ngoal: Arrive.\nagent: release-lead\n');
    const late = await ensureSourceArtifact(ORG, 'mission', 'late');

    expect(late).toMatchObject({ kind: 'mission', title: 'Late', currentVersion: 1 });
    expect(await versionsOf(late!.id)).toEqual([{ version: 1, authorKind: 'system', changeSummary: 'Mirrored from the workspace file' }]);
    expect(await ensureSourceArtifact(ORG, 'mission', 'nobody-ships-this')).toBeNull();
  });
});

describe('a person\'s save', () => {
  it('writes the file first, then a version under their name, then applies — and the applier finds nothing to add', async () => {
    const before = await applies();
    const edited = MISSION.replace('Every merge to main ships.', 'Every merge to main ships the same day.');
    const res = await writeWorkspaceSource({ orgId: ORG, kind: 'mission', slug: 'keep-main-releasable', content: edited, author: { kind: 'human', id: 'user_1' }, changeSummary: 'Edited the file by hand', ifVersion: 1 });

    expect(res.unchanged).toBe(false);
    expect(res.previousVersion).toBe(1);
    expect(res.version.version).toBe(2);
    expect(res.applied?.versionId).not.toBeNull();
    expect(missionFile()).toBe(edited);
    expect(await missionGoal()).toBe('Every merge to main ships the same day.');
    expect(await applies()).toBe(before + 1);
    expect(await versionsOf(res.artifact.id)).toEqual([
      { version: 2, authorKind: 'human', changeSummary: 'Edited the file by hand' },
      { version: 1, authorKind: 'system', changeSummary: expect.any(String) },
    ]);

    await applyWorkspace(loadWorkspace(dir), { orgId: ORG });

    expect((await getSourceArtifact(ORG, 'mission', 'keep-main-releasable'))!.currentVersion).toBe(2);
  });

  it('refuses a stale save rather than clobbering', async () => {
    await expect(writeWorkspaceSource({ orgId: ORG, kind: 'mission', slug: 'keep-main-releasable', content: `${MISSION}# stale\n`, author: { kind: 'human', id: 'user_1' }, changeSummary: 'x', ifVersion: 1 }))
      .rejects
      .toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses text the schema refuses and leaves the file alone', async () => {
    const was = missionFile();

    await expect(writeWorkspaceSource({ orgId: ORG, kind: 'mission', slug: 'keep-main-releasable', content: 'slug: keep-main-releasable\nname: no goal\n', author: { kind: 'human', id: 'user_1' }, changeSummary: 'x' }))
      .rejects
      .toMatchObject({ code: 'INVALID', message: expect.stringMatching(/goal/) });

    expect(missionFile()).toBe(was);
  });

  it('puts the file back when the whole workspace no longer loads', async () => {
    const was = readFileSync(join(dir, 'playbooks', 'house-style', 'SKILL.md'), 'utf8');
    // A token off the allowlist stops the load (template-vars) — the kind of
    // mistake that is invisible in the file and fatal at runtime.
    const bad = `${PLAYBOOK}\nFetch {{env.NOT_ALLOWLISTED}} first.\n`;

    await expect(writeWorkspaceSource({ orgId: ORG, kind: 'playbook', slug: 'house-style', content: bad, author: { kind: 'human', id: 'user_1' }, changeSummary: 'x' }))
      .rejects
      .toMatchObject({ code: 'INVALID' });

    expect(readFileSync(join(dir, 'playbooks', 'house-style', 'SKILL.md'), 'utf8')).toBe(was);
    expect((await getSourceArtifact(ORG, 'playbook', 'house-style'))!.currentVersion).toBe(1);
  });

  it('a new playbook that fails to load is removed again, folder and all', async () => {
    await expect(writeWorkspaceSource({ orgId: ORG, kind: 'playbook', slug: 'ghost', content: '---\nslug: ghost\nname: Ghost\ndescription: d\n---\n\n{{env.NOT_ALLOWLISTED}}\n', author: { kind: 'human', id: 'user_1' }, changeSummary: 'x' }))
      .rejects
      .toMatchObject({ code: 'INVALID' });

    expect(existsSync(join(dir, 'playbooks', 'ghost'))).toBe(false);
  });

  it('an identical save changes nothing and applies nothing', async () => {
    const before = await applies();
    const res = await writeWorkspaceSource({ orgId: ORG, kind: 'mission', slug: 'keep-main-releasable', content: missionFile(), author: { kind: 'human', id: 'user_1' }, changeSummary: 'x' });

    expect(res.unchanged).toBe(true);
    expect(await applies()).toBe(before);
  });

  it('restores an older version by writing it forward — to the file and as a new head', async () => {
    const mirror = (await getSourceArtifact(ORG, 'mission', 'keep-main-releasable'))!;
    const res = await restoreWorkspaceSource({ orgId: ORG, id: mirror.id, version: 1, author: { kind: 'human', id: 'user_1' } });

    expect(res.version.version).toBe(3);
    expect(missionFile()).toBe(MISSION);
    expect(await missionGoal()).toBe('Every merge to main ships.');
    expect((await versionsOf(mirror.id))[0]).toEqual({ version: 3, authorKind: 'human', changeSummary: 'Restored v1' });
  });
});

describe('an agent\'s edit', () => {
  const principal = { kind: 'agent' as const, id: 'agent:release-lead', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 as const };

  it('waits for a person by default, carries the diff on its card, then executes and undoes', async () => {
    const edited = MISSION.replace('Every merge to main ships.', 'Every merge to main ships within the hour.');
    const proposed = await proposeAction({
      orgId: ORG,
      actionId: 'workspace.write_mission',
      input: { slug: 'keep-main-releasable', content: edited, reason: 'The team asked for an hourly bar.' },
      principal,
      invokedBy: 'agent:release-lead',
      proposal: { confidence: 0.97, rationale: 'asked for', suggestedDecision: 'approve', suggestedDecisionReason: 'The team asked.' },
    });

    // Reversible and internal, and still held: medium risk by default.
    expect(proposed.status).toBe('pending');
    expect(missionFile()).toBe(MISSION);

    const card = await workspaceWriteMissionAction.reviewCard!({ orgId: ORG }, { slug: 'keep-main-releasable', content: edited, reason: 'r' });

    expect(card.title).toBe('Revise mission: Keep main releasable');
    expect(card.fields.find(f => f.label === 'Change')?.value).toMatch(/^−1 \/ \+1 lines, replaces v3$/);
    expect(card.fields.find(f => f.label === 'Diff')?.value).toContain('- goal: Every merge to main ships.');
    expect(card.fields.find(f => f.label === 'Diff')?.value).toContain('+ goal: Every merge to main ships within the hour.');

    const done = await executeAction(proposed.runId, ORG, { reviewedBy: 'user_2' });

    expect(done.status).toBe('done');
    expect(missionFile()).toBe(edited);
    expect(await missionGoal()).toBe('Every merge to main ships within the hour.');

    const mirror = (await getSourceArtifact(ORG, 'mission', 'keep-main-releasable'))!;

    expect(mirror.currentVersion).toBe(4);
    expect((await versionsOf(mirror.id))[0]).toEqual({ version: 4, authorKind: 'agent', changeSummary: 'The team asked for an hourly bar.' });

    const undone = await undoAction(proposed.runId, ORG, { by: 'user_2' });

    expect(undone.status).toBe('undone');
    expect(missionFile()).toBe(MISSION);
    expect((await getSourceArtifact(ORG, 'mission', 'keep-main-releasable'))!.currentVersion).toBe(5);
  });

  it('is refused before a card exists when the file does not validate', async () => {
    await expect(proposeAction({
      orgId: ORG,
      actionId: 'workspace.write_mission',
      input: { slug: 'keep-main-releasable', content: 'slug: keep-main-releasable\nname: X\n', reason: 'r' },
      principal,
      invokedBy: 'agent:release-lead',
      proposal: { confidence: 0.9, rationale: 'r', suggestedDecision: 'approve', suggestedDecisionReason: 'r' },
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/goal/) });
  });

  it('the tools read the file the page is about and report a pending write honestly', async () => {
    const emitted: unknown[] = [];
    const ctx = {
      orgId: ORG,
      agentSlug: 'release-lead',
      pageContext: { path: '/dashboard/missions/keep-main-releasable', title: 'Keep main releasable', record: { type: 'mission' as const, id: 'keep-main-releasable' } },
      emit: (e: unknown) => emitted.push(e),
    } as never;
    const read = await readMissionTool(ctx).invoke({});

    expect(read).toContain('# mission keep-main-releasable');
    expect(read).toContain('goal: Every merge to main ships.');

    const pbCtx = { ...(ctx as object), pageContext: { path: '/dashboard/skills/triage', title: 'Triage', record: { type: 'playbook', id: 'triage' } } } as never;
    const receipt = await writePlaybookTool(pbCtx).invoke({ content: SKILL.replace('Read, sort, reply.', 'Read, sort, reply, file.'), reason: 'Add filing.', confidence: 0.9 });

    expect(receipt).toMatch(/PENDING a person's decision/);
    expect(receipt).toMatch(/Do NOT say the playbook was changed/);
    expect(readFileSync(join(dir, 'skills', 'triage', 'SKILL.md'), 'utf8')).toBe(SKILL);
    expect(emitted).toHaveLength(1);
  });
});
