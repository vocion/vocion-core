/**
 * Offboarding one of two accounts, against a real database.
 *
 * The fixture is one deployment with two client accounts built the same way —
 * Kestrel Capital, which stays, and Northwind, which leaves — each with
 * workspaces, people, groups, conversations, artifacts, credentials and their
 * data keys, a knowledge source with chunks, records, evals, notifications,
 * activity and spend. Kestrel is seeded first and the whole database is
 * fingerprinted; Northwind is seeded after.
 *
 * The load-bearing assertion is the strong one: after Northwind is offboarded,
 * every table in the database is row-for-row the fingerprint taken before
 * Northwind existed. That proves Kestrel was not touched AND that nothing of
 * Northwind's was left behind, in one comparison, without this test keeping a
 * list of tables that could go stale.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { sql } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { chargeUsage, setAccountCap } = await import('@/services/BudgetService');
const { OffboardError, offboardAccount: offboard, planOffboard: plan } = await import('./AccountOffboardService');
type OffboardStorage = import('./AccountOffboardService').OffboardStorage;

type Row = Record<string, unknown>;

async function rows<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

async function one<T = Row>(query: ReturnType<typeof sql>): Promise<T> {
  return (await rows<T>(query))[0]!;
}

/** Every table in `public`, every row as text, sorted: the database's fingerprint. */
async function fingerprint(): Promise<Record<string, string[]>> {
  const tables = await rows<{ name: string }>(sql`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by 1
  `);
  const out: Record<string, string[]> = {};
  for (const { name } of tables) {
    out[name] = (await rows<{ r: string }>(sql`select t::text as r from ${sql.identifier(name)} t order by 1`)).map(row => row.r);
  }
  return out;
}

const ZERO_VECTOR = sql`array_fill(0, array[1536])::vector`;

/**
 * One client account, built the same way for both: every kind of row an
 * account accumulates, in the workspace `${key}-main`.
 * @param key - Short id prefix.
 * @param name - The client's name.
 * @param members - The people and their account roles; the first is the one who acts.
 */
