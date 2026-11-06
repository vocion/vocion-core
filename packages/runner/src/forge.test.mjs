// Where a repository lives and how a merge request is opened there. The GitLab calls run against a
// recorded fake (`http`), so no test reaches the network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blobUrl, forgeFor, gitCredentialEnv, GITLAB_DRAFT_PREFIX, gitlabMessage, httpJsonSync, openMergeRequest, parseRepoUrl } from './forge.mjs';

const TOKEN = 'fake-gitlab-token-for-tests';
const GITLAB_REPO = 'https://gitlab.com/northwind/platform/api.git';

/** A fake http that answers in order and keeps every request it was handed. */
function fakeHttp(...replies) {
  const calls = [];
  const http = (req) => {
    calls.push(req);
    const next = replies.shift();
    if (!next) {
      throw new Error(`unexpected request ${req.method} ${req.url}`);
    }
    return next;
  };
  return { http, calls };
}

describe('forgeFor: which host a run lands on', () => {
  it('reads a github.com repository as GitHub, with links shaped as they always were', () => {
    const f = forgeFor({ repo: 'https://github.com/example/northwind-portal.git' });
    assert.deepEqual(f, { host: 'github', apiUrl: null, projectPath: 'example/northwind-portal', webBase: 'https://github.com/example/northwind-portal' });
  });

  it('keeps GitHub when the claim names no host (a core from before GitLab)', () => {
    const f = forgeFor({ repo: 'https://github.com/example/northwind-portal.git', git: { token: 'x', source: 'installation' }, env: { GITLAB_TOKEN: TOKEN } });
    assert.equal(f.host, 'github');
  });

  it('reads a nested gitlab.com project from the claim, with its whole path', () => {
    const f = forgeFor({ repo: GITLAB_REPO, git: { host: 'gitlab', apiUrl: 'https://gitlab.com/api/v4' } });
    assert.deepEqual(f, { host: 'gitlab', apiUrl: 'https://gitlab.com/api/v4', projectPath: 'northwind/platform/api', webBase: 'https://gitlab.com/northwind/platform/api' });
  });

  it('takes a self-managed host\'s API root from the claim', () => {
    const f = forgeFor({ repo: 'https://git.northwind.example/platform/api.git', git: { host: 'gitlab', apiUrl: 'https://gitlab.northwind.example/api/v4/' } });
    assert.equal(f.host, 'gitlab');
    assert.equal(f.apiUrl, 'https://gitlab.northwind.example/api/v4');
    assert.equal(f.webBase, 'https://git.northwind.example/platform/api');
  });

  it('falls back to the repository\'s origin when the claim says GitLab without an API root', () => {
    assert.equal(forgeFor({ repo: 'https://gitlab.northwind.example:8443/a/b.git', git: { host: 'gitlab' } }).apiUrl, 'https://gitlab.northwind.example:8443/api/v4');
  });

  it('in env mode, GITLAB_TOKEN and a repository off github.com read as GitLab', () => {
    const f = forgeFor({ repo: 'https://gitlab.northwind.example/platform/api.git', env: { GITLAB_TOKEN: TOKEN } });
    assert.equal(f.host, 'gitlab');
    assert.equal(f.apiUrl, 'https://gitlab.northwind.example/api/v4');
    assert.equal(f.projectPath, 'platform/api');
  });

  it('in env mode, a github.com repository stays GitHub even with GITLAB_TOKEN set, and no token is GitHub', () => {
    assert.equal(forgeFor({ repo: 'https://github.com/example/northwind-portal.git', env: { GITLAB_TOKEN: TOKEN } }).host, 'github');
    assert.equal(forgeFor({ repo: 'https://gitlab.northwind.example/platform/api.git', env: {} }).host, 'github');
  });

  it('drops any credentials written into the clone URL', () => {
    const p = parseRepoUrl('https://oauth2:secret@gitlab.com/northwind/api.git/');
    assert.deepEqual(p, { origin: 'https://gitlab.com', hostname: 'gitlab.com', path: 'northwind/api' });
    assert.equal(parseRepoUrl('git@gitlab.com:northwind/api.git'), null);
    assert.equal(parseRepoUrl('https://gitlab.com/onlyone'), null);
  });
});

