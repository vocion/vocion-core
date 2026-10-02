/**
 * WHETHER A REPOSITORY A RECORD NAMES EXISTS, before the record is proposed
 * (2026-10-01): an agent proposed a repo record for a GitHub repository that
 * was never there (404), it sat pending, and three builds were sent to it. A
 * type marks the field that names a repository with `x-verify: repository`
 * (type.yaml); a proposal whose repository GitHub does not have is refused with
 * that reason. Core names no type: the marker is the type's.
 *
 * Read with the workspace's own token for that repository (`tokenForRepo`)
 * when its GitHub connection lists it, else unauthenticated (a public one).
 * Only a 404 is an answer: a network error, a rate limit or a host that is not
 * GitHub is "could not tell", and never refuses (checks inform; a failure to
 * read is not a finding).
 */

/** What the read found. */
export type RepositoryCheck
  = | { exists: true; fullName: string }
    | { exists: false; fullName: string | null; why: string }
    | { exists: null; why: string };

/** The schema marker on a field that names a code repository. */
export const VERIFY_REPOSITORY = 'repository';

const GITHUB_URL = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
const OWNER_NAME = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * `owner/name` on GitHub from a URL or an `owner/name`, or null.
 * @param ref - What the record says.
 */
export function githubFullName(ref: string): string | null {
  const v = ref.trim();
  const m = GITHUB_URL.exec(v) ?? OWNER_NAME.exec(v);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Ask GitHub whether `ref` is a repository this workspace can see.
 * @param orgId - The workspace.
 * @param ref - A github.com URL or `owner/name`.
 */
export async function repositoryExists(orgId: string, ref: string): Promise<RepositoryCheck> {
  if (/^https?:\/\//i.test(ref.trim()) && !GITHUB_URL.test(ref.trim())) {
    return /^https?:\/\/(?:www\.)?github\.com\//i.test(ref.trim())
      ? { exists: false, fullName: null, why: `${ref} is not a GitHub repository URL (https://github.com/<owner>/<name>)` }
      : { exists: null, why: 'not a GitHub URL; not checked' };
  }
  const fullName = githubFullName(ref);
  if (!fullName) {
    return { exists: false, fullName: null, why: `"${ref}" names no repository: give its URL, https://github.com/<owner>/<name>` };
  }
  const { tokenForRepo } = await import('@/services/agents/tools/githubPullRead');
  const token = await tokenForRepo(orgId, fullName).catch(() => null);
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: { 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) {
    return { exists: null, why: 'GitHub did not answer' };
  }
  if (res.ok) {
    return { exists: true, fullName };
  }
  if (res.status === 404) {
    return {
      exists: false,
      fullName,
      why: token
        ? `GitHub has no repository ${fullName} (404, read with this workspace's GitHub connection)`
        : `GitHub has no repository ${fullName} that this workspace can see (404): it does not exist, or it is private and the workspace's GitHub connection does not list it`,
    };
  }
  return { exists: null, why: `GitHub answered ${res.status}` };
}

/**
 * The refusal for a proposal whose marked repository field names one GitHub
 * does not have, or undefined. A marked field left empty falls back to the
 * title when the title is itself `owner/name`; otherwise the record names no
 * repository, and is refused for that.
 * @param orgId - The workspace.
 * @param schema - The type's JSON Schema.
 * @param fields - The proposal's fields.
 * @param title - The proposal's title.
 */
export async function missingRepositoryRefusal(orgId: string, schema: Record<string, unknown> | null, fields: Record<string, unknown>, title: string): Promise<string | undefined> {
  const props = (schema?.properties ?? {}) as Record<string, { 'x-verify'?: unknown }>;
  const marked = Object.entries(props).filter(([, p]) => p?.['x-verify'] === VERIFY_REPOSITORY).map(([k]) => k);
  for (const key of marked) {
    const value = typeof fields[key] === 'string' && (fields[key] as string).trim() ? (fields[key] as string).trim() : OWNER_NAME.test(title.trim()) ? title.trim() : null;
    if (!value) {
      return `Not proposed: it names no repository. Give \`${key}\` as https://github.com/<owner>/<name>, the repository that exists, and propose it again.`;
    }
    const check = await repositoryExists(orgId, value);
    if (check.exists === false) {
      return `Not proposed: ${check.why}. Check the repository's real URL (the product's pull requests and deploys name it) and propose it again with that \`${key}\`.`;
    }
  }
  return undefined;
}
