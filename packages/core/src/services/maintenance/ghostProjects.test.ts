import type { SqlClient } from './ghostProjects';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The ghost-workspace repair, rehearsed on a fixture shaped like the
 * production damage (2026-10-09): per Org, a real workspace whose content has
 * `org_id` = the real id but `project_id` = the ghost, and a ghost someone
 * opened, which then grew its own lead agent, playbook, conversation, budget
 * rows, tool calls, activity and widget state — several of them colliding
 * with the real workspace's on a unique key. Fictional names only.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { findGhosts, formatRepairReport, repairGhostProjects } = await import('./ghostProjects');
const client = (db as unknown as { $client: SqlClient }).$client;

const NW = { account: 'acct-northwind', real: 'proj-northwind-5f3a9c1e7b2d', name: 'Northwind' };
const KC = { account: 'acct-kestrel', real: 'proj-kestrel-capital-0c4e8a', name: 'Kestrel Capital' };
const ghostOf = (id: string) => `proj-${id}`;
const USER = 'usr-fixture-sam';

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(text, params)).rows;
}

async function seed(): Promise<void> {
  await q(`insert into "user" (id, email, name) values ($1, 'sam@northwind.example', 'Sam Rivera')`, [USER]);
  for (const org of [NW, KC]) {
    await q(`insert into tenant_account (id, name, slug) values ($1, $2, $1)`, [org.account, org.name]);
    await q(`insert into account_membership (account_id, user_id, role) values ($1, $2, 'admin')`, [org.account, USER]);
    await q(`insert into project (id, account_id, slug, name) values ($1, $2, $3, $4)`, [org.real, org.account, org.real.replace(/^proj-/, ''), org.name]);
    // The ghost, exactly as migration 0022 named it.
    await q(`insert into project (id, account_id, slug, name) values ($1, $2, $3, $4)`, [ghostOf(org.real), org.account, `org-${org.real}`, `Project ${org.real}`]);
  }
  const R = NW.real;
  const G = ghostOf(R);
  // The real workspace's content, pointed at the ghost by 0022's UPDATEs.
  for (const slug of ['workspace-lead', 'researcher', 'writer']) {
    await q(`insert into agent (org_id, project_id, slug, name, system_prompt) values ($1, $2, $3, $3, 'fixture')`, [R, G, slug]);
  }
  await q(`insert into playbook (org_id, project_id, slug, name, description, content_sha) values ($1, $2, 'workspace-setup', 'Setup', 'fixture', 'sha-real')`, [R, G]);
  const [realConv] = await q<{ id: number }>(`insert into conversation (org_id, project_id, agent_slug, title) values ($1, $2, 'workspace-lead', 'Q3 pipeline') returning id`, [R, G]);
  await q(`insert into conversation_message (conversation_id, role, content) values ($1, 'user', 'hello'), ($1, 'assistant', 'hi')`, [realConv!.id]);
  const [src] = await q<{ id: number }>(`insert into knowledge_source (org_id, project_id, slug) values ($1, $2, 'web') returning id`, [R, G]);
  for (let i = 0; i < 3; i++) {
    await q(`insert into knowledge_document (org_id, project_id, source_id, external_id, content_hash) values ($1, $2, $3, $4, 'h')`, [R, G, src!.id, `doc-${i}`]);
  }
  await q(`insert into agent_budget (org_id, project_id, agent_slug, period, current_cents, current_micro_cents, current_tokens) values ($1, $2, 'platform:all', 'daily', 500, 500000000, 9000)`, [R, G]);
  await q(`insert into chat_widget_state (org_id, user_id, agent_slug) values ($1, $2, 'workspace-lead')`, [R, USER]);

  // What opening the ghost created: its own rows, org_id = the ghost.
  await q(`insert into agent (org_id, project_id, slug, name, system_prompt) values ($1, $1, 'workspace-lead', 'Lead (ghost)', 'fixture')`, [G]);
  await q(`insert into playbook (org_id, project_id, slug, name, description, content_sha) values ($1, $1, 'workspace-setup', 'Setup (ghost)', 'fixture', 'sha-ghost')`, [G]);
  const [ghostConv] = await q<{ id: number }>(`insert into conversation (org_id, project_id, agent_slug, title) values ($1, $1, 'workspace-lead', 'Getting started') returning id`, [G]);
  for (const role of ['user', 'assistant', 'user', 'assistant']) {
    await q(`insert into conversation_message (conversation_id, role, content) values ($1, $2, 'fixture')`, [ghostConv!.id, role]);
  }
  await q(`insert into agent_budget (org_id, project_id, agent_slug, period, current_cents, current_micro_cents, current_tokens) values ($1, $1, 'platform:all', 'daily', 7, 7000000, 120), ($1, $1, 'workspace-lead', 'daily', 7, 7000000, 120)`, [G]);
  await q(`insert into tool_call (org_id, project_id, agent_slug, tool) values ($1, $1, 'workspace-lead', 'search_knowledge'), ($1, $1, 'workspace-lead', 'write_todos')`, [G]);
  await q(`insert into user_activity_event (org_id, user_id, event_type) values ($1, $2, 'conversation.opened')`, [G, USER]);
  await q(`insert into chat_widget_state (org_id, user_id, agent_slug, conversation_id) values ($1, $2, 'workspace-lead', $3)`, [G, USER, ghostConv!.id]);

  // Kestrel: content on the ghost by project_id only; the ghost was never opened.
  await q(`insert into agent (org_id, project_id, slug, name, system_prompt) values ($1, $2, 'workspace-lead', 'Lead', 'fixture')`, [KC.real, ghostOf(KC.real)]);
}

