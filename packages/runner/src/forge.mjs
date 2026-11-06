// Where a repository lives, and how the runner opens a change request there.
//
// The runner pushes a factory/* branch with git, the same on every host: a credential helper fed
// from the environment answers the https prompt, so the token is never in a remote URL, in
// .git/config or on disk. What differs is what comes after the push. On GitHub the runner calls
// `gh pr create`, as it always has. On GitLab there is no `gh` and no guarantee of `glab` in the
// image, so the merge request is opened through GitLab's REST API (v4) from here.
//
// Which host a run is on comes from the installation claim when there is one (core says
// `git.host` and, for GitLab, `git.apiUrl`, so a self-managed GitLab on its own domain works), and
// from the environment when the runner was started with its own credential: GITLAB_TOKEN set and a
// repository that is not on github.com reads as GitLab. Everything else is GitHub, which is what
// every run was before GitLab, so an older core that sends no `host` keeps working unchanged.
//
// The calls are synchronous because land() and keepWork() are: they run between other sh() calls
// and the run has nothing else to do while a merge request opens. A synchronous fetch is a child
// node process (spawnSync) that reads the request on stdin and prints the reply; the token rides
// only in that stdin JSON, never in argv (visible in `ps`), a URL or a log line.

import { spawnSync } from 'node:child_process';

/** GitLab's draft marker: a merge request whose title starts with it is a draft. */
export const GITLAB_DRAFT_PREFIX = 'Draft: ';

/**
 * The parts of an https clone URL a forge needs, or null when it is not one. GitLab nests
 * projects in groups (`group/subgroup/project`), so the path is everything after the host, not
 * two segments. `origin` drops any user:password in the URL, so it is safe to print.
 * @param {string} repo
 * @returns {{ origin: string, hostname: string, path: string } | null}
 */
export function parseRepoUrl(repo) {
  let u;
  try {
    u = new URL(String(repo || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return null;
  }
  const p = u.pathname.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  if (!p.includes('/')) {
    return null;
  }
  return { origin: u.origin, hostname: u.hostname.toLowerCase(), path: p };
}

/**
 * The forge a run lands on.
 *
 * `git` is the installation claim's `git` field (`{ token, source, host?, apiUrl? }`), or null for
 * a runner started with its own credential. With a claim, its `host` decides, and an absent `host`
 * is GitHub (cores from before GitLab). Without one, GITLAB_TOKEN in `env` and a repository off
 * github.com read as GitLab, with the API at the repository's origin.
 * @param {{ repo?: string, git?: { host?: string, apiUrl?: string } | null, env?: Record<string, string | undefined> }} args
 * @returns {{ host: 'github' | 'gitlab', apiUrl: string | null, projectPath: string, webBase: string }}
 */
export function forgeFor({ repo, git = null, env = {} } = {}) {
  const parsed = parseRepoUrl(repo);
  const projectPath = parsed ? parsed.path : String(repo || '');
  let host = 'github';
  if (git) {
    host = git.host === 'gitlab' ? 'gitlab' : 'github';
  } else if (env.GITLAB_TOKEN && parsed && parsed.hostname !== 'github.com') {
    host = 'gitlab';
  }
  if (host === 'gitlab') {
    const apiUrl = String(git?.apiUrl || (parsed ? `${parsed.origin}/api/v4` : '')).replace(/\/+$/, '') || null;
    return { host, apiUrl, projectPath, webBase: parsed ? `${parsed.origin}/${parsed.path}` : '' };
  }
  // GitHub links were always github.com/<owner>/<name>; a URL that does not parse keeps that shape.
  return { host, apiUrl: null, projectPath, webBase: parsed ? `${parsed.origin}/${parsed.path}` : `https://github.com/${projectPath}` };
}

/**
 * A link to one file at one commit, as the host's web UI shows it.
 * @param {{ host: string, webBase: string }} forge
 * @param {string} sha
 * @param {string} rel a path relative to the repository root
 */
export function blobUrl(forge, sha, rel) {
  return forge.host === 'gitlab' ? `${forge.webBase}/-/blob/${sha}/${rel}` : `${forge.webBase}/blob/${sha}/${rel}`;
}

/**
 * The environment git runs with so an https push authenticates from a token in the environment.
 * The helper prints the variable's name, not its value, so the token is read by the shell git
 * starts and never written into git's config. GitHub takes any username with an installation or
 * personal token (`x-access-token` by convention); GitLab wants `oauth2` for an access token.
 * @param {'github' | 'gitlab'} host
 * @param {string} token empty means no credential, so git runs as it would without one
 */
export function gitCredentialEnv(host, token) {
  if (!token) {
    return {};
  }
  const helper = host === 'gitlab'
    ? '!f() { echo username=oauth2; echo "password=$GITLAB_TOKEN"; }; f'
    : '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f';
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: helper,
    GIT_TERMINAL_PROMPT: '0',
  };
}

// The child that makes one request. It reads { url, method, headers, body, timeoutMs } on stdin and
// prints { status, body } on stdout; a network failure is status 0 with the error's message.
const FETCH_SCRIPT = `
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const req = JSON.parse(raw);
try {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  process.stdout.write(JSON.stringify({ status: res.status, body }));
} catch (e) {
  process.stdout.write(JSON.stringify({ status: 0, body: { error: String((e && e.cause && e.cause.message) || (e && e.message) || e) } }));
}
`;

/**
 * One JSON request, synchronously, through a child node process. Never throws: a failure to start
 * or to parse is `{ status: 0, body: { error } }`. The headers (and the token in them) go over
 * stdin only.
 * @param {{ url: string, method?: string, headers?: Record<string, string>, body?: unknown, timeoutMs?: number }} req
 * @returns {{ status: number, body: unknown }}
 */
export function httpJsonSync({ url, method = 'GET', headers = {}, body, timeoutMs = 60000 }) {
  const input = JSON.stringify({ url, method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body, timeoutMs });
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', FETCH_SCRIPT], { input, encoding: 'utf8', timeout: timeoutMs + 10000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    return { status: 0, body: { error: String(r.error?.message || r.stderr || `request process exited ${r.status ?? r.signal}`).trim().slice(-500) } };
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: 0, body: { error: `unreadable reply: ${String(r.stdout).slice(0, 200)}` } };
  }
}

