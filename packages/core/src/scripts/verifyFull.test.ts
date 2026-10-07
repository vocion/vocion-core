import type { Buffer } from 'node:buffer';
/**
 * `infra/aws/verify-full.sh` — the post-deploy check a parent project runs
 * against a live installation — run for real against a local server that
 * answers the way the app does: `/version.txt`, the Auth.js credentials
 * sign-in, a signed-in page, and `/rpc/agent/stream`'s typed events.
 *
 * The script is the thing under test, so it runs as bash with the real curl
 * and jq. The server runs in this process, so the script is started with the
 * async `execFile` — a synchronous spawn would block the event loop the server
 * answers on.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../../../../infra/aws/verify-full.sh', import.meta.url));
const hasTools = ['bash', 'curl', 'jq'].every(tool => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0);

const QA_EMAIL = 'qa@northwind.example';
const QA_PASSWORD = 'correct horse & battery=staple';
const CORE_COMMIT = 'a'.repeat(40);
const DEPLOY_PIN = 'b'.repeat(40);

type App = {
  versionTxt: string;
  /** Where a signed-in GET of the page ends up: 200 there, or a bounce to sign-in. */
  pageBounces: boolean;
  events: object[];
  streamStatus: number;
  /** What the stream route was sent, for the assertions on how the turn was made. */
  turn: { referer?: string; body?: Record<string, unknown> } | null;
};

const app: App = { versionTxt: '', pageBounces: false, events: [], streamStatus: 200, turn: null };

function versionTxt(fields: Record<string, string>): string {
  return `${Object.entries(fields).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n')}\n`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
  });
}

