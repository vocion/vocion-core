/**
 * Per-deployment value substitution for workspace text files.
 *
 * A workspace is one git tree deployed to several boxes (dev, prod, a
 * tenant's own install). Anything that differs per box — an API base
 * URL, a tenant portal host — cannot be hardcoded in a playbook or a
 * mission. Such a file writes a token instead:
 *
 *     Fetch the source list from {{env.VEERIO_API_URL}}/api/sources
 *
 * and the token is replaced with the value of that environment variable
 * at the moment the file is read.
 *
 * Two rules keep this from becoming an accidental secret leak or a
 * silent misconfiguration:
 *
 *   1. Only variables named in `WORKSPACE_TEMPLATE_VARS` (comma
 *      separated) may be substituted. The allowlist is the only source
 *      — a token naming any other variable is an error, so no part of
 *      the process environment can reach an agent by accident.
 *   2. A token that cannot be resolved is a hard failure, never a
 *      passthrough. `workspace apply` exits non-zero and an agent
 *      invocation refuses to start, both naming the file and the token.
 *      Serving the raw `{{env.NAME}}` text to a model is the one
 *      outcome worth avoiding: the model treats it as a real URL and
 *      invents a plausible one.
 *
 * Anything that is not exactly an `{{env.NAME}}` token is left alone,
 * so a skill that documents Handlebars, Jinja, or Liquid syntax still
 * reaches the agent verbatim.
 *
 * Substitution happens at the two places a workspace file body is read:
 * the apply path in `loader.ts` (so the stored `contentSha` is the sha
 * of what an agent will actually see) and the mount path in
 * `services/playbooks/mount.ts` (what the agent reads at run time).
 */

import { readFileSync } from 'node:fs';

/**
 * A token is `{{env.NAME}}`, where NAME is upper snake case. Inner
 * whitespace is tolerated (`{{ env.NAME }}`) so a near-miss is
 * substituted rather than silently shipped as literal text.
 */
const ENV_TOKEN_PATTERN = /\{\{\s*env\.([A-Z][A-Z0-9_]*)\s*\}\}/g;

/** Environment variable holding the comma-separated allowlist. */
export const TEMPLATE_VARS_ALLOWLIST_NAME = 'WORKSPACE_TEMPLATE_VARS';

/**
 * Raised when a workspace file names a variable that may not be
 * substituted, or one that is allowlisted but has no value in this
 * process's environment.
 */
export class WorkspaceTemplateError extends Error {
  constructor(
    public readonly file: string,
    public readonly variableName: string,
    reason: string,
  ) {
    super(`workspace template substitution failed at ${file}: {{env.${variableName}}} ${reason}`);
    this.name = 'WorkspaceTemplateError';
  }
}

/**
 * The variable names a workspace file is allowed to substitute, read
 * fresh from the environment on every call so a test (or a worker that
 * loads its `.env` late) sees the current value.
 */
export function allowlistedTemplateVariableNames(): string[] {
  const raw = process.env[TEMPLATE_VARS_ALLOWLIST_NAME] ?? '';
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Replace every `{{env.NAME}}` token in one workspace file's text.
 * @param content - the file's raw text.
 * @param file - path used in error messages, so a failure says which
 * workspace file is at fault.
 * @throws {WorkspaceTemplateError} when a token names a variable that
 * is not allowlisted, or one that is allowlisted but unset/blank.
 */
export function substituteEnvTokens(content: string, file: string): string {
  // The overwhelming majority of workspace files carry no token at all.
  if (!content.includes('{{')) {
    return content;
  }

  const allowlist = new Set(allowlistedTemplateVariableNames());

  return content.replace(ENV_TOKEN_PATTERN, (_token, variableName: string) => {
    if (!allowlist.has(variableName)) {
      throw new WorkspaceTemplateError(
        file,
        variableName,
        `is not allowlisted — add ${variableName} to ${TEMPLATE_VARS_ALLOWLIST_NAME} (currently ${describeAllowlist(allowlist)})`,
      );
    }
    const value = process.env[variableName];
    if (value === undefined || value.trim() === '') {
      throw new WorkspaceTemplateError(
        file,
        variableName,
        `is allowlisted but ${variableName} is not set in this process's environment`,
      );
    }
    return value;
  });
}

/**
 * Read one workspace text file and substitute its `{{env.NAME}}`
 * tokens. Use this instead of `readFileSync` everywhere a workspace
 * `.md` or `.yaml` body is loaded, so the apply path and the agent's
 * read path always agree on the bytes.
 * @param file - absolute path to the file.
 */
export function readWorkspaceTextFile(file: string): string {
  return substituteEnvTokens(readFileSync(file, 'utf8'), file);
}

function describeAllowlist(allowlist: Set<string>): string {
  if (allowlist.size === 0) {
    return `${TEMPLATE_VARS_ALLOWLIST_NAME} is empty or unset`;
  }
  return `${TEMPLATE_VARS_ALLOWLIST_NAME}=${[...allowlist].join(',')}`;
}
