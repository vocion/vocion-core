/**
 * Path containment on `workspace.readPrimitive` and `workspace.writeFile`
 * (vocion-core#266). A caller-supplied `slug` (read) or `path` (write) feeds
 * straight into a filesystem join — with no containment check, a traversal
 * value walks out of `WORKSPACE_PATH` and reads or writes anywhere the
 * process can see, including another org's workspace directory.
 *
 * `readPrimitive` needs two independent checks proven, not one:
 *   - `pathEscapesBase` catches a resolved path that lands outside its base
 *     directory, on both the agent branch and the skill/workflow/object/
 *     source directory branch.
 *   - `SLUG_PATTERN` (the schema) refuses a slug shaped like a traversal
 *     before it ever reaches a filesystem join.
 * Both are tested independently: `call()` goes straight to the handler
 * (bypassing schema validation, same as ApiTokens.test.ts) so the runtime
 * guard is what's actually under test; `parseInput()` exercises the schema
 * on its own.
 *
 * `writeFile` gets one more: its existing containment check is a string
 * comparison that never resolves symlinks, so a symlink committed inside
 * the workspace repo and pointing outside it passes that check and
 * `writeFileSync` follows it. The fix resolves real paths (mirroring
 * `services/playbooks/mount.ts`'s `readByOrigin`) before writing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A factory, not an automock: AuthGuards pulls in next-auth, which does not
// import cleanly in the unit environment. Same convention as
// ApiTokens.test.ts.
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

const { guardAuth } = await import('./AuthGuards');
const { readPrimitive, writeFile } = await import('./Workspace');

const ORG = 'org_workspace_router_test';

/**
 * Point the mocked session at a signed-in admin — neither route under test
 * branches on role, but `guardAuth` must resolve to something shaped right.
 */