async function count(table: string, column: string, value: string): Promise<number> {
  const [row] = await q<{ n: number }>(`select count(*)::int as n from "${table}" where "${column}" = $1`, [value]);
  return Number(row!.n);
}

describe('repairGhostProjects', () => {
  beforeAll(seed);

  it('finds exactly the ghosts 0022 minted, one per real workspace', async () => {
    const ghosts = await findGhosts(client);

    expect(ghosts.map(g => [g.ghostId, g.realId])).toEqual([
      [ghostOf(KC.real), KC.real],
      [ghostOf(NW.real), NW.real],
    ]);
  });

  it('a dry run reports the repair and changes nothing', async () => {
    const result = await repairGhostProjects(client);

    expect(result.applied).toBe(false);

    const nw = result.orgs.find(o => o.accountId === NW.account)!.ghosts[0]!;

    expect(nw.counts.find(c => c.table === 'agent' && c.column === 'project_id')).toMatchObject({ ghostBefore: 4, ghostAfter: 0 });
    expect(nw.merges.length).toBeGreaterThan(0);
    expect(formatRepairReport(result)).toContain('DRY RUN');
    // Rolled back: the ghost still holds everything.
    expect(await count('agent', 'project_id', ghostOf(NW.real))).toBe(4);
    expect(await count('conversation', 'org_id', ghostOf(NW.real))).toBe(1);

    const [ghost] = await q<{ archived_at: Date | null }>(`select archived_at from project where id = $1`, [ghostOf(NW.real)]);

    expect(ghost!.archived_at).toBeNull();
  });

  it('--apply folds every row into the real workspace, merges the duplicates and archives the ghost', async () => {
    const result = await repairGhostProjects(client, { apply: true });

    expect(result.orgs.every(o => !o.error)).toBe(true);

    const R = NW.real;
    const G = ghostOf(R);
    // Nothing anywhere points at either ghost.
    for (const [table, column] of [['agent', 'project_id'], ['agent', 'org_id'], ['playbook', 'org_id'], ['conversation', 'org_id'], ['conversation', 'project_id'], ['knowledge_document', 'project_id'], ['agent_budget', 'org_id'], ['tool_call', 'org_id'], ['user_activity_event', 'org_id'], ['chat_widget_state', 'org_id']] as const) {
      expect(await count(table, column, G), `${table}.${column}`).toBe(0);
    }

    expect(await count('agent', 'project_id', ghostOf(KC.real))).toBe(0);

    // The real workspace keeps its own lead and playbook; the ghost's twins merged away.
    expect(await count('agent', 'org_id', R)).toBe(3);
    expect(await count('agent', 'project_id', R)).toBe(3);

    const [lead] = await q<{ name: string }>(`select name from agent where org_id = $1 and slug = 'workspace-lead'`, [R]);

    expect(lead!.name).toBe('workspace-lead');

    const [book] = await q<{ content_sha: string }>(`select content_sha from playbook where org_id = $1 and slug = 'workspace-setup'`, [R]);

    expect(book!.content_sha).toBe('sha-real');

    // Conversations are never merged away: the ghost's moved, with its messages.
    const convs = await q<{ title: string; messages: number }>(
      `select c.title, (select count(*)::int from conversation_message m where m.conversation_id = c.id) as messages from conversation c where c.org_id = $1 order by c.title`,
      [R],
    );

    expect(convs).toEqual([{ title: 'Getting started', messages: 4 }, { title: 'Q3 pipeline', messages: 2 }]);

    // Spend on the same scope adds up; a scope only the ghost had moves.
    const budgets = await q<{ agent_slug: string; current_cents: string; current_tokens: string }>(`select agent_slug, current_cents::text, current_tokens::text from agent_budget where org_id = $1 order by agent_slug`, [R]);

    expect(budgets).toEqual([
      { agent_slug: 'platform:all', current_cents: '507', current_tokens: '9120' },
      { agent_slug: 'workspace-lead', current_cents: '7', current_tokens: '120' },
    ]);

    // One widget state per person per workspace: the real one stays.
    expect(await count('chat_widget_state', 'org_id', R)).toBe(1);
    expect(await count('tool_call', 'org_id', R)).toBe(2);
    expect(await count('knowledge_document', 'project_id', R)).toBe(3);

    // Archived and renamed, never deleted.
    const ghosts = await q<{ id: string; name: string; archived: boolean }>(`select id, name, archived_at is not null as archived from project where id in ($1, $2) order by id`, [G, ghostOf(KC.real)]);

    expect(ghosts).toEqual([
      { id: ghostOf(KC.real), name: 'Archived duplicate of Kestrel Capital', archived: true },
      { id: G, name: 'Archived duplicate of Northwind', archived: true },
    ]);
  });

  it('a second run finds nothing to do', async () => {
    const result = await repairGhostProjects(client, { apply: true });

    expect(result.orgs.flatMap(o => o.ghosts).every(g => g.nothingToDo)).toBe(true);
    expect(formatRepairReport(result)).toContain('nothing to do');
  });

  it('every foreign key to project still resolves', async () => {
    const fks = await q<{ t: string; c: string }>(
      `select c.conrelid::regclass::text as t, a.attname as c from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) where c.contype = 'f' and c.confrelid = 'project'::regclass`,
    );
    for (const fk of fks) {
      const [row] = await q<{ n: number }>(`select count(*)::int as n from ${fk.t} x where x."${fk.c}" is not null and not exists (select 1 from project p where p.id = x."${fk.c}")`);

      expect(Number(row!.n), `${fk.t}.${fk.c}`).toBe(0);
    }
  });
});
