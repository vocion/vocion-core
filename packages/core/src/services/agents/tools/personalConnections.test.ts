import type { StructuredToolInterface } from '@langchain/core/tools';
/**
 * The assistant's own-systems tools, two people at once.
 *
 * Alex and Cass are in the same Org, and each connected their own Google,
 * Slack and GitHub from Personal → Connectors. Every vendor call below is
 * recorded with the token it carried, so each test can say exactly whose
 * credential reached the vendor: Alex's turn spends Alex's grant, Cass's
 * spends Cass's, and a turn that names the other person's workspace, a
 * shared workspace or an Org that switched personal connections off spends
 * nothing at all.
 */
import type { RuntimeContext } from '../types';
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { setPersonalConnectionsAllowed } = await import('@/services/personal/connections');
const { personalConnectionTools } = await import('./personalConnections');

const ACCOUNT = 'acct-pct-northwind';
const ALEX = 'usr-pct-alex';
const CASS = 'usr-pct-cass';
const SHARED = 'proj-pct-revenue';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'openid',
  'email',
].join(' ');

let homes: Record<string, string>;

/** Every vendor call: where it went and the bearer it carried. */
let calls: Array<{ url: string; bearer: string | null; method: string; body: string | null }>;

function ctxFor(orgId: string, userId: string | undefined, kind: 'shared' | 'personal' = 'personal'): RuntimeContext {
  return {
    orgId,
    userId,
    agentSlug: 'assistant',
    workspaceKind: kind,
    timeZone: 'America/Los_Angeles',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: () => {},
  } as RuntimeContext;
}

function toolNamed(ctx: RuntimeContext, name: string): StructuredToolInterface {
  const found = personalConnectionTools(ctx).find(t => t.name === name);
  if (!found) {
    throw new Error(`no ${name}`);
  }
  return found as StructuredToolInterface;
}

async function call(ctx: RuntimeContext, name: string, args: Record<string, unknown> = {}): Promise<string> {
  return String(await toolNamed(ctx, name).invoke(args));
}

/** A fake of each vendor, answering per token so a crossed credential shows. */
function vendors() {
  return vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? null;
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null;
    calls.push({ url, bearer, method: init.method ?? 'GET', body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === 'https://oauth2.googleapis.com/token') {
      // The access token Google mints names the refresh token it came from.
      const refresh = new URLSearchParams(body ?? '').get('refresh_token');
      return json({ access_token: `at:${refresh}`, expires_in: 3600 });
    }
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
      return json({ messages: [{ id: `m-${bearer}`, threadId: `t-${bearer}` }] });
    }
    if (url.includes('/users/me/messages/')) {
      return json({ id: `m-${bearer}`, threadId: `t-${bearer}`, snippet: `mail of ${bearer}`, labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: 'Dana <dana@contoso.example>' }, { name: 'Subject', value: 'Renewal' }, { name: 'Date', value: 'Thu, 8 Oct 2026 09:00:00 -0700' }, { name: 'Message-ID', value: '<abc@contoso.example>' }] } });
    }
    if (url.endsWith('/users/me/drafts')) {
      return json({ id: 'd-1', message: { threadId: `t-${bearer}` } });
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      return json({ items: [] });
    }
    if (url.startsWith('https://slack.com/api/search.messages')) {
      return json({ ok: true, messages: { matches: [
        { username: 'sam', text: `dm for ${bearer}`, ts: '1791500000.0001', permalink: 'https://northwind.slack.example/p1', channel: { is_im: true } },
        { username: 'sam', text: 'a channel post', ts: '1791500000.0002', channel: { is_im: false, is_mpim: false, name: 'general' } },
      ] } });
    }
    if (url.startsWith('https://api.github.com/search/issues')) {
      return json({ items: [{ title: `PR for ${bearer}`, html_url: 'https://github.com/northwind/app/pull/7', number: 7, repository_url: 'https://api.github.com/repos/northwind/app', updated_at: '2026-10-08T10:00:00Z', pull_request: {} }] });
    }
    return new Response('not found', { status: 404 });
  });
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-pct' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'admin' },
    { accountId: ACCOUNT, userId: CASS, role: 'member' },
  ]);
  await db.insert(projectSchema).values({ id: SHARED, accountId: ACCOUNT, slug: 'revenue-pct', name: 'Revenue Team' });
  homes = {
    [ALEX]: (await ensurePersonalProject(ALEX, ACCOUNT)).id,
    [CASS]: (await ensurePersonalProject(CASS, ACCOUNT)).id,
  };
  for (const [userId, home] of Object.entries(homes)) {
    const name = userId === ALEX ? 'alex' : 'cass';
    // A pasted client keeps the refresh on this test's fake, with no server app needed.
    await storeLoginCredential({ orgId: home, platform: 'google', name: `Google — ${name}`, account: `${name}@northwind.example`, values: { refreshToken: `rt-${name}`, clientId: 'cid', clientSecret: 'csecret', scope: GOOGLE_SCOPES, email: `${name}@northwind.example` }, createdBy: userId });
    await storeLoginCredential({ orgId: home, platform: 'slack', name: `Slack — ${name}`, account: `You in Northwind (Slack) ${name}`, values: { token: `xoxp-${name}`, kind: 'user' }, createdBy: userId });
    await storeLoginCredential({ orgId: home, platform: 'github', name: `GitHub — ${name}`, account: `${name} (GitHub)`, values: { token: `gho-${name}`, kind: 'user', login: name }, createdBy: userId });
  }
});

