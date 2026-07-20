/**
 * Workspace greeting label — powers the chat home headline "Ask <workspace>"
 * plus the small org eyebrow above it.
 *
 * The home reads as talking to the WORKSPACE, never a named agent. We compose
 * the cleaner of the account + project names:
 *   - eyebrow  = the org/account name ("Metacto")
 *   - workspace = the project name, prefixed with the account when that reads
 *     cleaner and isn't redundant ("Metacto" + "Revenue" → "Metacto Revenue";
 *     "Metacto" + "Metacto Revenue" → "Metacto Revenue").
 *
 * Pure (no DB) so the page can compose it from the account/project rows it
 * already loads, and so it's unit-testable.
 */

export type WorkspaceGreeting = {
  /** Small org eyebrow above the headline. Undefined when no account name. */
  eyebrow?: string;
  /** The workspace name the headline asks about, e.g. "Metacto Revenue". */
  workspace: string;
};

const GENERIC_PROJECT_NAMES = new Set(['workspace', 'default', 'project', 'general', 'main']);

function clean(name?: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

export function workspaceGreeting(accountName?: string | null, projectName?: string | null): WorkspaceGreeting {
  const account = clean(accountName);
  const project = clean(projectName);

  // No project name to speak of — fall back to the account, then a neutral word.
  if (!project || GENERIC_PROJECT_NAMES.has(project.toLowerCase())) {
    return { workspace: account || 'your workspace', eyebrow: account || undefined };
  }

  // Project already carries the org name (or there's no account) — use it as-is.
  if (!account || project.toLowerCase().includes(account.toLowerCase())) {
    return { workspace: project, eyebrow: account || undefined };
  }

  // Compose "Account Project" — the common case ("Metacto" + "Revenue").
  return { workspace: `${account} ${project}`, eyebrow: account };
}
