/**
 * The files of a workspace folder that a runtime read asks for, collected at
 * apply time so the applier can store them with the project (`workspace_file`,
 * `services/workspace/WorkspaceFileService.ts`).
 *
 * Which files: the ones a reader would otherwise open off `WORKSPACE_PATH` —
 *   - every SKILL.md folder the loader cataloged under `skills/` and
 *     `playbooks/`: the body plus each of the row's `sourceFiles`, stored at
 *     `<kind>/<slug>/<file>`. That is exactly the set the mount asks for
 *     (`services/playbooks/mount.ts`), so a resource the catalog lists is
 *     either stored or named in the warnings — never quietly missing;
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
 * because a value that differs per host must never be written down. Whether a
 * file is stored as text or base64 is decided by its bytes, not by the folder
 * it sits in ({@link encodingFor}): a skill folder carries PNGs, PDFs, fonts
 * and compiled caches beside its markdown, and Postgres refuses the NUL byte a
 * binary file holds in a text column. A logo is always base64.
 *
 * Pure filesystem: no database. Outside the cataloged folders, dotted names
 * are skipped (the loader skips them too). Anything whose real path leaves the
 * folder is refused: a tenant's workspace is a git checkout, and git carries
 * symlinks. A file too large to store is reported with its reason rather than
 * dropped in silence.
 */

import type { LoadedPlaybook } from './loader';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { BRAND_FILES, brandLogoRefs, logoMimeType, logoRefPath } from './brand';
import { substituteEnvTokens } from './template-vars';

export type WorkspaceFileEncoding = 'utf8' | 'base64';

/** One file as it will be stored. */
export type CollectedFile = {
  /** Path inside the workspace folder, `/`-separated. */
  path: string;
  /** Text as authored, or base64 for a file that is not text (and every logo). */
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

/**
 * A SKILL.md folder as the loader cataloged it — the fields that say which
 * files the mount will ask the store for.
 */
export type CatalogedFolder = Pick<LoadedPlaybook, 'kind' | 'slug' | 'origin' | 'sourceFile' | 'sourceFiles'>;

/**
 * Whether a file's bytes are stored as text or base64: text when they survive
 * a UTF-8 round trip and hold no NUL byte, base64 otherwise. Read back, a
 * base64 file decodes to what reading it off the folder as UTF-8 gave.
 * @param bytes - The file's bytes.
 */
export function encodingFor(bytes: Buffer): WorkspaceFileEncoding {
  return bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes) ? 'base64' : 'utf8';
}

/** The folders walked (the SKILL.md folders come from the catalog), and which of their files. */
const FOLDERS: ReadonlyArray<{ dir: string; include: (path: string) => boolean }> = [
  ...['agents', 'workflows', 'objects', 'sources', 'missions', 'automations', 'teams'].map(dir => ({
    dir,
    include: (path: string) => PANEL_FILE.has(extname(path).toLowerCase()),
  })),
  { dir: 'pages', include: (path: string) => !path.startsWith('pages/components/') && PAGE_FILE.has(extname(path).toLowerCase()) },
];

/**
 * Collect the files a runtime read asks for from one workspace folder.
 * @param root - The workspace folder, absolute.
 * @param folders - The SKILL.md folders the loader cataloged from it
 * (`loaded.skills` and `loaded.playbooks`). Inherited (`core`) rows are read
 * from the image and not collected.
 */
export function collectWorkspaceFiles(root: string, folders: readonly CatalogedFolder[] = []): CollectedWorkspace {
  const out: CollectedWorkspace = { files: [], skipped: [] };
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return out;
  }
  const seen = new Set<string>();
  const take = (abs: string, opts: { path?: string; encoding?: WorkspaceFileEncoding } = {}) => {
    const path = opts.path ?? relative(root, abs).split(sep).join('/');
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    const file = readContained(realRoot, abs, opts.encoding);
    if ('reason' in file) {
      out.skipped.push({ path, reason: file.reason });
    } else {
      out.files.push({ path, ...file });
    }
  };

  for (const name of MANIFEST_FILES) {
    if (existsSync(join(root, name))) {
      take(join(root, name));
    }
  }

  // Each cataloged folder at the path the mount asks for: its body, then
  // every resource the loader listed for it (dotted folders included, as the
  // loader includes them). An override's resources include the base pack's
  // siblings it did not ship; those are read from the image, not stored.
  for (const folder of folders) {
    if (folder.origin === 'core') {
      continue;
    }
    const base = `${folder.kind === 'skill' ? 'skills' : 'playbooks'}/${folder.slug}`;
    const dir = dirname(folder.sourceFile);
    take(folder.sourceFile, { path: `${base}/SKILL.md` });
    for (const rel of folder.sourceFiles) {
      const abs = join(dir, rel);
      if (folder.origin === 'override' && !existsSync(abs)) {
        continue;
      }
      take(abs, { path: `${base}/${rel.split(sep).join('/')}` });
    }
  }

  for (const folder of FOLDERS) {
    for (const abs of walk(realRoot, join(root, folder.dir))) {
      const path = relative(root, abs).split(sep).join('/');
      if (folder.include(path)) {
        take(abs);
      }
    }
  }

  const brandFile = BRAND_FILES.map(name => join(root, name)).find(f => existsSync(f));
  if (brandFile) {
    take(brandFile);
    for (const ref of brandLogoRefsOf(brandFile)) {
      const path = logoRefPath(ref);
      if (path && logoMimeType(path)) {
        const abs = resolve(root, path);
        if (existsSync(abs)) {
          take(abs, { encoding: 'base64' });
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
 * @param encoding - How to store it; by default, as its bytes say ({@link encodingFor}).
 */
function readContained(realRoot: string, abs: string, encoding?: WorkspaceFileEncoding): Omit<CollectedFile, 'path'> | { reason: string } {
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
  const as = encoding ?? encodingFor(bytes);
  return {
    content: as === 'base64' ? bytes.toString('base64') : bytes.toString('utf8'),
    encoding: as,
    sha: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Whether a path is the folder or under it. Both are compared as given, so
 * pass two real paths (or two resolved ones) — never one of each.
 * @param realRoot - The folder.
 * @param realPath - The path.
 */
export function inside(realRoot: string, realPath: string): boolean {
  return realPath === realRoot || realPath.startsWith(realRoot + sep);
}
