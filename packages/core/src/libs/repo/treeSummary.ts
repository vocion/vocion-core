/**
 * A REPOSITORY'S SHAPE IN ONE READ — the pure half of `repo_read_tree`
 * (`services/agents/tools/repoTools.ts`).
 *
 * A code host answers a whole tree as a flat list of paths, which can run to
 * tens of thousands of entries; an agent drawing an architecture map needs
 * what a person sees at a glance: the top-level folders and what they hold,
 * the paths a few levels down, and the manifest files that say what the
 * project is (its README, its package manifest, its container and pipeline
 * definitions, its agent notes). `summarizeTree` turns the one into the other
 * with no network and no exceptions: every count is after the exclusions
 * below, every list is capped and says how much it folded, and odd input
 * (a path with `./`, a duplicate, a missing field) is tidied or dropped.
 *
 * The two helpers after it hold the tool's reading policy for the manifests:
 * which few to read and how to share one character budget between them, so
 * that policy is tested here rather than against a mocked host.
 */

import type { RepoTree, RepoTreeEntry } from '@/services/repo/provider';

/** Paths listed in full: this many segments or fewer. */
export const PATH_DEPTH = 3;
/** Paths listed in full: at most this many, in path order. */
export const PATHS_MAX = 400;
/** Manifest files are looked for this deep (pipeline definitions are the one exception, see `manifestKindOf`). */
export const MANIFEST_DEPTH = 2;
/** Extensions named per top-level folder. */
const EXTENSIONS_MAX = 5;
/** Excluded folders named back, at most. */
const EXCLUDED_DIRS_MAX = 20;

/**
 * Folders that are not the project: dependencies, build output, the
 * repository's own object store. Matched on any segment of a path.
 */
export const EXCLUDED_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.next', '__pycache__']);

/** Dependency lockfiles, by basename: they say which package manager runs, and nothing else a map needs. */
export const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  '.terraform.lock.hcl',
]);

/**
 * What a manifest file is for, in the order the tool reads them: the README
 * says what the project is, the package manifest what it is built from, the
 * agent notes how to work in it, the container and deploy definitions how it
 * runs, the pipelines how it ships, the build and framework config what runs
 * where.
 */
export const MANIFEST_KINDS = ['readme', 'package', 'agent-notes', 'container', 'deploy', 'pipeline', 'build', 'framework-config'] as const;
export type ManifestKind = typeof MANIFEST_KINDS[number];

export type ManifestRef = { path: string; kind: ManifestKind; type: 'blob' | 'tree' };

export type TopLevelEntry = {
  /** The folder's name with a trailing `/`, or the file's name. */
  path: string;
  type: 'dir' | 'file';
  /** Files under the folder, after exclusions; 1 for a file. */
  files: number;
  /** The folder's most common file extensions, most common first. */
  extensions: Array<{ ext: string; count: number }>;
};

export type TreeSummary = {
  repo: string;
  ref: string;
  /** The host cut the listing short: counts and lists are of what it sent. */
  truncated: boolean;
  /** Files and folders counted, after exclusions. */
  fileCount: number;
  directoryCount: number;
  /** The deepest path, in segments. */
  maxDepth: number;
  /** The top level, folders with the most files first, then the root's files. */
  topLevel: TopLevelEntry[];
  /** Every path up to `PATH_DEPTH` segments, folders with a trailing `/`, in path order, at most `PATHS_MAX`. */
  paths: string[];
  /** What `paths` leaves out: deeper than `PATH_DEPTH`, and in depth but past `PATHS_MAX`. */
  folded: { deeper: number; overCap: number };
  /** Manifest files found up to `MANIFEST_DEPTH` (pipelines one deeper), in reading order. */
  manifests: ManifestRef[];
  /** What the exclusions removed: how many files, which folders (capped), which lockfiles. */
  excluded: { files: number; directories: string[]; lockfiles: string[] };
};

/**
 * A path as the listing should carry it: no leading `./` or `/`, no trailing
 * `/`, no empty segment; null when nothing is left.
 * @param raw - The path as the host sent it.
 */
function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const segments = raw.replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return null;
  }
  return segments.join('/');
}

/**
 * The extension a file's name ends in, lowercased; `(none)` for `Makefile`
 * or `.gitignore`.
 * @param base - The file's name.
 */
function extensionOf(base: string): string {
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '(none)';
}

/**
 * The manifest kind of a file at a path, by a fixed allow-list on its name
 * (and for a folder, whether it holds the project's infrastructure
 * definitions); null for anything else. Pipeline definitions live one
 * level deeper than every other manifest, so they are the one match that
 * looks past `MANIFEST_DEPTH`.
 * @param path - The clean path.
 * @param type - File or folder.
 * @param tfDirs - Folders that hold `*.tf` files.
 */