async function seedAccount(key: string, name: string, members: Array<{ id: string; role: 'admin' | 'member' }>): Promise<{ accountId: string; projectId: string }> {
  const accountId = `acct-${key}`;
  const projectId = `proj-${key}-main`;
  const actor = members[0]!.id;
  await db.execute(sql`insert into tenant_account (id, name, slug) values (${accountId}, ${name}, ${key})`);
  await db.execute(sql`insert into project (id, account_id, slug, name) values (${projectId}, ${accountId}, 'main', ${`${name} main`})`);
  for (const member of members) {
    await db.execute(sql`insert into account_membership (account_id, user_id, role) values (${accountId}, ${member.id}, ${member.role})`);
  }
  await db.execute(sql`insert into invite (id, account_id, email, role, token, invited_by, expires_at) values (${`inv-${key}`}, ${accountId}, ${`new@${key}.example`}, 'member', ${`tok-${key}`}, ${actor}, now() + interval '7 days')`);
  await db.execute(sql`insert into user_group (id, account_id, slug, name) values (${`grp-${key}`}, ${accountId}, 'sales', 'Sales')`);
  await db.execute(sql`insert into user_group_member (group_id, user_id) values (${`grp-${key}`}, ${actor})`);
  await db.execute(sql`insert into group_project_grant (group_id, project_id, role) values (${`grp-${key}`}, ${projectId}, 'member')`);
  await db.execute(sql`insert into project_member (project_id, user_id, role) values (${projectId}, ${actor}, 'admin')`);
  await db.execute(sql`insert into organization (id) values (${projectId})`);
  await db.execute(sql`insert into agent (org_id, project_id, slug, name, system_prompt) values (${projectId}, ${projectId}, 'deal-lead', 'Deal Lead', 'Help.')`);
  await db.execute(sql`insert into team (org_id, project_id, slug, name, accountable_user_id) values (${projectId}, ${projectId}, 'deals', 'Deals', ${actor})`);

  const conversation = await one<{ id: number }>(sql`insert into conversation (org_id, project_id, agent_slug, title, created_by) values (${projectId}, ${projectId}, 'deal-lead', 'Pipeline', ${actor}) returning id`);
  await db.execute(sql`insert into conversation_message (conversation_id, role, content) values (${conversation.id}, 'user', 'How is the pipeline?'), (${conversation.id}, 'assistant', 'Healthy.')`);
  await db.execute(sql`insert into email_thread (org_id, conversation_id, message_id, direction) values (${projectId}, ${conversation.id}, ${`<m-${key}@mail.example>`}, 'inbound')`);
  await db.execute(sql`insert into chat_widget_state (org_id, user_id, agent_slug, conversation_id) values (${projectId}, ${actor}, 'deal-lead', ${conversation.id})`);
  const canvas = await one<{ id: number }>(sql`insert into canvas (org_id, project_id, name, conversation_id) values (${projectId}, ${projectId}, 'Board', ${conversation.id}) returning id`);
  const artifact = await one<{ id: number }>(sql`
    insert into artifact (org_id, project_id, conversation_id, canvas_id, kind, title, spec)
    values (${projectId}, ${projectId}, ${conversation.id}, ${canvas.id}, 'markdown', ${`${name} plan`}, ${JSON.stringify({ md: `The ${name} plan.` })}::jsonb) returning id
  `);
  await db.execute(sql`insert into artifact_version (org_id, artifact_id, version, kind, title, spec) values (${projectId}, ${artifact.id}, 1, 'markdown', ${`${name} plan`}, '{}'::jsonb)`);
  await db.execute(sql`insert into artifact (org_id, project_id, kind, title, spec) values (${projectId}, ${projectId}, 'chart', 'Trend', '{}'::jsonb)`);

  const dek = await one<{ id: number }>(sql`insert into source_dek (org_id, project_id, wrapped_dek) values (${projectId}, ${projectId}, ${`wrapped-${key}`}) returning id`);
  await db.execute(sql`
    insert into api_token (id, org_id, name, platform, dek_id, ciphertext, nonce, auth_tag, key_hint)
    values (${`tok-${key}-openai`}, ${projectId}, 'OpenAI', 'openai', ${dek.id}, ${`cipher-${key}`}, 'n', 't', '…abcd')
  `);
  const install = await one<{ id: number }>(sql`insert into source_install (org_id, project_id, source_slug, installed_by) values (${projectId}, ${projectId}, 'web', ${actor}) returning id`);
  await db.execute(sql`insert into source_credential (install_id, user_id, display_name, dek_id, ciphertext, nonce, auth_tag) values (${install.id}, ${actor}, 'Login', ${dek.id}, ${`cred-${key}`}, 'n', 't')`);
  const source = await one<{ id: number }>(sql`insert into knowledge_source (org_id, project_id, slug, api_token_id) values (${projectId}, ${projectId}, 'docs', ${`tok-${key}-openai`}) returning id`);
  const document = await one<{ id: number }>(sql`insert into knowledge_document (org_id, project_id, source_id, external_id, content_hash) values (${projectId}, ${projectId}, ${source.id}, 'doc-1', 'h') returning id`);
  await db.execute(sql`insert into knowledge_chunk (document_id, org_id, project_id, chunk_idx, content, content_tokens, embedding) values (${document.id}, ${projectId}, ${projectId}, 0, 'Quarterly numbers.', 3, ${ZERO_VECTOR})`);

  const type = await one<{ id: number }>(sql`insert into business_object_type (org_id, project_id, slug, label) values (${projectId}, ${projectId}, 'deal', 'Deal') returning id`);
  const object = await one<{ id: number }>(sql`insert into business_object (org_id, project_id, type_id, title) values (${projectId}, ${projectId}, ${type.id}, 'Renewal') returning id`);
  await db.execute(sql`insert into object_document_link (object_id, onyx_document_id, source_type, role) values (${object.id}, 'doc-1', 'web', 'evidence')`);

  const dataset = await one<{ id: number }>(sql`insert into eval_dataset (org_id, project_id, slug, name, agent_slug) values (${projectId}, ${projectId}, 'smoke', 'Smoke', 'deal-lead') returning id`);
  const run = await one<{ id: number }>(sql`insert into eval_run (org_id, project_id, dataset_id, agent_slug) values (${projectId}, ${projectId}, ${dataset.id}, 'deal-lead') returning id`);
  const result = await one<{ id: number }>(sql`insert into eval_case_result (run_id, item_index, input) values (${run.id}, 0, 'q') returning id`);
  await db.execute(sql`insert into eval_score (run_id, case_result_id, provider, evaluator_slug) values (${run.id}, ${result.id}, 'judge', 'helpful')`);

  const notification = await one<{ id: number }>(sql`insert into notification (org_id, user_id, kind, title, dedupe_key) values (${projectId}, ${actor}, 'review', 'Look', ${`n-${key}`}) returning id`);
  await db.execute(sql`insert into notification_delivery (notification_id, org_id, user_id, channel) values (${notification.id}, ${projectId}, ${actor}, 'email')`);
  await db.execute(sql`insert into user_activity_event (org_id, project_id, user_id, event_type) values (${projectId}, ${projectId}, ${actor}, 'activity.heartbeat')`);

  await chargeUsage({ orgId: projectId, agentSlug: 'deal-lead', model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 1_000_000 } });
  await setAccountCap({ accountId, hardCentsLimit: 50_000 });
  return { accountId, projectId };
}

