/**
 * `npm run workspace:apply` — the command a deploy actually runs.
 *
 * This drives the real CLI in a child process rather than the loader
 * it calls, because the behavior under test is the operator-facing
 * contract: a workspace naming a per-deployment value the box has not
 * set must stop the apply, name the file and the token, and exit
 * non-zero so the deploy step fails instead of shipping a playbook the
 * agent will read as literal text.
 *
 * Only the failure path runs here — the success path needs a database,
 * and the substitution it performs is covered against the same loader
 * in `libs/workspace/template-vars-loader.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { fromRepoRoot } from '@/libs/repo-root';

const APPLY_SCRIPT = 'src/scripts/apply-workspace.ts';
/** npm hoists workspace dependencies to the monorepo root, not packages/core. */
const TSX_BINARY = fromRepoRoot('node_modules', '.bin', 'tsx');
/** No query runs before the failure under test; this only satisfies env validation. */
const UNUSED_DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';

const createdDirs: string[] = [];

/** A workspace whose one playbook names a per-deployment API URL. */
function makeTemplatedWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vocion-apply-cli-'));
  createdDirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
  mkdirSync(join(dir, 'playbooks', 'ingest-sources'), { recursive: true });
  writeFileSync(
    join(dir, 'playbooks', 'ingest-sources', 'SKILL.md'),
    [
      '---',
      'slug: ingest-sources',
      'name: Ingest sources',
      'description: Pull the source list before ingesting.',
      '---',
      '',
      'Fetch {{env.VEERIO_API_URL}}/api/sources/ingestion first.',
      '',
    ].join('\n'),
  );
  return dir;
}

type CommandResult = { status: number; output: string };

/**
 * Run the apply CLI in a child process and capture status + output.
 * @param workspaceDir - the workspace to apply.
 * @param extraEnv - environment overrides for the child process.
 */
function runApply(workspaceDir: string, extraEnv: Record<string, string>): CommandResult {
  try {
    const output = execFileSync(TSX_BINARY, [APPLY_SCRIPT, workspaceDir, '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: UNUSED_DATABASE_URL, ...extraEnv },
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

describe('workspace apply — unresolvable {{env.NAME}} token', () => {
  it('exits non-zero and names the file and the token when the variable is not set', () => {
    const workspaceDir = makeTemplatedWorkspace();

    const result = runApply(workspaceDir, { WORKSPACE_TEMPLATE_VARS: 'VEERIO_API_URL', VEERIO_API_URL: '' });

    expect(result.status).toBe(2);
    expect(result.output).toContain('playbooks/ingest-sources/SKILL.md');
    expect(result.output).toContain('{{env.VEERIO_API_URL}}');
  });

  it('exits non-zero when the variable is set but missing from the allowlist', () => {
    const workspaceDir = makeTemplatedWorkspace();

    const result = runApply(workspaceDir, {
      WORKSPACE_TEMPLATE_VARS: 'SOMETHING_ELSE',
      VEERIO_API_URL: 'https://api-dev.veerio.app',
    });

    expect(result.status).toBe(2);
    expect(result.output).toContain('is not allowlisted');
  });
});
