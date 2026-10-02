// The note an engineer reads first when the branch it resumes no longer rebases on main.

/**
 * What the engineer is told first when the branch it resumes no longer rebases on main: merge
 * main and resolve the named files before the task, so the pull request lands on today's main.
 * @param {{ ref: string, main?: string, conflicts?: string[] } | null} resumedFrom
 * @returns {string | null}
 */
export function resumeConflictNote(resumedFrom) {
  if (!resumedFrom || !resumedFrom.conflicts) {
    return null;
  }
  const files = resumedFrom.conflicts.length > 0 ? resumedFrom.conflicts.map(f => `\`${f}\``).join(', ') : 'the files git names';
  return `Main moved since \`${resumedFrom.ref}\` was written, and it does not rebase cleanly. You are on that branch as it was. First run \`git merge origin/main\` and resolve the conflicts in ${files}, keeping what main changed and what this branch adds; then do the task. The pull request must merge cleanly into main.`;
}