/**
 * A person with a login, a session, a linked sign-in and a device.
 * @param id - The user id.
 * @param email - Their email.
 */
async function seedUser(id: string, email: string): Promise<void> {
  await db.execute(sql`insert into "user" (id, email, name, password_hash) values (${id}, ${email}, ${email.split('@')[0]}, 'bcrypt-hash')`);
  await db.execute(sql`insert into session (session_token, user_id, expires) values (${`sess-${id}`}, ${id}, now() + interval '1 day')`);
  await db.execute(sql`insert into auth_account (user_id, type, provider, provider_account_id) values (${id}, 'oauth', 'google', ${`g-${id}`})`);
  await db.execute(sql`insert into push_subscription (user_id, platform, token) values (${id}, 'ios', ${`push-${id}`})`);
}

const OPERATOR_EMAIL = 'ops@vocion-operator.example';
let before: Record<string, string[]>;
let out: string;

/** The deployment's file storage for one test: two directories of its own and, when asked for, a bucket held in memory. */
let storage: OffboardStorage;
let bucket: Map<string, Uint8Array>;

function storageFor(dir: string, withBucket = false): OffboardStorage {
  return {
    artifactsDir: path.join(dir, 'artifacts'),
    mediaDir: path.join(dir, 'artifacts', 'media'),
    bucket: withBucket ? { bucket: 'vocion-media-test', region: undefined } : null,
    s3: {
      list: async ({ prefix }) => [...bucket.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key, size: bucket.get(key)!.byteLength })),
      get: async ({ key }) => bucket.get(key)!,
      remove: async ({ keys }) => {
        keys.forEach(key => bucket.delete(key));
      },
    },
  };
}

const offboardAccount = (opts: Parameters<typeof offboard>[0], deps: Parameters<typeof offboard>[1] = {}) => offboard(opts, { storage, ...deps });
const planOffboard = (selector: string) => plan(selector, storage);

async function reset(): Promise<void> {
  // Child-first enough for the restrict keys; cascades take the rest.
  await db.execute(sql`delete from knowledge_source`);
  await db.execute(sql`delete from api_token`);
  await db.execute(sql`delete from source_credential`);
  await db.execute(sql`delete from source_dek`);
  await db.execute(sql`delete from tenant_account where id like 'acct-%'`);
  await db.execute(sql`delete from organization`);
  await db.execute(sql`delete from agent_budget`);
  await db.execute(sql`delete from spend_day`);
  for (const table of ['agent', 'team', 'conversation', 'artifact', 'artifact_version', 'canvas', 'chat_widget_state', 'email_thread', 'source_install', 'knowledge_document', 'knowledge_chunk', 'business_object_type', 'business_object', 'eval_dataset', 'eval_run', 'notification', 'notification_delivery', 'user_activity_event']) {
    await db.execute(sql`delete from ${sql.identifier(table)}`);
  }
  await db.execute(sql`delete from "user"`);
}

