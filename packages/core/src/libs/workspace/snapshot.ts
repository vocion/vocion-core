/**
 * The files of a workspace folder that a runtime read asks for, collected at
 * apply time so the applier can store them with the project (`workspace_file`,
 * `services/workspace/WorkspaceFileService.ts`).
 *
 * Which files: the ones a reader would otherwise open off `WORKSPACE_PATH` —
 *   - every file of every SKILL.md folder under `skills/` and `playbooks/`
 *     (the body and the resources an agent mounts beside it);
 *   - the YAML, markdown and script files under the folders the source panels
 *     open (`agents/`, `workflows/`, `objects/`, `sources/`, `missions/`,
 *     `automations/`, `teams/` — `libs/workspace/reader.ts`);
 *   - the page manifests and their prose under `pages/` (not
 *     `pages/components/`, which is code the build compiles);
 *   - `brand.yaml` and every logo file it names;
 *   - `workspace.yaml` itself, which every workspace has. Its row is how a
 *     reader knows this project's files are stored at all: a project with a
 *     stored manifest reads the database and nothing else, so a file it does
 *     not hold is absent rather than borrowed from whatever folder this host
 *     happens to have mounted.
 *
 * Paths are kept exactly as they sit in the folder, `/`-separated, so a reader
 * asks the database the question it used to ask the disk. Text is collected as
 * authored — `{{env.NAME}}` tokens stay tokens and resolve on the way out —
 * because a value that differs per host must never be written down. A logo is
 * collected base64.
 *
 * Pure filesystem: no database. Dotted names are skipped (the loader skips
 * them too), and so is anything whose real path leaves the folder: a tenant's
 * workspace is a git checkout, and git carries symlinks. A file too large to
 * store is reported with its reason rather than dropped in silence.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { BRAND_FILES, brandLogoRefs, logoMimeType, logoRefPath } from './brand';
import { substituteEnvTokens } from './template-vars';

export type WorkspaceFileEncoding = 'utf8' | 'base64';

/** One file as it will be stored. */
export type CollectedFile = {
  /** Path inside the workspace folder, `/`-separated. */
  path: string;
  /** Text as authored, or base64 for an image. */
  content: string;
  encoding: WorkspaceFileEncoding;
  /** SHA-256 of the file's bytes. */
  sha: string;
};

export type CollectedWorkspace = {
  files: CollectedFile[];
  /** Files a reader would ask for that could not be collected, each with why. */
  skipped: Array<{ path: string; reason: string }>;
};

/** The manifest's names. Every stored workspace holds one. */
export const MANIFEST_FILES = ['workspace.yaml', 'workspace.yml'] as const;

/**
 * Largest file collected. Well past any body an agent mounts or any logo a
 * document inlines; a larger one is named in the apply's warnings.
 */
export const MAX_COLLECTED_FILE_BYTES = 5 * 1024 * 1024;

const PANEL_FILE = new Set(['.yaml', '.yml', '.md', '.js', '.mjs']);
const PAGE_FILE = new Set(['.yaml', '.yml', '.md']);

/** The folders collected, and which of their files. */
const FOLDERS: ReadonlyArray<{ dir: string; include: (path: string) => boolean }> = [
  // A SKILL.md folder mounts every sibling, whatever it is called.
  { dir: 'skills', include: () => true },
  { dir: 'playbooks', include: () => true },
  ...['agents', 'workflows', 'objects', 'sources', 'missions', 'automations', 'teams'].map(dir => ({
    dir,
    include: (path: string) => PANEL_FILE.has(extname(path).toLowerCase()),
  })),
  { dir: 'pages', include: (path: string) => !path.startsWith('pages/components/') && PAGE_FILE.has(extname(path).toLowerCase()) },
];

/**
 * Collect the files a runtime read asks for from one workspace folder.
 * @param root - The workspace folder, absolute.
 */
export function collectWorkspaceFiles(root: string): CollectedWorkspace {
  const out: CollectedWorkspace = { files: [], skipped: [] };
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return out;
  }
  const seen = new Set<string>();
  const take = (abs: string, encoding: WorkspaceFileEncoding) => {
    const path = relative(root, abs).split(sep).join('/');
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    const file = readContained(realRoot, abs, encoding);
    if ('reason' in file) {
      out.skipped.push({ path, reason: file.reason });
    } else {
      out.files.push({ path, ...file });
    }
  };

  for (const name of MANIFEST_FILES) {
    if (existsSync(join(root, name))) {
      take(join(root, name), 'utf8');
    }
  }

  for (const folder of FOLDERS) {
    for (const abs of walk(realRoot, join(root, folder.dir))) {
      const path = relative(root, abs).split(sep).join('/');
      if (folder.include(path)) {
        take(abs, 'utf8');
      }
    }
  }

  const brandFile = BRAND_FILES.map(name => join(root, name)).find(f => existsSync(f));
  if (brandFile) {
    take(brandFile, 'utf8');
    for (const ref of brandLogoRefsOf(brandFile)) {
      const path = logoRefPath(ref);
      if (path && logoMimeType(path)) {
        const abs = resolve(root, path);
        if (existsSync(abs)) {
          take(abs, 'base64');
        }
      }
    }
  }

  out.files.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * The logos a brand file names, read with its tokens resolved. A token that
 * cannot be resolved names no logos here; reading the brand reports it.
 * @param file - The brand file, absolute.
 */
function brandLogoRefsOf(file: string): string[] {
  try {
    return brandLogoRefs(substituteEnvTokens(readFileSync(file, 'utf8'), file));
  } catch {
    return [];
  }
}

/**
 * Every file under a folder, depth first in name order, without dotted names
 * and without following a link out of the workspace (or round in a loop).
 * @param realRoot - The workspace folder's real path.
 * @param dir - The folder to walk.
 * @param visited - Real paths of folders already walked.
 */
function walk(realRoot: string, dir: string, visited = new Set<string>()): string[] {
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return [];
  }
  if (!inside(realRoot, realDir) || visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    let isDir = false;
    let isFile = false;
    try {
      const st = statSync(full);
      isDir = st.isDirectory();
      isFile = st.isFile();
    } catch {
      // A broken link reads as nothing, as it does at mount time.
      continue;
    }
    if (isDir) {
      out.push(...walk(realRoot, full, visited));
    } else if (isFile) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Read one file if its real path stays inside the workspace and it is small
 * enough to store; otherwise say why not.
 * @param realRoot - The workspace folder's real path.
 * @param abs - The file.
 * @param encoding - How to store it.
 */
function readContained(realRoot: string, abs: string, encoding: WorkspaceFileEncoding): Omit<CollectedFile, 'path'> | { reason: string } {
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return { reason: 'could not be resolved on disk' };
  }
  if (!inside(realRoot, real)) {
    return { reason: 'points outside the workspace folder through a link' };
  }
  const size = statSync(real).size;
  if (size > MAX_COLLECTED_FILE_BYTES) {
    return { reason: `is ${size.toLocaleString('en-US')} bytes, over the ${MAX_COLLECTED_FILE_BYTES.toLocaleString('en-US')} a stored file may be` };
  }
  const bytes = readFileSync(real);
  return {
    content: encoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8'),
    encoding,
    sha: createHash('sha256').update(bytes).digest('hex'),
  };
}

function inside(realRoot: string, realPath: string): boolean {
  return realPath === realRoot || realPath.startsWith(realRoot + sep);
}