function signedIn() {
  vi.mocked(guardAuth).mockResolvedValue({
    userId: 'usr-1',
    orgId: ORG,
    accountId: 'acct-1',
    projectId: ORG,
    role: 'admin',
    has: () => true,
  } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

/**
 * Call an oRPC procedure directly, bypassing the HTTP layer and the input
 * schema. A procedure keeps its implementation on the `~orpc` definition,
 * so this invokes that with the input a client would have sent — the same
 * helper `ApiTokens.test.ts` uses, chosen here so the containment guard
 * inside the handler is what each traversal test proves, independent of
 * whatever the slug pattern would have caught first.
 * @param route - The exported procedure.
 * @param input - The payload a client would have sent.
 */
function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

/**
 * Run a procedure's input schema over a payload, without calling the
 * handler — the layer that tests what the schema itself refuses or accepts.
 * @param route - The exported procedure.
 * @param input - The payload a client would have sent.
 */
function parseInput(route: unknown, input: unknown): unknown {
  const procedure = route as { '~orpc': { inputSchema: { parse: (value: unknown) => unknown } } };
  return procedure['~orpc'].inputSchema.parse(input);
}

// One org's workspace, a sibling org's workspace, and a sibling directory
// whose name merely starts with a real one — the fixtures every test below
// points a crafted slug at.
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-workspace-router-'));
const ACME = join(ROOT, 'workspace-acme');
const BETA = join(ROOT, 'workspace-beta');
const OUTSIDE = join(ROOT, 'outside-any-workspace');

mkdirSync(join(ACME, 'skills', 'real-skill'), { recursive: true });
writeFileSync(join(ACME, 'skills', 'real-skill', 'SKILL.yaml'), 'name: Real Skill\n');
writeFileSync(join(ACME, 'skills', 'real-skill', 'prompt.md'), '# Prompt\n\nDo the thing.\n');

// Sibling of "skills", named so it merely starts with the real directory's
// name — the classic prefix-match trap a naive `dir.startsWith(base)` check
// falls for ("workspace-acme/skills-evil".startsWith(".../skills") is true).
mkdirSync(join(ACME, 'skills-evil', 'real-skill'), { recursive: true });
writeFileSync(join(ACME, 'skills-evil', 'real-skill', 'leaked.yaml'), 'leaked: true\n');

mkdirSync(join(ACME, 'agents'), { recursive: true });
writeFileSync(join(ACME, 'agents', 'real-agent.yaml'), 'slug: real-agent\n');

mkdirSync(join(BETA, 'agents'), { recursive: true });
writeFileSync(join(BETA, 'agents', 'beta-secret-agent.yaml'), 'slug: beta-secret-agent\nconnector_token: leaked-if-the-guard-is-missing\n');

mkdirSync(OUTSIDE, { recursive: true });
// Something worth stealing in there, so a read that escapes is visible in
// the assertion rather than just returning an empty list.
writeFileSync(join(OUTSIDE, 'secret.yaml'), 'connector_token: leaked-through-a-symlink\n');

// A symlink sitting inside ACME's own skills folder but pointing at a
// directory entirely outside every workspace. The path `writeFile` builds
// by hand looks perfectly contained; only resolving the link exposes the
// escape.
symlinkSync(OUTSIDE, join(ACME, 'skills', 'linked-skill-dir'));

// One level down: an ordinary-looking skill folder holding a file that is
// itself a symlink out of the workspace. The folder passes every check —
// only the file escapes.
mkdirSync(join(ACME, 'skills', 'skill-with-linked-file'), { recursive: true });
symlinkSync(join(OUTSIDE, 'secret.yaml'), join(ACME, 'skills', 'skill-with-linked-file', 'SKILL.yaml'));

// Same trick on the agent branch, where the guard only ever saw the
// slug-derived prefix and never the .yaml file it went on to read.
symlinkSync(join(OUTSIDE, 'secret.yaml'), join(ACME, 'agents', 'linked-agent.yaml'));

// A symlink whose target does not exist. `existsSync` follows the link and
// answers false for this, which is exactly how it slips past a guard that
// only checks the parent directory — the write then creates the file at the
// far end of the link, outside the workspace.
mkdirSync(join(ACME, 'skills', 'dangling-link-skill'), { recursive: true });
symlinkSync(join(OUTSIDE, 'not-created-yet.md'), join(ACME, 'skills', 'dangling-link-skill', 'dangling.md'));

const ORIGINAL_WORKSPACE_PATH = process.env.WORKSPACE_PATH;

beforeEach(() => {
  process.env.WORKSPACE_PATH = ACME;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE_PATH;
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('readPrimitive — path containment', () => {
  it('rejects a traversal slug on the agent branch', async () => {
    signedIn();

    await expect(call(readPrimitive, { kind: 'agent', slug: '../../../../../../etc' }))
      .rejects
      .toThrow(/escapes workspace/);
  });

  it('rejects a traversal slug on the skill/workflow/object/source directory branch', async () => {
    signedIn();

    await expect(call(readPrimitive, { kind: 'skill', slug: '../../../../../../etc' }))
      .rejects
      .toThrow(/escapes workspace/);
  });

  it('rejects a slug that escapes into a sibling org\'s workspace directory', async () => {
    signedIn();

    // From ACME/agents, ".." twice reaches ROOT, then back down into the
    // sibling org's own agents folder — no directory listing or file read
    // ever legitimately needs to leave the caller's own workspace tree.
    await expect(call(readPrimitive, { kind: 'agent', slug: '../../workspace-beta/agents/beta-secret-agent' }))
      .rejects
      .toThrow(/escapes workspace/);
  });

  it('rejects the prefix-match trap — a sibling directory whose name merely starts with the real one', async () => {
    signedIn();

    // Resolves to ACME/skills-evil/real-skill, a directory that a
    // `dir.startsWith(kindBase)` check (kindBase = ACME/skills) would wave
    // through because "skills-evil" starts with "skills". The relative()
    // based check does not.
    await expect(call(readPrimitive, { kind: 'skill', slug: '../skills-evil/real-skill' }))
      .rejects
      .toThrow(/escapes workspace/);
  });

  it('still returns a legitimate slug\'s files unchanged', async () => {
    signedIn();
    const result = await call<{ files: Array<{ path: string; content: string; language: string }> }>(
      readPrimitive,
      { kind: 'skill', slug: 'real-skill' },
    );

    expect(result.files.map(f => f.path)).toEqual([
      'skills/real-skill/SKILL.yaml',
      'skills/real-skill/prompt.md',
    ]);
    expect(result.files.find(f => f.path.endsWith('SKILL.yaml'))?.content).toBe('name: Real Skill\n');
    expect(result.files.find(f => f.path.endsWith('prompt.md'))?.content).toBe('# Prompt\n\nDo the thing.\n');
  });

  it('still returns a legitimate agent slug\'s file unchanged', async () => {
    signedIn();
    const result = await call<{ files: Array<{ path: string; content: string }> }>(
      readPrimitive,
      { kind: 'agent', slug: 'real-agent' },
    );

    expect(result.files).toEqual([
      { path: 'agents/real-agent.yaml', content: 'slug: real-agent\n', language: 'yaml' },
    ]);
  });
});

describe('readPrimitive — symlink escape', () => {
  it('refuses to read through a symlink that sits inside the workspace but points outside it', async () => {
    // "linked-skill-dir" is an ordinary-looking slug and passes the slug
    // pattern, and the path built from it is textually inside the skills
    // folder. Only resolving the link shows it landing in OUTSIDE, so this
    // is the case a string comparison alone cannot catch.
    signedIn();

    await expect(call(readPrimitive, { kind: 'skill', slug: 'linked-skill-dir' }))
      .rejects
      .toThrow(/escapes workspace/);

    // And nothing from the linked directory came back with it.
    const outcome = await call(readPrimitive, { kind: 'skill', slug: 'linked-skill-dir' }).catch(err => err);

    expect(JSON.stringify(outcome)).not.toContain('leaked-through-a-symlink');
  });
});

describe('readPrimitive — symlinked file inside a legitimate folder', () => {
  it('refuses a skill whose file is a symlink pointing out of the workspace', async () => {
    signedIn();

    // The folder is real and contained; only SKILL.yaml inside it escapes.
    // Checking the directory alone lets this straight through.
    await expect(call(readPrimitive, { kind: 'skill', slug: 'skill-with-linked-file' }))
      .rejects
      .toThrow(/escapes workspace/);

    // Serialised, because a leak would arrive as a `content` field inside
    // the returned object — asserting on the object itself proves nothing.
    const outcome = await call(readPrimitive, { kind: 'skill', slug: 'skill-with-linked-file' }).catch(err => err);

    expect(JSON.stringify(outcome)).not.toContain('leaked-through-a-symlink');
  });

  it('refuses an agent whose yaml file is a symlink pointing out of the workspace', async () => {
    signedIn();

    // On this branch the guard only ever saw the slug-derived prefix, which
    // has no extension and so does not exist on disk — the .yaml the code
    // actually reads was never checked.
    await expect(call(readPrimitive, { kind: 'agent', slug: 'linked-agent' }))
      .rejects
      .toThrow(/escapes workspace/);

    const outcome = await call(readPrimitive, { kind: 'agent', slug: 'linked-agent' }).catch(err => err);

    expect(JSON.stringify(outcome)).not.toContain('leaked-through-a-symlink');
  });
});

describe('readPrimitive — slug pattern (schema, second line of defense)', () => {
  it('rejects a slug containing a path separator at the input boundary', () => {
    expect(() => parseInput(readPrimitive, { kind: 'skill', slug: '../etc' }))
      .toThrow();
  });

  it('rejects a slug that is only dots', () => {
    expect(() => parseInput(readPrimitive, { kind: 'skill', slug: '..' }))
      .toThrow();
  });

  it.each([
    'outreach-drafter',
    'event_candidate',
    'write-lead-brief',
    'revenue-lead',
  ])('accepts the realistic workspace slug %s', (slug) => {
    expect(() => parseInput(readPrimitive, { kind: 'skill', slug })).not.toThrow();
  });
});

describe('writeFile — symlink escape', () => {
  it('refuses to write through a dangling symlink whose target does not exist yet', async () => {
    signedIn();

    // The parent directory here is entirely legitimate, so a guard that
    // only resolves the parent waves this through and writeFileSync then
    // creates OUTSIDE/not-created-yet.md.
    await expect(call(writeFile, {
      path: join(ACME, 'skills', 'dangling-link-skill', 'dangling.md'),
      content: 'written through a dangling symlink if the guard is missing',
    })).rejects.toThrow(/symlink|escapes WORKSPACE_PATH/);

    expect(existsSync(join(OUTSIDE, 'not-created-yet.md'))).toBe(false);
  });

  it('refuses to write through a symlink pointing outside WORKSPACE_PATH', async () => {
    signedIn();

    // linked-skill-dir is a symlink inside ACME pointing at OUTSIDE. The
    // path below is textually contained under WORKSPACE_PATH — the
    // pre-existing string check would wave it through — but resolving the
    // symlink lands squarely outside it.
    await expect(call(writeFile, {
      path: join(ACME, 'skills', 'linked-skill-dir', 'prompt.md'),
      content: 'written through a symlink if the guard is missing',
    })).rejects.toThrow(/escapes WORKSPACE_PATH/);
  });
});