/**
 * GitLab's own words for a failed call. `message` is a string, a list, or an object of field to
 * list (`{ title: ['is too long'] }`); OAuth failures use `error` and `error_description`.
 */
export function gitlabMessage(body) {
  if (body == null) {
    return '';
  }
  if (typeof body === 'string') {
    return body.slice(0, 500);
  }
  const m = body.message;
  if (typeof m === 'string') {
    return m;
  }
  if (Array.isArray(m)) {
    return m.join('; ');
  }
  if (m && typeof m === 'object') {
    return Object.entries(m).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
  }
  if (body.error) {
    return [body.error, body.error_description].filter(Boolean).join(': ');
  }
  return '';
}

function redact(s, token) {
  const text = String(s || '');
  return token ? text.split(token).join('[redacted]') : text;
}

/**
 * Open a merge request for `source` into `target`, or find the open one already there (a run
 * claimed again pushes the same branch). With `updateExisting`, an existing one gets the new
 * description and the labels added, the way a kept-work draft is refreshed on GitHub with
 * `gh pr edit`. GitLab creates a project label the first time it is used, so there is nothing to
 * ensure beforehand.
 *
 * Throws with GitLab's message when it cannot open or find one; the token is never in it.
 * @param {{ host: string, apiUrl: string | null, projectPath: string }} forge
 * @param {{ token: string, source: string, target: string, title: string, description: string, draft?: boolean, labels?: string[], updateExisting?: boolean, http?: typeof httpJsonSync, timeoutMs?: number }} opts
 * @returns {{ url: string, iid: number | null, existing: boolean }} `url` is the merge request's web_url
 */
export function openMergeRequest(forge, { token, source, target, title, description, draft = false, labels = [], updateExisting = false, http = httpJsonSync, timeoutMs = 60000 }) {
  if (forge.host !== 'gitlab' || !forge.apiUrl) {
    throw new Error('openMergeRequest needs a GitLab forge with an API url');
  }
  if (!token) {
    throw new Error('no GitLab token to open the merge request with (GITLAB_TOKEN)');
  }
  const base = `${forge.apiUrl}/projects/${encodeURIComponent(forge.projectPath)}/merge_requests`;
  const headers = { 'PRIVATE-TOKEN': token };
  const fullTitle = draft && !String(title).startsWith(GITLAB_DRAFT_PREFIX) ? `${GITLAB_DRAFT_PREFIX}${title}` : String(title);
  const create = http({
    url: base,
    method: 'POST',
    headers,
    timeoutMs,
    body: {
      source_branch: source,
      target_branch: target,
      title: fullTitle,
      description,
      ...(labels.length ? { labels: labels.join(',') } : {}),
      remove_source_branch: false,
    },
  });
  if (create.status >= 200 && create.status < 300 && create.body?.web_url) {
    return { url: create.body.web_url, iid: create.body.iid ?? null, existing: false };
  }
  // 409: an open merge request already exists for this branch. Any other failure is looked up too,
  // as `gh pr list` is on GitHub, and reported with the create's own reason when nothing is found.
  const found = http({ url: `${base}?state=opened&source_branch=${encodeURIComponent(source)}`, method: 'GET', headers, timeoutMs });
  const mr = found.status === 200 && Array.isArray(found.body) ? found.body.find(m => m?.web_url) : null;
  if (!mr) {
    const why = gitlabMessage(create.body) || `HTTP ${create.status}`;
    throw new Error(redact(`GitLab merge request create failed (${create.status}): ${why}`, token));
  }
  if (updateExisting && mr.iid != null) {
    const put = http({
      url: `${base}/${mr.iid}`,
      method: 'PUT',
      headers,
      timeoutMs,
      body: { description, ...(labels.length ? { add_labels: labels.join(',') } : {}) },
    });
    if (put.status < 200 || put.status >= 300) {
      // The merge request is there and holds the work; a stale description is not worth failing over.
      return { url: mr.web_url, iid: mr.iid, existing: true, updateError: redact(gitlabMessage(put.body) || `HTTP ${put.status}`, token) };
    }
  }
  return { url: mr.web_url, iid: mr.iid ?? null, existing: true };
}
