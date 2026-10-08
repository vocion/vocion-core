import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Whether a path stays inside a folder: the one containment test every
 * workspace read uses (the file routes, brand logos, file sources).
 *
 * Two halves, because each misses what the other catches. The text of the
 * path decides `..` and absolute escapes, and it is not fooled by a sibling
 * whose name merely starts the same way (`/workspace/northwind-labs` is not
 * inside `/workspace/northwind`, which a `startsWith` test gets wrong). The
 * real path decides symlinks: a workspace is a git checkout, git carries
 * links, and a link inside the folder can aim anywhere on the host.
 */

/**
 * `target` is `base` or below it, judged on the path text alone.
 * @param base - The folder.
 * @param target - The path in question, absolute or relative to the cwd.
 */
export function isInsideText(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * The real path of `target` when it exists and, with every symlink followed
 * on both sides, lies inside `base`. Null when it is missing, escapes, or
 * cannot be resolved (a broken link, a loop): refuse rather than guess.
 * @param base - The folder.
 * @param target - The path in question.
 */
export function realPathInside(base: string, target: string): string | null {
  if (!isInsideText(base, target)) {
    return null;
  }
  try {
    const realTarget = realpathSync(target);
    return isInsideText(realpathSync(base), realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}
