// The size of a change, for the engine scoreboard (core: services/factory/engineRun.ts): lines
// added and removed across the files a run landed, read from `git diff --numstat`. A binary file
// counts as a file with no lines.

/**
 * Lines added and removed, and files, from `git diff --numstat` output.
 * @param {string} out - The command's stdout.
 * @returns {{ files: number, insertions: number, deletions: number }} The change's size.
 */
export function parseNumstat(out) {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of String(out || '').split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t./.exec(line);
    if (!m) {
      continue;
    }
    files += 1;
    insertions += m[1] === '-' ? 0 : Number(m[1]);
    deletions += m[2] === '-' ? 0 : Number(m[2]);
  }
  return { files, insertions, deletions };
}
