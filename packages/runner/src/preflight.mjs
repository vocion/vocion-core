// Preflight: the contract's allowed_paths against the tree that was just cloned, before Claude runs.
// Pure functions over two callbacks (isDir, listDir), so preflight.test.mjs needs no clone.
//
// Run 411 (2026-09-29) was sent a plan written four days earlier whose paths named two apps by
// the names they had before a rename.
// Claude read the tree, saw the schema file was out of bounds, and stopped after 28s with no
// changes; the run failed as a generic "no changes" and the factory asked a person to name paths.
// The tree already said what was wrong. So: a path whose root directory is not in the tree is
// `missing` and the closest existing sibling is named. Since 2026-09-30 the paths are the plan's
// scope, not a fence, so the worker hands this to the engineer as a note instead of refusing.

/** Directories whose children are the units a path is anchored to: apps/<app>, packages/<pkg>. */
const CONTAINERS = new Set(['apps', 'packages', 'services']);

/**
 * The literal directory part of a path or glob, before any wildcard: `apps/x/src/**` -> `apps/x/src`,
 * `apps/x/a.ts` -> `apps/x` (the last segment of a non-glob path is treated as a possible new file).
 * @param {string} p
 */
function literalDirs(p) {
  const clean = String(p || '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  const segs = clean.split('/').filter(Boolean);
  const firstGlob = segs.findIndex(s => /[*?[\]{}]/.test(s));
  const literal = firstGlob === -1 ? segs : segs.slice(0, firstGlob);
  // A non-glob path's last segment may be a file that does not exist yet; its directory is what must.
  // A glob's literal prefix is all directories (`docs/**` -> docs).
  return firstGlob === -1 ? literal.slice(0, -1) : literal;
}

/**
 * The directory a path is anchored to: the app or package it lives in (`apps/api`), or its
 * top-level directory (`docs`). Null when the path is at the repo root or starts with a wildcard,
 * which the tree always satisfies.
 * @param {string} p
 */
export function pathRoot(p) {
  const dirs = literalDirs(p);
  if (dirs.length === 0) {
    return null;
  }
  // `apps/x/...` is anchored to apps/x; `apps/**`, `apps/new.ts` and `docs/...` to their first directory.
  return CONTAINERS.has(dirs[0]) && dirs.length >= 2 ? `${dirs[0]}/${dirs[1]}` : dirs[0];
}

/** Tokens of a directory name, last first: `acme-api` -> ['api', 'acme']. */
function tokens(name) {
  return String(name).toLowerCase().split(/[-_.]+/).filter(Boolean).reverse();
}

/**
 * The closest existing sibling of a missing directory, by suffix: `old-api` -> `acme-api` among
 * acme-api, acme-web, acme-marketing. The longest run of matching trailing tokens wins; a tie
 * is broken by matching leading tokens, then left unsuggested rather than guessed.
 * @param {string} name the missing directory's own name
 * @param {string[]} siblings the names that do exist beside it
 */
export function closestSibling(name, siblings) {
  const want = tokens(name);
  let best = null;
  let bestScore = [0, 0];
  let tie = false;
  for (const s of siblings || []) {
    if (s === name) {
      continue;
    }
    const have = tokens(s);
    let suffix = 0;
    while (suffix < want.length && suffix < have.length && want[suffix] === have[suffix]) {
      suffix++;
    }
    if (suffix === 0) {
      continue;
    }
    const a = [...want].reverse();
    const b = [...have].reverse();
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
      prefix++;
    }
    const score = [suffix, prefix];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = s; bestScore = score; tie = false;
    } else if (score[0] === bestScore[0] && score[1] === bestScore[1]) {
      tie = true;
    }
  }
  return tie ? null : best;
}

/**
 * Every allowed path checked against the tree.
 * @param {string[]} allowedPaths the contract's allowed_paths
 * @param {{ isDir: (rel: string) => boolean, listDir: (rel: string) => string[] }} tree
 * @returns {{ ok: boolean, missing: string[], suggest: string[], roots: Array<{ missing: string, suggest: string | null }> }}
 *   missing: the allowed paths as named; suggest: those paths with the missing root replaced by its
 *   closest sibling (only where one was found); roots: each missing root and its suggestion.
 */
export function checkAllowedPaths(allowedPaths, tree) {
  const missing = [];
  const suggest = [];
  const roots = new Map();
  for (const p of allowedPaths || []) {
    if (typeof p !== 'string' || !p.trim()) {
      continue;
    }
    const root = pathRoot(p);
    if (!root || tree.isDir(root)) {
      continue;
    }
    if (!roots.has(root)) {
      const slash = root.lastIndexOf('/');
      const parent = slash === -1 ? '' : root.slice(0, slash);
      const name = root.slice(slash + 1);
      const siblings = parent === '' || tree.isDir(parent) ? tree.listDir(parent).filter(s => tree.isDir(parent ? `${parent}/${s}` : s)) : [];
      const sib = closestSibling(name, siblings);
      roots.set(root, sib ? (parent ? `${parent}/${sib}` : sib) : null);
    }
    missing.push(p);
    const to = roots.get(root);
    if (to) {
      suggest.push(`${to}${p.trim().replace(/^\.\//, '').slice(root.length)}`);
    }
  }
  return { ok: missing.length === 0, missing, suggest, roots: [...roots].map(([m, s]) => ({ missing: m, suggest: s })) };
}

/**
 * The typed failure for missing paths, and the sentence the run's error carries.
 * @param {{ missing: string[], suggest: string[], roots: Array<{ missing: string, suggest: string | null }> }} check
 */
export function pathsMissingFailure(check) {
  const named = check.roots.map(r => (r.suggest ? `${r.missing} (did you mean ${r.suggest}?)` : r.missing));
  const reason = `the allowed paths name ${named.join(', ')}, which ${check.roots.length === 1 ? 'is' : 'are'} not in the repository`;
  return {
    failure: { kind: 'paths_missing', missing: check.missing, suggest: check.suggest, roots: check.roots, reason },
    error: `paths missing: ${reason}. Nothing was changed and no model was called. The plan or contract names directories the tree does not have (renamed or removed since it was written); plan again against the tree as it is.`,
  };
}
