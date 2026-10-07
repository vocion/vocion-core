/**
 * The whole ask, with no fake in the middle: a person's assistant turn runs on
 * the real harness, calls `ask_workspace`, and the asked workspace's lead runs
 * its own real turn in its own workspace. Only the reasoning is written down —
 * by the scripted model (`libs/llm/scripted.ts`, `VOCION_LLM_PROVIDER=scripted`),
 * the same one the document and connect e2e suites drive.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const scriptDir = mkdtempSync(path.join(tmpdir(), 'assistant-script-'));
const scriptFile = path.join(scriptDir, 'script.json');
writeFileSync(scriptFile, JSON.stringify({
  turns: [
    // The asked workspace's lead. Listed first: its line is the more specific.
    { match: 'renewal with contoso', reply: 'Contoso renews on Nov 3; the order form is with their legal team.' },
    // The person's assistant.
    {
      match: 'check with revenue',
      steps: [{ tool: 'ask_workspace', args: { workspace: 'revenue', message: 'Where does the renewal with Contoso stand?' } }],
      reply: 'Revenue says Contoso renews on Nov 3.',
    },
  ],
  fallback: 'no line',
}));

const saved = { provider: process.env.VOCION_LLM_PROVIDER, script: process.env.VOCION_LLM_SCRIPT, runtime: process.env.VOCION_DISABLE_RUNTIME };
process.env.VOCION_LLM_PROVIDER = 'scripted';
process.env.VOCION_LLM_SCRIPT = scriptFile;
process.env.VOCION_DISABLE_RUNTIME = '1';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const {
  accountMembershipSchema,
  agentSchema,
  conversationMessageSchema,
  conversationSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { createConversation } = await import('@/services/ConversationService');
const { runAgentDeep } = await import('@/services/AgentService');

const NORTHWIND = 'acct-scripted-northwind';
const HANA = 'usr-scripted-hana';
const REVENUE = 'proj-scripted-revenue';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind-scripted' });
  await db.insert(userSchema).values({ id: HANA, email: 'hana@northwind.example', name: 'Hana Ito' });
  await db.insert(accountMembershipSchema).values({ accountId: NORTHWIND, userId: HANA, role: 'member' });
  await db.insert(projectSchema).values({ id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue Team', leadAgentSlug: 'revenue-lead' });
  await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: HANA, role: 'member' });
  await db.insert(agentSchema).values({ orgId: REVENUE, projectId: REVENUE, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'You lead revenue.', role: 'lead', active: 'true' });
});

afterAll(() => {
  for (const [key, value] of [['VOCION_LLM_PROVIDER', saved.provider], ['VOCION_LLM_SCRIPT', saved.script], ['VOCION_DISABLE_RUNTIME', saved.runtime]] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('a person\'s assistant asks a workspace, end to end', () => {
  it('runs the workspace\'s lead as a nested turn and answers from it', async () => {
    const home = await ensurePersonalProject(HANA, NORTHWIND);
    const parent = await createConversation({ orgId: home.id, agentSlug: 'assistant', createdBy: HANA });
    const events: Array<{ type: string } & Record<string, unknown>> = [];

    const result = await runAgentDeep({
      orgId: home.id,
      agentSlug: 'assistant',
      message: 'Please check with revenue on the Contoso renewal.',
      userId: HANA,
      conversationId: parent.id,
      onEvent: e => events.push(e as never),
    });

    expect(result.response).toContain('Revenue says Contoso renews on Nov 3.');

    // The tool really ran, and its output is the other workspace's answer.
    const ask = result.toolCalls.find(c => c.tool === 'ask_workspace');

    expect(ask?.output).toContain('Contoso renews on Nov 3; the order form is with their legal team.');

    // The asked workspace holds the record, linked back to the person's thread.
    const [child] = await db.select().from(conversationSchema).where(eq(conversationSchema.orgId, REVENUE));

    expect(child).toMatchObject({ surface: 'assistant', parentConversationId: parent.id, createdBy: HANA, agentSlug: 'revenue-lead' });

    const messages = await db.select().from(conversationMessageSchema).where(eq(conversationMessageSchema.conversationId, child!.id));

    expect(messages.at(-1)).toMatchObject({ role: 'assistant', agentSlug: 'revenue-lead' });
    expect(messages.at(-1)!.content).toContain('Contoso renews on Nov 3');

    // One "Asking …" row in the person's turn, opened and closed.
    const rows = events.filter(e => e.type === 'trace_node' && e.kind === 'delegate' && e.tool === 'ask_workspace');

    expect(rows.map(r => r.status)).toEqual(['start', 'done']);
    expect(rows[0]!.label).toBe('Asking Revenue Team');
  });
});