beforeEach(async () => {
  await reset();
  vi.stubEnv('VOCION_OPERATOR_EMAILS', OPERATOR_EMAIL);

  // Kestrel Capital — the account that stays — and the people who are not
  // Northwind's alone.
  await seedUser('usr-shared', 'pat@consultancy.example');
  await seedUser('usr-kestrel', 'kim@kestrel.example');
  // The operator runs the deployment, so they exist before either client does.
  await seedUser('usr-ops', OPERATOR_EMAIL);
  await seedAccount('kestrel', 'Kestrel Capital', [{ id: 'usr-kestrel', role: 'admin' }, { id: 'usr-shared', role: 'member' }]);
  before = await fingerprint();

  // Northwind — the account that leaves.
  await seedUser('usr-northwind', 'sam@northwind.example');
  const northwind = await seedAccount('northwind', 'Northwind', [{ id: 'usr-northwind', role: 'admin' }, { id: 'usr-shared', role: 'admin' }, { id: 'usr-ops', role: 'admin' }]);
  await db.execute(sql`insert into project (id, account_id, slug, name, kind, owner_user_id) values ('proj-northwind-sam', ${northwind.accountId}, 'sam', 'Personal', 'personal', 'usr-northwind')`);
  await db.execute(sql`insert into project_member (project_id, user_id, role, source) values ('proj-northwind-sam', 'usr-northwind', 'admin', 'owner')`);

  out = await mkdtemp(path.join(tmpdir(), 'offboard-'));
  bucket = new Map();
  storage = storageFor(await mkdtemp(path.join(tmpdir(), 'offboard-store-')));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await reset();
});

describe('offboarding one of two accounts', () => {
  it('leaves the database exactly as it was before that account existed', async () => {
    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    expect(manifest.mode).toBe('offboard');
    expect(await fingerprint()).toEqual(before);
    expect(Object.values(manifest.remaining ?? {}).every(n => n === 0)).toBe(true);
    // The live stream's deletion notices, written by the delete's own triggers.
    expect(manifest.sideEffects?.live_notice).toBeGreaterThan(0);

    await rm(out, { recursive: true, force: true });
  });

  it('records every table it removed rows from, with the count it removed', async () => {
    const manifest = await offboardAccount({ account: 'acct-northwind', outDir: out, dryRun: false });
    const removed = Object.fromEntries(manifest.plan.tables.map(entry => [entry.table, entry.rows]));

    expect(removed).toMatchObject({
      tenant_account: 1,
      project: 2, // the shared workspace and Sam's personal one
      account_membership: 3,
      conversation: 1,
      conversation_message: 2,
      artifact: 2,
      api_token: 1,
      source_dek: 1,
      source_credential: 1,
      knowledge_chunk: 1,
      eval_score: 1,
      organization: 1,
      spend_day: 1,
      user: 1,
      session: 1,
    });
    // org rows of the workspace, plus the account's own monthly row.
    expect(removed.agent_budget).toBe(3);
    expect(manifest.deleted).toEqual(removed);

    const written = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));

    expect(written.plan.tables).toEqual(manifest.plan.tables);

    await rm(out, { recursive: true, force: true });
  });

  it('deletes the people whose only account it was, and keeps the rest with the reason', async () => {
    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    expect(manifest.plan.users.deleted).toEqual([{ id: 'usr-northwind', email: 'sam@northwind.example' }]);
    expect(manifest.plan.users.kept).toEqual([expect.objectContaining({ id: 'usr-ops', reason: expect.stringContaining('VOCION_OPERATOR_EMAILS') })]);

    const users = await rows<{ id: string }>(sql`select id from "user" order by id`);

    // The person in both accounts keeps their login; the operator keeps theirs.
    expect(users.map(user => user.id)).toEqual(['usr-kestrel', 'usr-ops', 'usr-shared']);

    await rm(out, { recursive: true, force: true });
  });
});