function signedIn(req: IncomingMessage): boolean {
  return (req.headers.cookie ?? '').split(/;\s*/).includes('session=qa');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/version.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(app.versionTxt);
    return;
  }
  if (url.pathname === '/api/auth/csrf') {
    json(200, { csrfToken: 'csrf-1' }, { 'set-cookie': 'csrf=csrf-1; Path=/' });
    return;
  }
  if (url.pathname === '/api/auth/callback/credentials' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const ok = form.get('csrfToken') === 'csrf-1'
      && (req.headers.cookie ?? '').includes('csrf=csrf-1')
      && form.get('email') === QA_EMAIL
      && form.get('password') === QA_PASSWORD;
    // Auth.js answers a failed credentials sign-in with an error URL, not a 401.
    json(200, { url: ok ? '/dashboard' : '/sign-in?error=CredentialsSignin' }, ok ? { 'set-cookie': 'session=qa; Path=/' } : {});
    return;
  }
  if (url.pathname === '/api/auth/session') {
    json(200, signedIn(req) ? { user: { email: QA_EMAIL.toUpperCase() } } : null);
    return;
  }
  if (url.pathname === '/sign-in') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<form>sign in</form>');
    return;
  }
  if (url.pathname === '/rpc/agent/stream' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    app.turn = { referer: req.headers.referer, body };
    if (!signedIn(req)) {
      json(401, { error: 'Unauthorized' });
      return;
    }
    res.writeHead(app.streamStatus, { 'content-type': 'text/event-stream' });
    res.end(app.events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(': keepalive\n\n'));
    return;
  }
  // Any other path is a signed-in page.
  if (!signedIn(req) || app.pageBounces) {
    res.writeHead(302, { location: `/sign-in?callbackUrl=${encodeURIComponent(url.pathname)}` });
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<main>dashboard</main>');
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  app.versionTxt = versionTxt({ 'version': '5.1.0', 'release': 'v5.1.0', 'commit': CORE_COMMIT, 'deploy-pin': DEPLOY_PIN });
  app.pageBounces = false;
  app.streamStatus = 200;
  app.turn = null;
  app.events = [
    { type: 'routed', routing: { reason: 'lead' }, agent: { slug: 'workspace-lead', name: 'Lead' } },
    { type: 'token', text: 'I am' },
    { type: 'done', response: 'I am here.' },
    { type: 'done', response: '' },
  ];
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function verify(env: Record<string, string | undefined>): Promise<{ code: number; out: string }> {
  // Only what the script needs, so nothing from the caller's environment reaches it.
  const merged: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  for (const [k, v] of Object.entries({ HOST: base, PIN: CORE_COMMIT, QA_EMAIL, QA_PASSWORD, ...env })) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  try {
    const { stdout, stderr } = await run('bash', [SCRIPT], { env: merged, timeout: 20_000 });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe.skipIf(!hasTools)('verify-full.sh', () => {
  it('passes a deploy that serves its pin, signs the QA account in, loads the page and answers one turn', async () => {
    const { code, out } = await verify({});

    expect(code).toBe(0);
    expect(out).toContain(`verify-full: commit ${CORE_COMMIT.slice(0, 12)} = pin`);
    expect(out).toContain('verify-full: signed in as the QA account; /dashboard loaded (200 at /dashboard)');
    expect(out).toContain('verify-full: chat turn answered by workspace-lead (10 chars)');
    expect(out).toContain('verify-full: ok');
    expect(out).not.toContain(QA_PASSWORD);
    // Sent from the page, routed, and not saved as a conversation.
    expect(app.turn?.referer).toBe(`${base}/dashboard`);
    expect(app.turn?.body).toMatchObject({ route: true, time_zone: 'UTC' });
    expect(app.turn?.body).not.toHaveProperty('conversation_id');
  });

  it('accepts the deploy-pin the build was given as well as its core commit', async () => {
    const { code, out } = await verify({ PIN: DEPLOY_PIN });

    expect(code).toBe(0);
    expect(out).toContain(`verify-full: deploy-pin ${DEPLOY_PIN.slice(0, 12)} = pin`);
  });

  it('sends the turn from a workspace page when one is named, so it reaches that workspace', async () => {
    const { code } = await verify({ VERIFY_PAGE_PATH: 'w/northwind/dashboard' });

    expect(code).toBe(0);
    expect(app.turn?.referer).toBe(`${base}/w/northwind/dashboard`);
  });

  it('fails a build that serves a different commit, naming both', async () => {
    const { code, out } = await verify({ PIN: 'c'.repeat(40) });

    expect(code).toBe(1);
    expect(out).toContain(`::error::verify-full: version.txt serves deploy-pin ${DEPLOY_PIN} and commit ${CORE_COMMIT.slice(0, 12)}, but this deploy pins cccccccccccc`);
    expect(app.turn).toBeNull();
  });

  describe('a release name as the pin', () => {
    it('passes the build that is that release', async () => {
      const { code, out } = await verify({ PIN: 'v5.1.0' });

      expect(code).toBe(0);
      expect(out).toContain('verify-full: version 5.1.0 is release v5.1.0');
    });

    it('fails a build two commits past the release, which is not the release', async () => {
      app.versionTxt = versionTxt({ version: '5.1.0+2', release: 'v5.1.0', commit: CORE_COMMIT });

      const { code, out } = await verify({ PIN: 'v5.1.0' });

      expect(code).toBe(1);
      expect(out).toContain('::error::verify-full: version.txt serves 5.1.0+2: 2 commit(s) past v5.1.0, not v5.1.0 itself');
    });

    it('fails a build of another release', async () => {
      const { code, out } = await verify({ PIN: 'v5.2.0' });

      expect(code).toBe(1);
      expect(out).toContain('::error::verify-full: version.txt serves release v5.1.0 but this deploy pins v5.2.0');
    });
  });

  it('fails when the QA account cannot sign in', async () => {
    const { code, out } = await verify({ QA_PASSWORD: 'wrong' });

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the QA account did not sign in: the session is empty');
  });

  it('fails when the deploy has no QA sign-in to check with', async () => {
    const { code, out } = await verify({ QA_EMAIL: undefined, QA_PASSWORD: undefined });

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: no QA sign-in to check with: set QA_EMAIL and QA_PASSWORD');
  });

  it('fails a signed-in page that bounces to sign-in', async () => {
    app.pageBounces = true;

    const { code, out } = await verify({});

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the signed-in page /dashboard bounced to sign-in (/sign-in?callbackUrl=%2Fdashboard)');
  });

  it('fails a turn that ends in an error event, with the error', async () => {
    app.events = [{ type: 'error', message: 'No model key for anthropic' }, { type: 'done', response: '' }];

    const { code, out } = await verify({});

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the chat turn failed: No model key for anthropic');
  });

  it('fails a turn that never finishes', async () => {
    app.events = [{ type: 'token', text: 'thinking' }];

    const { code, out } = await verify({});

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the chat turn never finished: no done event within 240s (1 events read)');
  });

  it('fails a turn that finishes with an empty answer', async () => {
    app.events = [{ type: 'done', response: '' }];

    const { code, out } = await verify({});

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the chat turn finished with an empty answer');
  });

  it('fails a stream that does not answer 200, with what it said', async () => {
    app.streamStatus = 503;
    app.events = [];

    const { code, out } = await verify({});

    expect(code).toBe(1);
    expect(out).toContain('::error::verify-full: the chat turn answered HTTP 503');
  });

  it('says what is missing when HOST or PIN is not given', async () => {
    expect((await verify({ HOST: '' })).out).toContain('::error::verify-full: HOST is required');
    expect((await verify({ PIN: '' })).out).toContain('::error::verify-full: PIN is required');
  });
});