function manifestKindOf(path: string, type: 'blob' | 'tree', tfDirs: Set<string>): ManifestKind | null {
  const segments = path.split('/');
  const base = segments[segments.length - 1]!.toLowerCase();
  if (type === 'tree') {
    return segments.length <= MANIFEST_DEPTH && tfDirs.has(path) ? 'deploy' : null;
  }
  // GitHub Actions only, today: another host's pipeline files (`.gitlab-ci.yml`,
  // `bitbucket-pipelines.yml`) are a provider's to name when one exists.
  if (segments.length === 3 && segments[0] === '.github' && segments[1] === 'workflows' && /\.ya?ml$/.test(base)) {
    return 'pipeline';
  }
  if (segments.length > MANIFEST_DEPTH) {
    return null;
  }
  if (/^readme(?:\.|$)/.test(base)) {
    return 'readme';
  }
  if (base === 'claude.md' || base === 'agents.md') {
    return 'agent-notes';
  }
  if (base === 'package.json' || base === 'pyproject.toml' || base === 'go.mod' || base === 'cargo.toml' || base === 'pom.xml' || base.startsWith('build.gradle')) {
    return 'package';
  }
  if (base.startsWith('dockerfile') || /^(?:docker-)?compose.*\.ya?ml$/.test(base)) {
    return 'container';
  }
  if (/^serverless\.ya?ml$/.test(base) || base === 'procfile') {
    return 'deploy';
  }
  if (base === 'makefile' || /^tsconfig.*\.json$/.test(base) || base.startsWith('next.config.') || base.startsWith('vite.config.')) {
    return 'build';
  }
  // A framework's `config/` folder: server, database, plugin and middleware files, the layout several Node frameworks share.
  if (segments.length === 2 && segments[0] === 'config' && /^(?:server|database|plugins|middlewares|admin|api)\.[cm]?[jt]s$/.test(base)) {
    return 'framework-config';
  }
  return null;
}

const KIND_ORDER = new Map<ManifestKind, number>(MANIFEST_KINDS.map((k, i) => [k, i]));

/**
 * A repository's tree as the compact shape an agent reads to draw its map.
 * Total: any `entries` value, any entry shape, any path string gives a
 * summary, never a throw.
 * @param tree - The tree a provider read.
 * @param options - Caps, for tests and for a caller with a smaller budget.
 * @param options.maxPaths - At most this many paths listed (default `PATHS_MAX`).
 * @param options.pathDepth - Paths listed this deep (default `PATH_DEPTH`).
 */
export function summarizeTree(tree: RepoTree, options: { maxPaths?: number; pathDepth?: number } = {}): TreeSummary {
  const maxPaths = Math.max(0, Math.floor(options.maxPaths ?? PATHS_MAX));
  const pathDepth = Math.max(1, Math.floor(options.pathDepth ?? PATH_DEPTH));
  const rawEntries: unknown[] = Array.isArray(tree?.entries) ? tree.entries : [];

  // Tidy, type and dedupe; split the excluded off with their reasons.
  const kept = new Map<string, RepoTreeEntry>();
  const excludedDirs = new Set<string>();
  const lockfiles: string[] = [];
  let excludedFiles = 0;
  for (const raw of rawEntries) {
    const e = raw as Partial<RepoTreeEntry> | null;
    const path = cleanPath(e?.path);
    const type = e?.type === 'tree' ? 'tree' : e?.type === 'blob' ? 'blob' : null;
    if (!path || !type || kept.has(path)) {
      continue;
    }
    const segments = path.split('/');
    const excludedAt = segments.findIndex(s => EXCLUDED_DIRS.has(s.toLowerCase()));
    if (excludedAt >= 0) {
      excludedDirs.add(segments.slice(0, excludedAt + 1).join('/'));
      if (type === 'blob') {
        excludedFiles += 1;
      }
      continue;
    }
    if (type === 'blob' && LOCKFILES.has(segments[segments.length - 1]!.toLowerCase())) {
      lockfiles.push(path);
      excludedFiles += 1;
      continue;
    }
    kept.set(path, { path, type, ...(typeof e?.size === 'number' ? { size: e.size } : {}) });
  }

  // A host lists folders explicitly; a file whose folder it did not list still has one.
  for (const path of [...kept.keys()]) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const dir = segments.slice(0, i).join('/');
      if (!kept.has(dir)) {
        kept.set(dir, { path: dir, type: 'tree' });
      }
    }
  }

  const entries = [...kept.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = entries.filter(e => e.type === 'blob');
  const dirs = entries.filter(e => e.type === 'tree');
  const maxDepth = entries.reduce((d, e) => Math.max(d, e.path.split('/').length), 0);

  // Top level: each root folder's file count and extension mix; each root file.
  const perTop = new Map<string, { files: number; exts: Map<string, number> }>();
  for (const f of files) {
    const top = f.path.split('/')[0]!;
    if (!perTop.has(top)) {
      perTop.set(top, { files: 0, exts: new Map() });
    }
    const t = perTop.get(top)!;
    t.files += 1;
    const ext = extensionOf(f.path.split('/').pop()!);
    t.exts.set(ext, (t.exts.get(ext) ?? 0) + 1);
  }
  const topLevel: TopLevelEntry[] = entries
    .filter(e => !e.path.includes('/'))
    .map((e) => {
      const t = perTop.get(e.path);
      const extensions = [...(t?.exts ?? new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, EXTENSIONS_MAX)
        .map(([ext, count]) => ({ ext, count }));
      return e.type === 'tree'
        ? { path: `${e.path}/`, type: 'dir' as const, files: t?.files ?? 0, extensions }
        : { path: e.path, type: 'file' as const, files: 1, extensions };
    })
    .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : b.files - a.files || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));

  // Paths to depth, capped, folders marked.
  const inDepth = entries.filter(e => e.path.split('/').length <= pathDepth);
  const paths = inDepth.slice(0, maxPaths).map(e => (e.type === 'tree' ? `${e.path}/` : e.path));
  const folded = { deeper: entries.length - inDepth.length, overCap: Math.max(0, inDepth.length - maxPaths) };

  // Manifests: files by name, folders that hold infrastructure definitions.
  const tfDirs = new Set<string>();
  for (const f of files) {
    if (f.path.toLowerCase().endsWith('.tf')) {
      const segments = f.path.split('/');
      if (segments.length > 1) {
        tfDirs.add(segments.slice(0, -1).join('/'));
      }
    }
  }
  const manifests: ManifestRef[] = [];
  for (const e of entries) {
    const kind = manifestKindOf(e.path, e.type, tfDirs);
    if (kind) {
      manifests.push({ path: e.path, kind, type: e.type });
    }
  }
  manifests.sort((a, b) => (KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!) || (a.path.split('/').length - b.path.split('/').length) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    repo: typeof tree?.repo === 'string' ? tree.repo : '',
    ref: typeof tree?.ref === 'string' ? tree.ref : '',
    truncated: tree?.truncated === true,
    fileCount: files.length,
    directoryCount: dirs.length,
    maxDepth,
    topLevel,
    paths,
    folded,
    manifests,
    excluded: {
      files: excludedFiles,
      directories: [...excludedDirs].sort().slice(0, EXCLUDED_DIRS_MAX),
      lockfiles: lockfiles.sort(),
    },
  };
}

