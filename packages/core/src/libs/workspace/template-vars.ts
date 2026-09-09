/**
 * Per-deployment values for workspace files.
 *
 * One workspace git tree gets deployed to several boxes — dev, prod, a
 * tenant's own install. Anything that differs per box, like an API base
 * URL, can't be hardcoded. So the file writes a token:
 *
 *     Fetch the source list from {{env.VEERIO_API_URL}}/api/sources
 *
 * and we swap in that environment variable's value as the file is read.
 * The file on disk is never rewritten.
 *
 * Two rules keep this safe:
 *
 *   1. Only variables listed in `WORKSPACE_TEMPLATE_VARS` can be
 *      substituted. Without that gate, `{{env.DATABASE_URL}}` in a
 *      playbook would quietly hand a password to a model.
 *   2. A token we can't resolve stops everything — `workspace apply`
 *      exits non-zero, an agent run refuses to start, and both name the
 *      file and the token. Passing the raw text through is the one
 *      outcome to avoid: a model reads `{{env.NAME}}` as a real URL and
 *      invents a plausible one, and nothing looks wrong.
 *
 * Text that isn't exactly an `{{env.NAME}}` token is left alone, so a
 * skill can document Handlebars or Jinja syntax and still reach the
 * agent verbatim. The base pack inside vocion-core is never
 * substituted either — every tenant gets those same bytes, so one
 * token there would break everyone's apply.
 *
 * Two places read a workspace body, and both come through here:
 * `loader.ts` at apply time (which is why the stored `contentSha`
 * hashes the resolved text) and `services/playbooks/mount.ts` when an
 * agent mounts the file.
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

/** Raised when a token can't be resolved — see the two rules above. */
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
 * The variable names a workspace file may substitute. Read fresh every
 * call, so a worker that loads its `.env` late still sees the value.
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
 * @param file - path to name in an error message.
 * @throws {WorkspaceTemplateError} when a token is not allowlisted, or
 * its variable is unset, blank, or spans lines.
 */
export function substituteEnvTokens(content: string, file: string): string {
  // Most workspace files carry no token at all.
  if (!content.includes('{{')) {
    return content;
  }

  const allowlist = new Set(allowlistedTemplateVariableNames());

  return content.replace(ENV_TOKEN_PATTERN, (_token, variableName: string) => {
    if (!allowlist.has(variableName)) {
      throw new WorkspaceTemplateError(
        file,
        variableName,
        `is not allowlisted — add it to ${TEMPLATE_VARS_ALLOWLIST_NAME} (currently ${describeAllowlist(allowlist)})`,
      );
    }
    const value = process.env[variableName];
    if (value === undefined || value.trim() === '') {
      throw new WorkspaceTemplateError(
        file,
        variableName,
        `is allowlisted but has no value — set ${variableName} on both the app and the Temporal worker`,
      );
    }
    // Substitution happens before the file is parsed, so a value with a
    // line break would splice extra lines into the YAML and fail
    // somewhere unrelated to the real cause.
    if (value.includes('\n') || value.includes('\r')) {
      throw new WorkspaceTemplateError(
        file,
        variableName,
        `resolves to a value containing a line break, which would corrupt the file — give ${variableName} a single-line value`,
      );
    }
    return value;
  });
}

/**
 * Read a workspace file and resolve its tokens. Use this instead of
 * `readFileSync` for any workspace `.md` or `.yaml`, so apply time and
 * run time always agree on the bytes.
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