describe('blobUrl', () => {
  it('links a file at a commit on each host', () => {
    assert.equal(blobUrl(forgeFor({ repo: 'https://github.com/example/northwind-portal.git' }), 'abc123', 'src/a.test.ts'), 'https://github.com/example/northwind-portal/blob/abc123/src/a.test.ts');
    assert.equal(blobUrl(forgeFor({ repo: GITLAB_REPO, git: { host: 'gitlab' } }), 'abc123', 'src/a.test.ts'), 'https://gitlab.com/northwind/platform/api/-/blob/abc123/src/a.test.ts');
  });
});

describe('gitCredentialEnv: the credential helper per host', () => {
  it('answers GitHub as x-access-token from GITHUB_TOKEN, exactly as before', () => {
    assert.deepEqual(gitCredentialEnv('github', 'x'), {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('answers GitLab as oauth2 from GITLAB_TOKEN, and names the variable, never the value', () => {
    const e = gitCredentialEnv('gitlab', TOKEN);
    assert.equal(e.GIT_CONFIG_VALUE_0, '!f() { echo username=oauth2; echo "password=$GITLAB_TOKEN"; }; f');
    assert.ok(!JSON.stringify(e).includes(TOKEN));
  });

  it('adds nothing without a token', () => {
    assert.deepEqual(gitCredentialEnv('gitlab', ''), {});
    assert.deepEqual(gitCredentialEnv('github', ''), {});
  });
});

describe('openMergeRequest', () => {
  const forge = forgeFor({ repo: GITLAB_REPO, git: { host: 'gitlab', apiUrl: 'https://gitlab.com/api/v4' } });
  const base = 'https://gitlab.com/api/v4/projects/northwind%2Fplatform%2Fapi/merge_requests';
  const webUrl = 'https://gitlab.com/northwind/platform/api/-/merge_requests/9';

  it('opens one with the project id URL-encoded and the token only in a header', () => {
    const { http, calls } = fakeHttp({ status: 201, body: { iid: 9, web_url: webUrl } });
    const mr = openMergeRequest(forge, { token: TOKEN, source: 'factory/t-1', target: 'main', title: 'Add the export', description: 'body', http });
    assert.deepEqual(mr, { url: webUrl, iid: 9, existing: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, base);
    assert.ok(!calls[0].url.includes(TOKEN));
    assert.deepEqual(calls[0].headers, { 'PRIVATE-TOKEN': TOKEN });
    assert.deepEqual(calls[0].body, { source_branch: 'factory/t-1', target_branch: 'main', title: 'Add the export', description: 'body', remove_source_branch: false });
  });

  it('marks a draft by the title prefix and sends labels comma-joined', () => {
    const { http, calls } = fakeHttp({ status: 201, body: { iid: 10, web_url: webUrl } });
    openMergeRequest(forge, { token: TOKEN, source: 'factory/t-1-wip-5', target: 'main', title: 'WIP (checks failed): Add the export (run-5)', description: 'b', draft: true, labels: ['checks-failed', 'factory'], http });
    assert.equal(calls[0].body.title, `${GITLAB_DRAFT_PREFIX}WIP (checks failed): Add the export (run-5)`);
    assert.equal(calls[0].body.labels, 'checks-failed,factory');
  });

  it('does not prefix a title that already says Draft', () => {
    const { http, calls } = fakeHttp({ status: 201, body: { iid: 10, web_url: webUrl } });
    openMergeRequest(forge, { token: TOKEN, source: 's', target: 'main', title: 'Draft: x', description: 'b', draft: true, http });
    assert.equal(calls[0].body.title, 'Draft: x');
  });

  it('on 409 finds the open one for the branch instead of failing', () => {
    const { http, calls } = fakeHttp(
      { status: 409, body: { message: ['Another open merge request already exists for this source branch: !9'] } },
      { status: 200, body: [{ iid: 9, web_url: webUrl }] },
    );
    const mr = openMergeRequest(forge, { token: TOKEN, source: 'factory/t-1', target: 'main', title: 't', description: 'b', http });
    assert.deepEqual(mr, { url: webUrl, iid: 9, existing: true });
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, `${base}?state=opened&source_branch=factory%2Ft-1`);
    assert.equal(calls.length, 2, 'no update unless asked');
  });

  it('for kept work, refreshes the existing one with the new description and the label', () => {
    const { http, calls } = fakeHttp(
      { status: 409, body: { message: ['Another open merge request already exists for this source branch: !9'] } },
      { status: 200, body: [{ iid: 9, web_url: webUrl }] },
      { status: 200, body: { iid: 9, web_url: webUrl } },
    );
    const mr = openMergeRequest(forge, { token: TOKEN, source: 'factory/t-1-wip-5', target: 'main', title: 't', description: 'new body', draft: true, labels: ['checks-failed'], updateExisting: true, http });
    assert.equal(mr.url, webUrl);
    assert.equal(mr.existing, true);
    assert.equal(calls[2].method, 'PUT');
    assert.equal(calls[2].url, `${base}/9`);
    assert.deepEqual(calls[2].body, { description: 'new body', add_labels: 'checks-failed' });
  });

  it('keeps the merge request it found when the refresh fails, and says why', () => {
    const { http } = fakeHttp(
      { status: 409, body: { message: ['exists'] } },
      { status: 200, body: [{ iid: 9, web_url: webUrl }] },
      { status: 403, body: { message: '403 Forbidden' } },
    );
    const mr = openMergeRequest(forge, { token: TOKEN, source: 's', target: 'main', title: 't', description: 'b', labels: ['checks-failed'], updateExisting: true, http });
    assert.equal(mr.url, webUrl);
    assert.equal(mr.updateError, '403 Forbidden');
  });

  it('fails with GitLab\'s own message and never the token', () => {
    const { http } = fakeHttp(
      { status: 401, body: { message: `401 Unauthorized ${TOKEN}` } },
      { status: 401, body: { message: '401 Unauthorized' } },
    );
    assert.throws(
      () => openMergeRequest(forge, { token: TOKEN, source: 's', target: 'main', title: 't', description: 'b', http }),
      (e) => {
        assert.match(e.message, /GitLab merge request create failed \(401\): 401 Unauthorized/);
        assert.ok(!e.message.includes(TOKEN), e.message);
        return true;
      },
    );
  });

  it('refuses without a token or off GitLab, before any request', () => {
    const { http, calls } = fakeHttp();
    assert.throws(() => openMergeRequest(forge, { token: '', source: 's', target: 'main', title: 't', description: 'b', http }), /GITLAB_TOKEN/);
    assert.throws(() => openMergeRequest(forgeFor({ repo: 'https://github.com/example/northwind-portal.git' }), { token: TOKEN, source: 's', target: 'main', title: 't', description: 'b', http }), /GitLab forge/);
    assert.equal(calls.length, 0);
  });
});

describe('gitlabMessage', () => {
  it('reads every shape GitLab answers a failure with', () => {
    assert.equal(gitlabMessage({ message: '404 Project Not Found' }), '404 Project Not Found');
    assert.equal(gitlabMessage({ message: ['a', 'b'] }), 'a; b');
    assert.equal(gitlabMessage({ message: { title: ['is too long'] } }), 'title is too long');
    assert.equal(gitlabMessage({ error: 'invalid_token', error_description: 'Token was revoked.' }), 'invalid_token: Token was revoked.');
    assert.equal(gitlabMessage(null), '');
  });
});

describe('httpJsonSync', () => {
  it('reports a request it could not make as status 0 with the reason, without throwing', () => {
    // Nothing listens on port 9 on loopback; the child's fetch fails and says so.
    const r = httpJsonSync({ url: 'http://127.0.0.1:9/', headers: { 'PRIVATE-TOKEN': TOKEN }, timeoutMs: 5000 });
    assert.equal(r.status, 0);
    assert.ok(typeof r.body?.error === 'string' && r.body.error.length > 0);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });
});
