/**
 * A repository page on GitHub — its root, a folder or a file — read with the
 * workspace's token, so a private repository answers with its contents
 * instead of a 404 (conversation 397, 2026-09-30: `fetch_url` on the Squatch
 * repository's root returned "HTTP 404" and the agent guessed at its layout).
 * A pull request URL is `readConnectedPull`'s; this takes everything else
 * under `github.com/<owner>/<repo>`.
 */
import { tokenForRepo } from './githubPullRead';

const NAME = /^[\w.-]+$/;
const README = /^readme(?:\.md)?$/i;
// Under the runtime's eviction line (see composePullText), so a file is read whole or cut once.
const MAX_FILE_CHARS = 60_000;

type RepoPath = { owner: string; repo: string; kind: 'root' | 'tree' | 'blob'; ref: string | null; path: string };

/**
 * A repository URL's parts, or null for anything else (a pull request, an issue, a user page).
 * @param url - Any URL.
 */
export function parseRepoUrl(url: string): RepoPath | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    return null;
  }
  const [owner, rawRepo, verb, ref, ...rest] = parsed.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
    return null;
  }
  if (verb === undefined) {
    return { owner, repo, kind: 'root', ref: null, path: '' };
  }
  if ((verb !== 'tree' && verb !== 'blob') || !ref) {
    return null;
  }
  return { owner, repo, kind: verb, ref, path: rest.map(decodeURIComponent).join('/') };
}

/**
 * The page as text, or null when it is not a repository page this workspace
 * holds a token for (the caller then fetches it as any other page).
 * @param orgId - The workspace.
 * @param url - The GitHub URL.
 */
export async function readConnectedRepo(orgId: string, url: string): Promise<string | null> {
  const at = parseRepoUrl(url);
  if (!at) {
    return null;
  }
  const token = await tokenForRepo(orgId, `${at.owner}/${at.repo}`);
  if (!token) {
    return null;
  }
  const headers = { 'authorization': `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion' };
  const ref = at.ref ? `?ref=${encodeURIComponent(at.ref)}` : '';
  const contents = `https://api.github.com/repos/${at.owner}/${at.repo}/contents/${at.path.split('/').map(encodeURIComponent).join('/')}${ref}`;
  const name = `${at.owner}/${at.repo}${at.path ? `/${at.path}` : ''}${at.ref ? ` @ ${at.ref}` : ''}`;

  if (at.kind === 'blob') {
    const res = await fetch(contents, { headers: { ...headers, accept: 'application/vnd.github.raw+json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      return `Could not read ${name} with this workspace's GitHub token: HTTP ${res.status}.`;
    }
    const text = await res.text();
    const shown = text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n\n[Cut at ${MAX_FILE_CHARS} of ${text.length} characters.]` : text;
    return `# ${name}\n${url}\n\n${shown}\n\n[Total length: ${text.length} characters.]`;
  }

  const res = await fetch(contents, { headers: { ...headers, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    return `Could not read ${name} with this workspace's GitHub token: HTTP ${res.status}.`;
  }
  const entries = await res.json() as Array<{ name: string; type: string; path: string; size?: number }> | { type?: string };
  if (!Array.isArray(entries)) {
    return `${name} is a file; open it as ${url.replace('/tree/', '/blob/')} to read it.`;
  }
  const listing = entries
    .map(e => `- ${e.type === 'dir' ? `${e.name}/` : e.name}${e.type === 'file' && typeof e.size === 'number' ? ` (${e.size} bytes)` : ''}`)
    .join('\n');
  let readme = '';
  if (at.kind === 'root' || entries.some(e => README.test(e.name))) {
    const file = entries.find(e => README.test(e.name));
    if (file) {
      const r = await fetch(`https://api.github.com/repos/${at.owner}/${at.repo}/contents/${file.path}${ref}`, { headers: { ...headers, accept: 'application/vnd.github.raw+json' }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (r?.ok) {
        readme = `\n\n## ${file.path}\n\n${(await r.text()).slice(0, 20_000)}`;
      }
    }
  }
  const open = `Open a folder or file by its URL: https://github.com/${at.owner}/${at.repo}/tree/<ref>/<path> or /blob/<ref>/<path>.`;
  return `# ${name}\n${url}\n\n${listing}${readme}\n\n${open}`;
}
