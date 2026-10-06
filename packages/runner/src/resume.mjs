// The note an engineer reads first when the branch it resumes no longer rebases on main.

/**
 * What the engineer is told first when the branch it resumes no longer rebases on main: merge
 * main and resolve the named files before the task, so the pull request lands on today's main.
 * @param {{ ref: string, main?: string, conflicts?: string[] } | null} resumedFrom
 * @returns {string | null}
 */
export function resumeNote(resumedFrom) {
  if (!resumedFrom) {
    return null;
  }
  if (!resumedFrom.conflicts) {
    // A clean resume: the last attempt's work is already here, committed on the branch.
    return `This attempt continues \`${resumedFrom.ref}\`, rebased on today's main: the last attempt's work is already on your branch (\`git log origin/main..HEAD\`, \`git diff origin/main\`). Read it first and do only what the acceptance lines still need. If it is already complete, make sure it builds and its tests pass, and stop: the worker checks and lands everything the branch carries.`;
  }
  const files = resumedFrom.conflicts.length > 0 ? resumedFrom.conflicts.map(f => `\`${f}\``).join(', ') : 'the files git names';
  return `Main moved since \`${resumedFrom.ref}\` was written, and it does not rebase cleanly. You are on that branch as it was. First run \`git merge origin/main\` and resolve the conflicts in ${files}, keeping what main changed and what this branch adds; then do the task. The pull request must merge cleanly into main.`;
}
