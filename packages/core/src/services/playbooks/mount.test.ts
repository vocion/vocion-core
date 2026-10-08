/**
 * Skill/playbook mounting — the failure this covers is invisible by design.
 *
 * When a SKILL.md cannot be located, `mountSkills` skips the folder without
 * erroring, so the agent simply never sees the file and writes from nothing.
 * That is what happened with an ABSOLUTE `WORKSPACE_PATH`: prod sets
 * `/workspace/metacto-revenue` against an `/app` workdir, and joining it onto
 * cwd produced `/app/workspace/...`, which does not exist.
 *
 * Mounting is BY NAME: an agent's skills list, its playbooks list, and each
 * mounted skill's attached playbooks. Nothing mounts by tag.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/libs/Logger';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { playbookSchema, workspaceFileSchema } = await import('@/models/Schema');
const { mountSkills, readByOrigin } = await import('./mount');

const ORG = 'org_playbooks';

/** A workspace on disk with one skill + one playbook in it. */
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-ws-'));
const WORKSPACE = join(ROOT, 'workspace', 'acme');
const SKILL_BODY = '# Write a lead brief\n\nResearch one lead.\n';
const PLAYBOOK_BODY = '# House style\n\nWrite plainly.\n';

mkdirSync(join(WORKSPACE, 'skills', 'write-lead-brief'), { recursive: true });
// The manifest names this project, so the folder is its own: a project with
// nothing stored reads its OWN folder and no other (see the last describe).
writeFileSync(join(WORKSPACE, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: acme\n`);
writeFileSync(join(WORKSPACE, 'skills', 'write-lead-brief', 'SKILL.md'), SKILL_BODY);
writeFileSync(join(WORKSPACE, 'skills', 'write-lead-brief', 'examples.md'), 'an example');
// A skill authored the way every Vocion workspace (and this repo's own base
// pack) authors one: `slug` is the identity, `name` is a human label. The
// Agent Skills spec deepagents enforces expects `name` to BE the identity, so
// the mount rewrites it — see libs/skills/name.ts.
const NAMED_SKILL_BODY = [
  '---',
  'slug: queue-health',
  'name: Queue Health',
  'description: >-',
  '  Report on the review queue as a process.',
  'version: 1',
  '---',
  '',
  '# Queue health',
  '',
  'Read the queue.',
].join('\n');
mkdirSync(join(WORKSPACE, 'skills', 'queue-health'), { recursive: true });
writeFileSync(join(WORKSPACE, 'skills', 'queue-health', 'SKILL.md'), NAMED_SKILL_BODY);
mkdirSync(join(WORKSPACE, 'playbooks', 'house-style'), { recursive: true });
writeFileSync(join(WORKSPACE, 'playbooks', 'house-style', 'SKILL.md'), PLAYBOOK_BODY);
// Two awkward but perfectly legal filenames living inside the playbook
// folder. Both look like escapes to a naive string check and are not.
writeFileSync(join(WORKSPACE, 'playbooks', 'house-style', '..notes.md'), 'notes that start with two dots');
writeFileSync(join(WORKSPACE, 'playbooks', 'house-style', '..%2f..%2f.env'), 'a file whose name merely looks encoded');

/**
 * Fixtures for the path-containment guard (vocion-core#108): a secret
 * sitting outside every playbook/skill folder, and a sibling folder whose
 * name merely starts with the real one's name — the classic prefix-match
 * trap a naive `candidate.startsWith(base)` check would fall for.
 */
const TRAVERSAL_SECRET = 'DB_PASSWORD=leaked-if-the-guard-is-missing\n';
writeFileSync(join(ROOT, '.env'), TRAVERSAL_SECRET);
const ABSOLUTE_SECRET_PATH = join(ROOT, 'outside-workspace-entirely.env');
writeFileSync(ABSOLUTE_SECRET_PATH, TRAVERSAL_SECRET);
mkdirSync(join(WORKSPACE, 'playbooks', 'house-style-evil'), { recursive: true });
writeFileSync(join(WORKSPACE, 'playbooks', 'house-style-evil', 'secret.txt'), TRAVERSAL_SECRET);

/**
 * A symlink sitting inside the real playbook folder but pointing at the
 * secret outside it. The path we build by hand looks perfectly contained,
 * so only resolving the link exposes the escape. A tenant's workspace is
 * a git checkout, and git happily carries symlinks.
 */
symlinkSync(join(ROOT, '.env'), join(WORKSPACE, 'playbooks', 'house-style', 'linked-secret.md'));

/** A second workspace whose playbook names a per-deployment API URL. */
const TEMPLATED_WORKSPACE = join(ROOT, 'workspace', 'templated');
mkdirSync(join(TEMPLATED_WORKSPACE, 'playbooks', 'house-style'), { recursive: true });
writeFileSync(join(TEMPLATED_WORKSPACE, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: templated\n`);
writeFileSync(
  join(TEMPLATED_WORKSPACE, 'playbooks', 'house-style', 'SKILL.md'),
  '# House style\n\nFetch {{env.LARKFIELD_API_URL}}/api/sources.\n',
);
mkdirSync(join(TEMPLATED_WORKSPACE, 'skills', 'pipeline-health'), { recursive: true });
writeFileSync(
  join(TEMPLATED_WORKSPACE, 'skills', 'pipeline-health', 'SKILL.md'),
  '# Pipeline health\n\nCall {{env.LARKFIELD_API_URL}}/api/pipeline.\n',
);

const ORIGINAL_PATH = process.env.WORKSPACE_PATH;
const ORIGINAL_ALLOWLIST = process.env.WORKSPACE_TEMPLATE_VARS;
const ORIGINAL_API_URL = process.env.LARKFIELD_API_URL;

beforeEach(async () => {
  await db.delete(playbookSchema);
  await db.insert(playbookSchema).values([
    {
      orgId: ORG,
      slug: 'write-lead-brief',
      name: 'Write a lead brief',
      description: 'Research one lead and produce one concise decision brief.',
      kind: 'skill',
      origin: 'workspace',
      attachedPlaybooks: ['house-style'],
      contentSha: 'sha-write-lead-brief',
      sourceFiles: ['examples.md'],
    },
    {
      orgId: ORG,
      slug: 'queue-health',
      name: 'Queue Health',
      description: 'Report on the review queue as a process.',
      kind: 'skill',
      origin: 'workspace',
      contentSha: 'sha-queue-health',
      sourceFiles: [],
    },
    {
      orgId: ORG,
      slug: 'house-style',
      name: 'House style',
      description: 'How we write.',
      kind: 'playbook',
      origin: 'workspace',
      contentSha: 'sha-house-style',
      sourceFiles: [],
    },
    {
      orgId: ORG,
      slug: 'pipeline-health',
      name: 'Pipeline health',
      description: 'A base-pack skill the workspace also carries a copy of.',
      kind: 'skill',
      origin: 'override',
      contentSha: 'sha-pipeline-health',
      sourceFiles: [],
    },
  ]);
});

/**
 * Put one env var back the way the test process found it.
 * @param name - the variable to restore.
 * @param original - its value before the test touched it, or undefined.
 */
function restoreEnvVar(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

afterEach(() => {
  restoreEnvVar('WORKSPACE_PATH', ORIGINAL_PATH);
  restoreEnvVar('WORKSPACE_TEMPLATE_VARS', ORIGINAL_ALLOWLIST);
  restoreEnvVar('LARKFIELD_API_URL', ORIGINAL_API_URL);
});

afterAll(async () => {
  await db.delete(playbookSchema);
  await db.delete(workspaceFileSchema);
  restoreEnvVar('WORKSPACE_PATH', ORIGINAL_PATH);
  restoreEnvVar('WORKSPACE_TEMPLATE_VARS', ORIGINAL_ALLOWLIST);
  restoreEnvVar('LARKFIELD_API_URL', ORIGINAL_API_URL);
  rmSync(ROOT, { recursive: true, force: true });
});

describe('mountSkills', () => {
  it('mounts a named skill (with siblings) when WORKSPACE_PATH is absolute, which is what prod sets', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files['/skills/write-lead-brief/SKILL.md']).toBe(SKILL_BODY);
    expect(files['/skills/write-lead-brief/examples.md']).toBe('an example');
  });

  it('hands deepagents a spec-compliant `name` without touching the body', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['queue-health'], playbookSlugs: [] });
    const mounted = files['/skills/queue-health/SKILL.md']!;

    // `name` is the slug, which is what the Agent Skills validator reads and
    // what stopped it warning on every turn.
    expect(mounted).toContain('name: queue-health');
    // The human label survives, so nothing that reads the catalog loses it.
    expect(mounted).toContain('title: Queue Health');
    // Everything else, including the markdown, is byte-for-byte as authored.
    expect(mounted).toContain('description: >-');
    expect(mounted).toContain('# Queue health\n\nRead the queue.');
  });

  it('a mounted skill pulls its attached playbooks along', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files['/playbooks/house-style/SKILL.md']).toBe(PLAYBOOK_BODY);
  });

  it('an agent naming nothing mounts nothing, whatever the org has', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });

  it('a playbook named by the agent mounts without any skill', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(Object.keys(files)).toEqual(['/playbooks/house-style/SKILL.md']);
  });

  it('skips silently when the file is missing on disk', async () => {
    process.env.WORKSPACE_PATH = join(ROOT, 'nowhere');

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });

  it('resolves an {{env.NAME}} token before the agent ever sees the body', async () => {
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'LARKFIELD_API_URL';
    process.env.LARKFIELD_API_URL = 'https://api-dev.larkfield.example';

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(files['/playbooks/house-style/SKILL.md']).toContain('https://api-dev.larkfield.example/api/sources');
    expect(files['/playbooks/house-style/SKILL.md']).not.toContain('{{');
  });

  it('refuses to mount rather than serve a raw token when the variable is missing', async () => {
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'LARKFIELD_API_URL';
    delete process.env.LARKFIELD_API_URL;

    await expect(
      mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] }),
    ).rejects.toThrow(/LARKFIELD_API_URL/);
  });

  it('an override row whose workspace copy has an unresolvable token fails instead of quietly serving the base copy', async () => {
    // The base pack has a pipeline-health skill, so a silent fallback
    // here would hand the agent the WRONG body and look like success.
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'LARKFIELD_API_URL';
    delete process.env.LARKFIELD_API_URL;

    await expect(
      mountSkills({ orgId: ORG, skillSlugs: ['pipeline-health'], playbookSlugs: [] }),
    ).rejects.toThrow(/LARKFIELD_API_URL/);
  });

  it('falls back to the base copy when the workspace file is simply absent', async () => {
    process.env.WORKSPACE_PATH = join(ROOT, 'nowhere');

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['pipeline-health'], playbookSlugs: [] });

    expect(files['/skills/pipeline-health/SKILL.md']).toContain('pipeline');
  });

  it('never mounts a slug the caller did not name as the right kind', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    // Asking for the playbook as a SKILL mounts nothing: names are typed.
    const files = await mountSkills({ orgId: ORG, skillSlugs: ['house-style'], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });
});

