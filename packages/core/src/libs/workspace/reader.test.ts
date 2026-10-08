/**
 * `readPrimitiveFiles` is the second way into a workspace file, next to the
 * oRPC `workspace.readPrimitive` route. The dashboard drilldown pages
 * (`/dashboard/missions/[slug]`, `/dashboard/workflows/[slug]`,
 * `/dashboard/objects/type/[slug]`, `/dashboard/connectors/[slug]`) call it
 * with the slug taken straight from the URL, so a slug that can climb out of
 * the workspace reads any file the process can see — the same hole as
 * vocion-core#266, one layer down.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPrimitiveFiles } from './reader';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-reader-'));
const WORKSPACE = join(ROOT, 'workspace-acme');
const OUTSIDE = join(ROOT, 'outside-any-workspace');

mkdirSync(join(WORKSPACE, 'workflows', 'real-workflow'), { recursive: true });
writeFileSync(join(WORKSPACE, 'workflows', 'real-workflow', 'workflow.yaml'), 'name: Real Workflow\n');

mkdirSync(join(WORKSPACE, 'missions'), { recursive: true });
writeFileSync(join(WORKSPACE, 'missions', 'real-mission.yaml'), 'name: Real Mission\n');

// A secret sitting outside the workspace, shaped like the files a traversal
// would be aiming for.
mkdirSync(join(OUTSIDE, 'missions'), { recursive: true });
writeFileSync(join(OUTSIDE, 'missions', 'stolen.yaml'), 'connector_token: leaked-by-traversal\n');
mkdirSync(join(OUTSIDE, 'workflows', 'stolen-workflow'), { recursive: true });
writeFileSync(join(OUTSIDE, 'workflows', 'stolen-workflow', 'workflow.yaml'), 'connector_token: leaked-by-traversal\n');

// A workflow folder that is entirely legitimate, holding one real file and
// one that is a symlink out of the workspace. The slug guard has nothing to
// say about this — only resolving the link does.
mkdirSync(join(WORKSPACE, 'workflows', 'linked-file-workflow'), { recursive: true });
writeFileSync(join(WORKSPACE, 'workflows', 'linked-file-workflow', 'workflow.yaml'), 'name: Legit\n');
symlinkSync(join(OUTSIDE, 'missions', 'stolen.yaml'), join(WORKSPACE, 'workflows', 'linked-file-workflow', 'stolen.yaml'));

const ORIGINAL_WORKSPACE_PATH = process.env.WORKSPACE_PATH;

// A different company's folder mounted process-wide, to prove the drilldown
// reads the folder it is handed and never the host's mount as such.
const MOUNTED_ELSEWHERE = join(ROOT, 'workspace-kestrel');
mkdirSync(join(MOUNTED_ELSEWHERE, 'missions'), { recursive: true });
writeFileSync(join(MOUNTED_ELSEWHERE, 'missions', 'real-mission.yaml'), 'name: Kestrel Mission\nprompt: kestrel-only\n');

beforeEach(() => {
  process.env.WORKSPACE_PATH = MOUNTED_ELSEWHERE;
});

afterEach(() => {
  process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE_PATH;
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('readPrimitiveFiles — slug containment', () => {
  it('refuses a traversal slug on the flat-file kinds instead of reading outside the workspace', () => {
    // Climbs out of workspace-acme/missions onto a real file. Without the
    // guard its contents go to whoever loaded the page.
    const result = readPrimitiveFiles('mission', '../../outside-any-workspace/missions/stolen', WORKSPACE);

    expect(result).toBeNull();
  });

  it('refuses a traversal slug on the directory kinds', () => {
    // Same climb, but onto a real directory of files rather than one file.
    const result = readPrimitiveFiles('workflow', '../../outside-any-workspace/workflows/stolen-workflow', WORKSPACE);

    expect(result).toBeNull();
  });

  it('drops a file that is a symlink pointing out of the workspace, keeping the rest of the folder', () => {
    const result = readPrimitiveFiles('workflow', 'linked-file-workflow', WORKSPACE);

    expect(JSON.stringify(result)).not.toContain('leaked-by-traversal');
    // The legitimate file beside it still loads — one bad link does not
    // take the whole page down.
    expect(result?.files.map(f => f.path)).toContain('workflows/linked-file-workflow/workflow.yaml');
  });

  it('still reads a legitimate directory-backed primitive', () => {
    const result = readPrimitiveFiles('workflow', 'real-workflow', WORKSPACE);

    expect(result?.files.map(f => f.path)).toContain('workflows/real-workflow/workflow.yaml');
  });

  it('still reads a legitimate flat-file primitive', () => {
    const result = readPrimitiveFiles('mission', 'real-mission', WORKSPACE);

    expect(result?.files[0]?.content).toContain('Real Mission');
  });
});

describe('readPrimitiveFiles — the project\'s own folder, never the host\'s mount', () => {
  it('reads the folder it is handed, not WORKSPACE_PATH, even when both hold the slug', () => {
    const result = readPrimitiveFiles('mission', 'real-mission', WORKSPACE);

    expect(result?.files[0]?.content).toContain('Real Mission');
    expect(JSON.stringify(result)).not.toContain('kestrel-only');
  });

  it('shows nothing from the workspace layer for a project with no folder of its own here', () => {
    // WORKSPACE_PATH is set (another company's folder), but this project has
    // none: the old reader fell back to the mount and showed the other
    // company's mission under this project's slug.
    expect(readPrimitiveFiles('mission', 'real-mission', null)).toBeNull();
  });
});
