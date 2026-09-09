/**
 * Warn when a workspace apply empties one of an agent's authored lists
 * (VEERIO-252 item 3). An apply from a branch that is simply missing the
 * agent's playbook/skill/object-type/learning-step files — rather than one
 * that deliberately cleared the list — used to silently write
 * `playbookSlugs: [] ` (etc.) over a non-empty list with nothing but
 * `updated=1` to show for it. These tests pin that a warning naming the
 * agent and the emptied list(s) is produced, both in the returned
 * `ApplyResult.warnings` and on stderr via `console.warn`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_emptied_agent_lists';
const SLUG = 'probe-agent';

const dirs: string[] = [];

/**
 * A one-agent workspace. `playbooks` and `learningSteps` are the two list
 * fields exercised here — `playbooks` because it needs a real SKILL.md
 * folder to resolve (proving the wiring reaches a real authored resource,
 * not just a made-up string), `learningSteps` because it needs none (no
 * cross-reference validation at load time for that field), which keeps
 * most of these fixtures to one file.
 * @param opts
 * @param opts.playbooks - Playbook slugs the agent names, or `[]`/omitted for none.
 * @param opts.learningSteps - Learning step names the agent names, or `[]`/omitted for none.
 * @param opts.includePlaybookFolder - Whether to write the `playbooks/house-style/SKILL.md` file `playbooks: [house-style]` needs to resolve.
 */
function writeFixture(opts: { playbooks?: string[]; learningSteps?: string[]; includePlaybookFolder?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-emptied-lists-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: emptied-lists\n`);
  mkdirSync(join(dir, 'agents'));
  const playbooksLine = opts.playbooks?.length ? `playbooks: [${opts.playbooks.join(', ')}]\n` : '';
  const learningStepsLine = opts.learningSteps?.length ? `learningSteps: [${opts.learningSteps.join(', ')}]\n` : '';
  writeFileSync(
    join(dir, 'agents', `${SLUG}.yaml`),
    `slug: ${SLUG}\nname: Probe Agent\nsystemPrompt: Be helpful.\n${playbooksLine}${learningStepsLine}`,
  );
  if (opts.includePlaybookFolder) {
    mkdirSync(join(dir, 'playbooks', 'house-style'), { recursive: true });
    writeFileSync(
      join(dir, 'playbooks', 'house-style', 'SKILL.md'),
      '---\nslug: house-style\nname: House Style\ndescription: test fixture playbook\n---\n\nBody.\n',
    );
  }
  return dir;
}

async function apply(opts: { playbooks?: string[]; learningSteps?: string[]; includePlaybookFolder?: boolean }) {
  const loaded = await loadWorkspace(writeFixture(opts));
  return applyWorkspace(loaded, { orgId: ORG });
}

async function storedAgent() {
  const [row] = await db
    .select({ playbookSlugs: agentSchema.playbookSlugs, learningSteps: agentSchema.learningSteps })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, SLUG)));
  return row;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('workspace apply — emptied agent lists', () => {
  it('warns, naming the agent and the list, when an apply drops all of an agent\'s playbooks', async () => {
    await apply({ playbooks: ['house-style'], includePlaybookFolder: true });

    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      resource: 'agent',
      slug: SLUG,
      message: expect.stringContaining('playbookSlugs'),
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(SLUG));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('playbookSlugs'));
    expect((await storedAgent())?.playbookSlugs).toEqual([]);
  });

  it('names every list that emptied, not just one, when several drop at once', async () => {
    await apply({ playbooks: ['house-style'], learningSteps: ['alpha', 'beta'], includePlaybookFolder: true });

    const result = await apply({ playbooks: [], learningSteps: [] });

    const warning = result.warnings.find(w => w.slug === SLUG);

    expect(warning?.message).toContain('playbookSlugs');
    expect(warning?.message).toContain('learningSteps');
  });

  it('does not warn when only one list empties and the other stays untouched', async () => {
    await apply({ playbooks: ['house-style'], learningSteps: ['alpha'], includePlaybookFolder: true });

    const result = await apply({ playbooks: [], learningSteps: ['alpha'] });

    const warning = result.warnings.find(w => w.slug === SLUG);

    expect(warning?.message).toContain('playbookSlugs');
    expect(warning?.message).not.toContain('learningSteps');
  });

  it('does not warn on the first apply, when the list was never non-empty', async () => {
    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.warnings).toHaveLength(0);
    // console.warn may still fire for unrelated reasons (e.g. the schedule
    // reconciliation ownership guard on a dev box) — assert specifically
    // that no "emptied" warning was produced, not that warn was never called.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('emptied'));
  });

  it('does not warn when a re-apply changes nothing (unchanged, not updated)', async () => {
    await apply({ playbooks: [], learningSteps: [] });

    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.counts.agents).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(result.warnings).toHaveLength(0);
  });

  it('does not warn when a list goes from empty to non-empty', async () => {
    await apply({ playbooks: [], learningSteps: [] });

    const result = await apply({ playbooks: ['house-style'], learningSteps: [], includePlaybookFolder: true });

    expect(result.counts.agents).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(result.warnings).toHaveLength(0);
  });
});