/**
 * vocion-core#108: `readByOrigin` is the one place that turns a catalog row
 * plus a caller-supplied `rel` into a file read. Both `playbook_get` (MCP)
 * and the catalog detail pages call it, so the containment check belongs
 * here — not bolted onto just the MCP tool handler.
 */
describe('readByOrigin path containment (vocion-core#108)', () => {
  const houseStyleRow = { orgId: ORG, kind: 'playbook' as const, origin: 'workspace' as const, slug: 'house-style' };
  const writeLeadBriefRow = { orgId: ORG, kind: 'skill' as const, origin: 'workspace' as const, slug: 'write-lead-brief' };

  beforeEach(() => {
    process.env.WORKSPACE_PATH = WORKSPACE;
  });

  it('rejects a `../` resource that climbs out of the playbook folder and does not return the file it points at', async () => {
    // From workspace/acme/playbooks/house-style, four levels up lands on
    // ROOT/.env — a real secret file planted for this test. A missing
    // guard would happily hand its contents back as the tool's "body".
    const content = await readByOrigin(houseStyleRow, '../../../../.env');

    expect(content).toBeNull();
  });

  it('rejects an absolute resource path outright, even though `resolve()` would otherwise honor it', async () => {
    // `resolve(base, '/abs/path')` discards `base` and every segment before
    // it — that is standard Node path.resolve behavior, and exactly how an
    // absolute `resource` like "/etc/passwd" would have escaped pre-fix.
    const content = await readByOrigin(houseStyleRow, ABSOLUTE_SECRET_PATH);

    expect(content).toBeNull();
  });

  it('does not fall for a sibling folder whose name merely starts with the real one (prefix-match trap)', async () => {
    // "house-style-evil" starts with the string "house-style", so a naive
    // `resolvedPath.startsWith(baseDir)` check would wrongly allow this.
    // `relative()` sees it correctly as a `../` escape.
    const content = await readByOrigin(houseStyleRow, '../house-style-evil/secret.txt');

    expect(content).toBeNull();
  });

  it('refuses a symlink that sits inside the folder but points at a file outside it', async () => {
    // The hand-built path is `<house-style>/linked-secret.md`, which passes
    // a plain string containment check. Following the link is what leaks
    // ROOT/.env, so the guard has to resolve it before reading.
    const content = await readByOrigin(houseStyleRow, 'linked-secret.md');

    expect(content).toBeNull();
  });

  it('still reads a legitimate sibling resource inside the real playbook/skill folder', async () => {
    const content = await readByOrigin(writeLeadBriefRow, 'examples.md');

    expect(content).toBe('an example');
  });

  it('reads SKILL.md when the resource is the default value the MCP tool falls back to', async () => {
    // `playbook_get` computes `resource ?? 'SKILL.md'` before calling in —
    // this is what an omitted `resource` resolves to.
    const content = await readByOrigin(houseStyleRow, 'SKILL.md');

    expect(content).toBe(PLAYBOOK_BODY);
  });

  it('rejects a `../` traversal against a `core`-origin row without leaking a file from the pack directory', async () => {
    // origin: 'core' only ever builds the packFile() candidate — the base
    // pack under packages/core/templates/base. That candidate path was
    // entirely unexercised before this test; a missing guard here would
    // hand back a file from wherever four levels up from the pack folder
    // lands (repo internals), not just workspace secrets.
    const corePlaybookRow = { orgId: ORG, kind: 'playbook' as const, origin: 'core' as const, slug: 'warming-etiquette' };

    const content = await readByOrigin(corePlaybookRow, '../../../../../../etc/passwd');

    expect(content).toBeNull();
  });

  it('rejects a `../` traversal against an `override`-origin row on both the workspace and pack candidates', async () => {
    // origin: 'override' tries the workspace copy first, then falls back to
    // the same packFile() candidate as the core case above — both must
    // refuse the escape, not just whichever one happens to exist on disk.
    const overrideSkillRow = { orgId: ORG, kind: 'skill' as const, origin: 'override' as const, slug: 'pipeline-health' };

    const content = await readByOrigin(overrideSkillRow, '../../../../../../etc/passwd');

    expect(content).toBeNull();
  });

  it('rejects a resource path containing a null byte instead of letting the fs call throw unhandled', async () => {
    // realpathSync throws ERR_INVALID_ARG_VALUE (not ENOENT) on an embedded
    // null byte. Both the old and new code return null for this — a bare
    // `catch { continue }` swallows it same as ENOENT — so the return value
    // alone can't tell a reverted fix from a working one. What changed is
    // that a non-ENOENT failure now gets logged instead of vanishing
    // silently; assert that to make this test mean something.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await expect(readByOrigin(houseStyleRow, '\0')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('could not be resolved on disk'),
        expect.objectContaining({ errorCode: 'ERR_INVALID_ARG_VALUE' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('logs a non-ENOENT filesystem error (ENOTDIR here) instead of treating it as a missing file', async () => {
    // A misconfigured mount — a slug directory that is actually a plain
    // file — makes realpathSync fail with ENOTDIR, not ENOENT, when it
    // tries to descend through it to reach SKILL.md. Pre-fix this fell
    // into the same bare `catch { continue }` as a genuinely missing file
    // and never logged anything; that's the silent-degradation gap the fix
    // closes.
    mkdirSync(join(WORKSPACE, 'playbooks'), { recursive: true });
    writeFileSync(join(WORKSPACE, 'playbooks', 'not-a-folder'), 'this is a file, not a directory');
    const brokenMountRow = { orgId: ORG, kind: 'playbook' as const, origin: 'workspace' as const, slug: 'not-a-folder' };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const content = await readByOrigin(brokenMountRow, 'SKILL.md');

      expect(content).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('could not be resolved on disk'),
        expect.objectContaining({ slug: 'not-a-folder', errorCode: 'ENOTDIR' }),
      );
    } finally {
      warnSpy.mockRestore();
      rmSync(join(WORKSPACE, 'playbooks', 'not-a-folder'), { force: true });
    }
  });

  it('reads a file whose name merely looks like an encoded traversal, since nothing decodes it', async () => {
    // "..%2f..%2f.env" has no literal "/" in it — it is an odd but real
    // filename inside house-style. Returning its contents is what proves
    // no decode step exists; if someone adds one upstream, this path would
    // start climbing and the read would be refused instead.
    const content = await readByOrigin(houseStyleRow, '..%2f..%2f.env');

    expect(content).toBe('a file whose name merely looks encoded');
  });

  it('reads a file whose name begins with two dots, which is inside the folder and not an escape', async () => {
    // `relative()` returns "..notes.md" here. A plain startsWith('..')
    // check calls that an escape and refuses a legitimate file — the
    // reason this comparison is done segment by segment.
    const content = await readByOrigin(houseStyleRow, '..notes.md');

    expect(content).toBe('notes that start with two dots');
  });

  it('names the file it could not find, so a resource that never mounts is answerable from the logs', async () => {
    // A miss is the ordinary path for an override — workspace first, then
    // the base pack — so this is debug, not warn. The return value is null
    // either way, so only the log proves the file was named at all.
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    try {
      expect(await readByOrigin(houseStyleRow, 'never-written.md')).toBeNull();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('not present at this origin'),
        expect.objectContaining({ slug: 'house-style', requestedResource: 'never-written.md' }),
      );
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('refuses an empty resource path with an honest reason instead of the misleading symlink-escape message', async () => {
    // Both before and after the fix, `readByOrigin(row, '')` returns null —
    // `resolve(base, '')` is the base folder itself, and the pre-existing
    // symlink-containment check already refused that. What the fix changes
    // is *why*: pre-fix this logged "pointed outside its base directory
    // through a link", which is false (there is no link). Asserting only
    // the return value would pass on the reverted code too, so this pins
    // the log message instead — that's the actual fix.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const content = await readByOrigin(houseStyleRow, '');

      expect(content).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('is empty, refusing to read'),
        expect.objectContaining({ slug: 'house-style' }),
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('through a link'),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('refuses a whitespace-only resource path the same way as an empty one', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const content = await readByOrigin(houseStyleRow, '   ');

      expect(content).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('is empty, refusing to read'),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/**
 * Workspaces in the database, step 1: once an apply has stored a project's
 * files (`workspace_file`), they are what mounts — on a host whose
 * WORKSPACE_PATH is another folder, or none at all — and the mounted folder
 * is never consulted for that project again.
 */
describe('the project\'s stored workspace', () => {
  const STORED_BODY = '# Write a lead brief (stored)\n\nFrom the database.\n';

  /**
   * Store files for ORG the way an apply does, manifest included.
   * @param files - Path → content.
   */
  async function store(files: Record<string, string>) {
    await db.insert(workspaceFileSchema).values(
      Object.entries({ 'workspace.yaml': 'version: 1\norgId: org_playbooks\nname: acme\n', ...files })
        .map(([path, content]) => ({ orgId: ORG, path, content, sha: `sha-${path}`, workspaceSha: 'ws-sha-1' })),
    );
  }

  beforeEach(async () => {
    await db.delete(workspaceFileSchema);
  });

  it('mounts bodies and resources from the database with no WORKSPACE_PATH at all', async () => {
    delete process.env.WORKSPACE_PATH;
    await store({
      'skills/write-lead-brief/SKILL.md': STORED_BODY,
      'skills/write-lead-brief/examples.md': 'a stored example',
      'playbooks/house-style/SKILL.md': PLAYBOOK_BODY,
    });

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files).toEqual({
      '/skills/write-lead-brief/SKILL.md': STORED_BODY,
      '/skills/write-lead-brief/examples.md': 'a stored example',
      '/playbooks/house-style/SKILL.md': PLAYBOOK_BODY,
    });
  });

  it('never reads the mounted folder for a stored project — not for a file it holds, not for one it lacks', async () => {
    // The folder on WORKSPACE_PATH carries write-lead-brief AND house-style,
    // as another project's workspace on a shared host would. This project
    // stored its own write-lead-brief and no house-style.
    process.env.WORKSPACE_PATH = WORKSPACE;
    await store({ 'skills/write-lead-brief/SKILL.md': STORED_BODY });

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: ['house-style'] });

    expect(files).toEqual({ '/skills/write-lead-brief/SKILL.md': STORED_BODY });
  });

  it('resolves {{env.NAME}} tokens in stored text on the way out, and still refuses an unresolvable one', async () => {
    delete process.env.WORKSPACE_PATH;
    process.env.WORKSPACE_TEMPLATE_VARS = 'LARKFIELD_API_URL';
    process.env.LARKFIELD_API_URL = 'https://api-dev.larkfield.example';
    await store({ 'playbooks/house-style/SKILL.md': '# House style\n\nFetch {{env.LARKFIELD_API_URL}}/api/sources.\n' });

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(files['/playbooks/house-style/SKILL.md']).toBe('# House style\n\nFetch https://api-dev.larkfield.example/api/sources.\n');

    delete process.env.LARKFIELD_API_URL;

    await expect(mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] })).rejects.toThrow(/LARKFIELD_API_URL/);
  });

  it('an override the store does not hold a file for falls through to the base pack, never to the folder', async () => {
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    await store({});

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['pipeline-health'], playbookSlugs: [] });

    expect(files['/skills/pipeline-health/SKILL.md']).toContain('pipeline');
    expect(files['/skills/pipeline-health/SKILL.md']).not.toContain('{{env.');
  });

  it('readByOrigin reads the store too, and refuses a resource that climbs into another folder of it', async () => {
    delete process.env.WORKSPACE_PATH;
    await store({ 'playbooks/house-style/SKILL.md': PLAYBOOK_BODY, 'playbooks/house-style-evil/secret.txt': TRAVERSAL_SECRET });
    const row = { orgId: ORG, kind: 'playbook' as const, origin: 'workspace' as const, slug: 'house-style' };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await expect(readByOrigin(row, 'SKILL.md')).resolves.toBe(PLAYBOOK_BODY);
      await expect(readByOrigin(row, '../house-style-evil/secret.txt')).resolves.toBeNull();
      await expect(readByOrigin(row, '/etc/passwd')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('escaped its folder'), expect.objectContaining({ slug: 'house-style' }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('another project\'s stored files are never this project\'s', async () => {
    delete process.env.WORKSPACE_PATH;
    await db.insert(workspaceFileSchema).values([
      { orgId: 'org_someone_else', path: 'workspace.yaml', content: 'x', sha: 'a' },
      { orgId: 'org_someone_else', path: 'skills/write-lead-brief/SKILL.md', content: 'NOT YOURS', sha: 'b' },
    ]);
    await store({});

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files).toEqual({});
  });
});

/**
 * The fallback for a project with nothing stored reads the project's OWN
 * folder. A shared host mounts one company's workspace; a project that has
 * never been applied (a personal workspace, one an operator created by
 * script) must not mount that company's skill bodies.
 */
describe('a project with nothing stored', () => {
  const STRANGER = 'org_never_applied';

  beforeEach(async () => {
    await db.delete(workspaceFileSchema);
    await db.insert(playbookSchema).values({
      orgId: STRANGER,
      slug: 'house-style',
      name: 'House style',
      description: 'd',
      kind: 'playbook',
      origin: 'workspace',
      contentSha: 'sha-house-style',
    });
  });

  it('reads no body from a mounted folder that is another project\'s', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    await expect(mountSkills({ orgId: STRANGER, skillSlugs: [], playbookSlugs: ['house-style'] })).resolves.toEqual({});
    await expect(readByOrigin({ orgId: STRANGER, kind: 'playbook', origin: 'workspace', slug: 'house-style' }, 'SKILL.md')).resolves.toBeNull();
  });

  it('still mounts from its own folder when the store cannot be read at all', async () => {
    // A deploy serving before the store's migration ran: the table is not there.
    process.env.WORKSPACE_PATH = WORKSPACE;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await db.execute(sql`alter table workspace_file rename to workspace_file_hidden`);
    try {
      const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

      expect(files['/skills/write-lead-brief/SKILL.md']).toBe(SKILL_BODY);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.objectContaining({ orgId: ORG }));
    } finally {
      await db.execute(sql`alter table workspace_file_hidden rename to workspace_file`);
      warnSpy.mockRestore();
    }
  });
});