/** How many manifest files one `repo_read_tree` reads. */
export const MANIFEST_READS_MAX = 8;
/** Total characters of manifest text one `repo_read_tree` returns, unless asked otherwise. */
export const MANIFEST_CHARS_DEFAULT = 12_000;

/**
 * The manifest files to read, in reading order: the README first, then the
 * package manifests, then the agent notes, then the container and deploy
 * definitions, then the rest — at most `max`, shallower first within a kind,
 * and never a folder (a folder is named, not read).
 * @param manifests - A summary's `manifests`, already in kind order.
 * @param max - How many to read.
 */
export function pickManifests(manifests: readonly ManifestRef[], max = MANIFEST_READS_MAX): { read: ManifestRef[]; skipped: Array<{ path: string; reason: string }> } {
  const files = manifests.filter(m => m.type === 'blob');
  const read = files.slice(0, Math.max(0, max));
  const skipped = [
    ...manifests.filter(m => m.type === 'tree').map(m => ({ path: m.path, reason: 'a folder; read its files with repo_read_file' })),
    ...files.slice(read.length).map(m => ({ path: m.path, reason: `past the ${max} manifest reads of one call; read it with repo_read_file` })),
  ];
  return { read, skipped };
}

export type FittedText = { path: string; text: string; size: number; truncated: boolean };

/**
 * Several texts fitted into one character budget: each gets an equal share,
 * and what the short ones leave goes to the long ones in order, so a short
 * manifest is always whole and a long README is cut rather than dropped.
 * Deterministic: the same inputs give the same cuts.
 * @param items - The texts, in reading order.
 * @param budget - Characters in all.
 */
export function fitTexts(items: ReadonlyArray<{ path: string; text: string }>, budget: number): FittedText[] {
  const total = Math.max(0, Math.floor(budget));
  const sizes = items.map(i => i.text.length);
  const given = sizes.map(() => 0);
  let remaining = total;
  // Equal shares first, each capped at the text's own size …
  const share = items.length > 0 ? Math.floor(total / items.length) : 0;
  sizes.forEach((size, i) => {
    given[i] = Math.min(size, share);
    remaining -= given[i]!;
  });
  // … then the leftover to whoever is still cut, in reading order.
  sizes.forEach((size, i) => {
    const want = size - given[i]!;
    const add = Math.min(want, remaining);
    given[i]! += add;
    remaining -= add;
  });
  return items.map((item, i) => ({
    path: item.path,
    text: item.text.slice(0, given[i]!),
    size: sizes[i]!,
    truncated: given[i]! < sizes[i]!,
  }));
}