beforeEach(async () => {
  calls = [];
  vi.stubGlobal('fetch', vendors());
  await setPersonalConnectionsAllowed(ACCOUNT, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('personal connection tools — present only for a person in their own workspace', () => {
  it('a personal workspace with a person gets every tool; a shared workspace or a turn with no person gets none', () => {
    expect(personalConnectionTools(ctxFor(homes[ALEX]!, ALEX)).map(t => t.name)).toEqual([
      'mail_search',
      'mail_read',
      'mail_draft_reply',
      'calendar_today',
      'calendar_range',
      'drive_search',
      'drive_read',
      'slack_dm_search',
      'github_my_work',
      'github_read',
    ]);
    expect(personalConnectionTools(ctxFor(SHARED, ALEX, 'shared'))).toEqual([]);
    expect(personalConnectionTools(ctxFor(homes[ALEX]!, undefined))).toEqual([]);
  });
});

describe('two people, each with their own credential', () => {
  it('mail_search spends Alex\'s grant on Alex\'s turn and Cass\'s on Cass\'s, never the other', async () => {
    const alex = await call(ctxFor(homes[ALEX]!, ALEX), 'mail_search', { query: 'is:unread' });
    const alexBearers = new Set(calls.filter(c => c.url.includes('gmail')).map(c => c.bearer));
    calls = [];
    const cass = await call(ctxFor(homes[CASS]!, CASS), 'mail_search', { query: 'is:unread' });
    const cassBearers = new Set(calls.filter(c => c.url.includes('gmail')).map(c => c.bearer));

    expect([...alexBearers]).toEqual(['at:rt-alex']);
    expect([...cassBearers]).toEqual(['at:rt-cass']);
    expect(alex).toContain('mail of at:rt-alex');
    expect(cass).toContain('mail of at:rt-cass');
    expect(cass).not.toContain('rt-alex');
  });

  it('slack_dm_search reads each person\'s own DMs as them, and leaves channel posts out', async () => {
    const alex = await call(ctxFor(homes[ALEX]!, ALEX), 'slack_dm_search', { query: 'budget' });
    const cass = await call(ctxFor(homes[CASS]!, CASS), 'slack_dm_search', { query: 'budget' });

    expect(calls.map(c => c.bearer)).toEqual(['xoxp-alex', 'xoxp-cass']);
    expect(alex).toContain('dm for xoxp-alex');
    expect(alex).not.toContain('a channel post');
    expect(cass).toContain('dm for xoxp-cass');
  });

  it('github_my_work reads as each person', async () => {
    const alex = await call(ctxFor(homes[ALEX]!, ALEX), 'github_my_work');
    const alexBearers = new Set(calls.map(c => c.bearer));
    calls = [];
    await call(ctxFor(homes[CASS]!, CASS), 'github_my_work');

    expect([...alexBearers]).toEqual(['gho-alex']);
    expect(new Set(calls.map(c => c.bearer))).toEqual(new Set(['gho-cass']));
    expect(alex).toContain('PR for gho-alex');
  });

  it('Cass naming Alex\'s Personal workspace reaches no vendor at all', async () => {
    const crossed = ctxFor(homes[ALEX]!, CASS);

    for (const name of ['mail_search', 'slack_dm_search', 'github_my_work']) {
      const answer = await call(crossed, name, name === 'github_my_work' ? {} : { query: 'x' });

      expect(answer).toContain('only read from your own Personal workspace');
    }

    expect(calls).toEqual([]);
  });

  it('an Org that turns personal connections off stops every read, and says why', async () => {
    await setPersonalConnectionsAllowed(ACCOUNT, false);

    const answer = await call(ctxFor(homes[ALEX]!, ALEX), 'mail_search', { query: 'x' });

    expect(answer).toContain('turned off personal connections');
    expect(calls).toEqual([]);
  });

  it('a connection the person never made says so and where to make it, and reaches no vendor', async () => {
    const DORA = 'usr-pct-dora';
    await db.insert(userSchema).values({ id: DORA, email: 'dora@northwind.example', name: 'Dora Kim' });
    await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: DORA, role: 'member' });
    const doraHome = (await ensurePersonalProject(DORA, ACCOUNT)).id;

    const answer = await call(ctxFor(doraHome, DORA), 'calendar_today');

    expect(answer).toContain('Google Calendar is not connected');
    expect(answer).toContain('Personal → Connectors');
    expect(calls).toEqual([]);

    await db.delete(apiTokenSchema).where(eq(apiTokenSchema.orgId, doraHome));
  });
});

describe('mail_draft_reply writes a draft and never sends', () => {
  it('posts to Drafts, threaded under the mail it answers, and says it is not sent', async () => {
    const answer = await call(ctxFor(homes[ALEX]!, ALEX), 'mail_draft_reply', { message_id: 'm-1', body: 'Thanks Dana — Tuesday works.' });

    const posts = calls.filter(c => c.method === 'POST' && c.url.includes('gmail'));

    expect(posts.map(c => c.url)).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/drafts']);
    expect(calls.some(c => c.url.includes('/send'))).toBe(false);

    const raw = Buffer.from(JSON.parse(posts[0]!.body!).message.raw, 'base64url').toString('utf8');

    expect(raw).toContain('To: Dana <dana@contoso.example>');
    expect(raw).toContain('Subject: Re: Renewal');
    expect(raw).toContain('In-Reply-To: <abc@contoso.example>');
    expect(answer).toContain('NOT sent');
  });
});
