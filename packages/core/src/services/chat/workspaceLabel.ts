/**
 * Workspace greeting label — powers the chat home headline "Ask <workspace>"
 * plus the small org eyebrow above it.
 *
 * The home reads as talking to the WORKSPACE, never a named agent — and the
 * label stays SHORT: "Ask Revenue", not "Ask Metacto Revenue Operations".
 *   - eyebrow  = the org/account name ("Metacto")
 *   - workspace = the project name's leading word, with any org-name prefix
 *     stripped first ("Metacto Revenue Operations" → "Revenue"); falls back
 *     to the account name when the project name is missing or generic.
 *
 * Brand rule: the value is the name as authored ("Metacto") — any all-caps
 * treatment is CSS styling on the eyebrow, never baked into the string.
 *
 * Pure (no DB) so the page can compose it from the account/project rows it
 * already loads, and so it's unit-testable.
 */

export type WorkspaceGreeting = {
  /** Small org eyebrow above the headline. Undefined when no account name. */
  eyebrow?: string;
  /** The short workspace name the headline asks about, e.g. "Revenue". */
  workspace: string;
};

const GENERIC_PROJECT_NAMES = new Set(['workspace', 'default', 'project', 'general', 'main']);

function clean(name?: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

export function workspaceGreeting(accountName?: string | null, projectName?: string | null): WorkspaceGreeting {
  const account = clean(accountName);
  const project = clean(projectName);
  const eyebrow = account || undefined;

  // No project name to speak of — fall back to the account, then a neutral word.
  if (!project || GENERIC_PROJECT_NAMES.has(project.toLowerCase())) {
    return { workspace: account || 'your workspace', eyebrow };
  }

  // Strip a leading org-name prefix ("Metacto Revenue Operations" → "Revenue
  // Operations") — the eyebrow already says who the org is.
  const withoutOrg = account && project.toLowerCase().startsWith(`${account.toLowerCase()} `)
    ? project.slice(account.length).trim()
    : project;

  // Short label = the leading word ("Revenue Operations" → "Revenue").
  const leading = withoutOrg.split(' ')[0] ?? '';
  if (!leading || GENERIC_PROJECT_NAMES.has(leading.toLowerCase())) {
    return { workspace: account || withoutOrg || 'your workspace', eyebrow };
  }

  return { workspace: leading, eyebrow };
}