describe('the export', () => {
  it('writes every table as JSON Lines, with secrets redacted and embeddings left out', async () => {
    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    const tokenLines = (await readFile(path.join(out, 'tables', 'api_token.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

    expect(tokenLines).toEqual([expect.objectContaining({ id: 'tok-northwind-openai', ciphertext: '[redacted]', nonce: '[redacted]', auth_tag: '[redacted]', key_hint: '…abcd' })]);

    const dek = JSON.parse((await readFile(path.join(out, 'tables', 'source_dek.jsonl'), 'utf8')).trim());

    expect(dek.wrapped_dek).toBe('[redacted]');

    const chunk = JSON.parse((await readFile(path.join(out, 'tables', 'knowledge_chunk.jsonl'), 'utf8')).trim());

    expect(chunk.content).toBe('Quarterly numbers.');
    expect(chunk).not.toHaveProperty('embedding');

    const user = JSON.parse((await readFile(path.join(out, 'tables', 'user.jsonl'), 'utf8')).trim());

    expect(user).toMatchObject({ email: 'sam@northwind.example', password_hash: '[redacted]' });

    const messages = (await readFile(path.join(out, 'tables', 'conversation_message.jsonl'), 'utf8')).trim().split('\n');

    expect(messages).toHaveLength(2);

    // Every file the manifest lists holds the rows it says.
    for (const file of manifest.export!.files.filter(entry => entry.path.endsWith('.jsonl'))) {
      const text = await readFile(path.join(out, file.path), 'utf8');

      expect(text.split('\n').filter(Boolean)).toHaveLength(file.rows);
    }

    await rm(out, { recursive: true, force: true });
  });

  it('writes the markdown artifact as a page and names the one it cannot', async () => {
    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    expect(manifest.export?.artifacts.written).toBe(1);
    expect(manifest.export?.artifacts.unsupported).toEqual([expect.objectContaining({ kind: 'chart' })]);

    const [artifactDir] = await readdir(path.join(out, 'artifacts', 'main'));
    const page = await readFile(path.join(out, 'artifacts', 'main', artifactDir!, 'pages', 'northwind-plan.md'), 'utf8');

    expect(page).toContain('The Northwind plan.');

    const members = JSON.parse(await readFile(path.join(out, 'members.json'), 'utf8'));

    expect(members.map((member: { email: string }) => member.email).sort()).toEqual([OPERATOR_EMAIL, 'pat@consultancy.example', 'sam@northwind.example']);

    await rm(out, { recursive: true, force: true });
  });
});

describe('the dry run', () => {
  it('counts everything and changes nothing', async () => {
    const preDry = await fingerprint();
    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: true });

    expect(manifest.mode).toBe('dry-run');
    expect(manifest.export).toBeUndefined();
    expect(manifest.plan.tables.find(entry => entry.table === 'conversation_message')?.rows).toBe(2);
    expect(await fingerprint()).toEqual(preDry);
    expect(await readdir(out)).toEqual(['manifest.json']);

    await rm(out, { recursive: true, force: true });
  });

  it('deletes children before their parents', async () => {
    const plan = await planOffboard('northwind');
    const position = (table: string) => plan.tables.findIndex(entry => entry.table === table);

    expect(position('conversation_message')).toBeLessThan(position('conversation'));
    expect(position('knowledge_source')).toBeLessThan(position('api_token'));
    expect(position('api_token')).toBeLessThan(position('source_dek'));
    expect(position('project')).toBeLessThan(position('tenant_account'));
    expect(position('session')).toBeLessThan(position('user'));
  });
});

describe('the account\'s files', () => {
  const HASH = '0123456789abcdef';

  it('copies every file it keeps on the deployment into the export, then removes them, and leaves the other account\'s', async () => {
    storage = storageFor(await mkdtemp(path.join(tmpdir(), 'offboard-store-')), true);
    await mkdir(path.join(storage.mediaDir, 'proj-northwind-main', '42'), { recursive: true });
    await writeFile(path.join(storage.artifactsDir, `proj-northwind-main-${HASH}.png`), 'northwind chart');
    await writeFile(path.join(storage.artifactsDir, `proj-kestrel-main-${HASH}.png`), 'kestrel chart');
    // An org whose id begins with Northwind's is not Northwind's.
    await writeFile(path.join(storage.artifactsDir, `proj-northwind-main-2-${HASH}.png`), 'someone else');
    await writeFile(path.join(storage.mediaDir, 'proj-northwind-main', '42', `walkthrough-${HASH}.webm`), 'northwind recording');
    bucket.set(`proj-northwind-main/42/live-check-${HASH}.webm`, new TextEncoder().encode('northwind in the bucket'));
    bucket.set(`proj-kestrel-main/7/live-check-${HASH}.webm`, new TextEncoder().encode('kestrel in the bucket'));

    const dry = await planOffboard('northwind');

    expect(dry.files).toEqual([
      expect.objectContaining({ store: 'artifacts', files: 1 }),
      expect.objectContaining({ store: 'media', files: 1 }),
      expect.objectContaining({ store: 'media-bucket', location: 's3://vocion-media-test/', files: 1 }),
    ]);

    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    expect(manifest.files).toEqual({ exported: 3, deleted: 3, remaining: 0 });
    expect(await readFile(path.join(out, 'files', 'artifacts', `proj-northwind-main-${HASH}.png`), 'utf8')).toBe('northwind chart');
    expect(await readFile(path.join(out, 'files', 'media', 'proj-northwind-main', '42', `walkthrough-${HASH}.webm`), 'utf8')).toBe('northwind recording');
    expect(await readFile(path.join(out, 'files', 'media-bucket', 'proj-northwind-main', '42', `live-check-${HASH}.webm`), 'utf8')).toBe('northwind in the bucket');

    expect((await readdir(storage.artifactsDir)).sort()).toEqual(['media', `proj-kestrel-main-${HASH}.png`, `proj-northwind-main-2-${HASH}.png`]);
    expect(await readdir(storage.mediaDir)).toEqual([]);
    expect([...bucket.keys()]).toEqual([`proj-kestrel-main/7/live-check-${HASH}.webm`]);

    await rm(out, { recursive: true, force: true });
  });
});

describe('the export\'s snapshot', () => {
  it('pages a table larger than one page by its key, every row once — a redacted key included', async () => {
    const conversation = await one<{ id: number }>(sql`select id from conversation where org_id = 'proj-northwind-main'`);
    await db.execute(sql`insert into conversation_message (conversation_id, role, content) select ${conversation.id}, 'user', 'message ' || n from generate_series(1, 1500) n`);
    await db.execute(sql`insert into session (session_token, user_id, expires) select 'sess-northwind-' || n, 'usr-northwind', now() + interval '1 day' from generate_series(1, 1200) n`);

    const manifest = await offboardAccount({ account: 'northwind', outDir: out, dryRun: false });

    const messages = (await readFile(path.join(out, 'tables', 'conversation_message.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { id: number });

    expect(messages).toHaveLength(1502);
    expect(new Set(messages.map(message => message.id)).size).toBe(1502);

    const sessions = (await readFile(path.join(out, 'tables', 'session.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

    expect(sessions).toHaveLength(1201);
    expect(sessions.every(row => row.session_token === '[redacted]' && !Object.keys(row).some(name => name.startsWith('__')))).toBe(true);
    expect(manifest.plan.tables.find(entry => entry.table === 'session')?.rows).toBe(1201);
    expect(await fingerprint()).toEqual(before);

    await rm(out, { recursive: true, force: true });
  });
});

describe('what stops an offboard', () => {
  it('refuses, deleting nothing, when a reference into the account appears between the export and the delete', async () => {
    const manifestPromise = offboardAccount({ account: 'northwind', outDir: out, dryRun: false }, {
      beforeDelete: async () => {
        await db.execute(sql`update artifact set conversation_id = (select id from conversation where org_id = 'proj-northwind-main') where org_id = 'proj-kestrel-main' and kind = 'chart'`);
      },
    });

    await expect(manifestPromise).rejects.toThrow('came to point into it after the plan');

    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));

    expect(manifest.plan.crossReferences).toEqual([expect.objectContaining({ table: 'artifact', columns: ['conversation_id'], references: 'conversation', rows: 1 })]);
    expect(manifest.deleted).toBeUndefined();
    // Northwind is all still there.
    expect((await rows(sql`select id from tenant_account where id = 'acct-northwind'`))).toHaveLength(1);
    expect((await rows(sql`select m.id from conversation_message m join conversation c on c.id = m.conversation_id where c.org_id = 'proj-northwind-main'`))).toHaveLength(2);

    await rm(out, { recursive: true, force: true });
  });

  it('refuses an account whose Stripe subscription is still live, exporting and deleting nothing', async () => {
    await db.execute(sql`update tenant_account set stripe_customer_id = 'cus_test_northwind', stripe_subscription_id = 'sub_test_northwind', stripe_subscription_status = 'active' where id = 'acct-northwind'`);
    const preRefusal = await fingerprint();

    await expect(offboardAccount({ account: 'northwind', outDir: out, dryRun: false })).rejects.toThrow('Cancel it in Stripe');

    expect(await fingerprint()).toEqual(preRefusal);
    expect(await readdir(out)).toEqual(['manifest.json']);

    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));

    expect(manifest.plan.billing).toEqual([expect.objectContaining({ table: 'tenant_account', subscriptionId: 'sub_test_northwind', status: 'active', live: true })]);

    // Cancelled, it goes.
    await db.execute(sql`update tenant_account set stripe_subscription_status = 'canceled' where id = 'acct-northwind'`);
    await rm(out, { recursive: true, force: true });
    out = await mkdtemp(path.join(tmpdir(), 'offboard-'));

    await expect(offboardAccount({ account: 'northwind', outDir: out, dryRun: false })).resolves.toMatchObject({ mode: 'offboard' });

    await rm(out, { recursive: true, force: true });
  });

  it('refuses, deleting nothing, when a row in the other account points into this one', async () => {
    // A Kestrel artifact made beside a Northwind conversation: deleting the
    // conversation would null out Kestrel's row.
    await db.execute(sql`update artifact set conversation_id = (select id from conversation where org_id = 'proj-northwind-main') where org_id = 'proj-kestrel-main' and kind = 'chart'`);
    const preRefusal = await fingerprint();

    await expect(offboardAccount({ account: 'northwind', outDir: out, dryRun: false })).rejects.toBeInstanceOf(OffboardError);

    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));

    expect(manifest.plan.crossReferences).toEqual([expect.objectContaining({ table: 'artifact', columns: ['conversation_id'], references: 'conversation', rows: 1 })]);
    expect(await fingerprint()).toEqual(preRefusal);

    await rm(out, { recursive: true, force: true });
  });

  it('keeps a person another account still points at, instead of reaching into it', async () => {
    // Sam was removed from Kestrel but is still accountable for one of its teams.
    await db.execute(sql`update team set accountable_user_id = 'usr-northwind' where org_id = 'proj-kestrel-main'`);

    const plan = await planOffboard('northwind');

    expect(plan.users.deleted).toEqual([]);
    expect(plan.users.kept).toContainEqual(expect.objectContaining({ id: 'usr-northwind', reason: 'still referenced by team.accountable_user_id outside this account' }));
  });

  it('names an account that does not exist', async () => {
    await expect(planOffboard('acme')).rejects.toThrow('No account with id or slug "acme"');
  });
});
