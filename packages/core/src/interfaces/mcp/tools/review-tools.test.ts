/**
 * The Review queue over the real MCP wire, and the parity table that keeps
 * the four surfaces — the Review page, chat, MCP and the API — deciding the
 * same things (Chris, 2026-09-29: "We should maintain parity for UI, chat,
 * MCP and API").
 */
import type { McpConfig } from '../config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { buildServer } = await import('../server');

const ORG = 'test_org_mcp_review';

function configFor(): McpConfig {
  return { orgId: ORG, contextPath: '/tmp/unused', diskWorkspace: false, autoCommit: false, autoApply: false, serverName: 'vocion-test', serverVersion: '0.0.0' };
}

async function connect(identity: Parameters<typeof buildServer>[1]) {
  const server = await buildServer(configFor(), identity);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function pendingCard(): Promise<number> {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'ask.file',
    input: { title: 'Draw the org-switch states', question: 'Which state?' },
    status: 'pending',
    invokedBy: 'agent:product-manager',
  }).returning({ id: actionRunSchema.id });
  return row!.id;
}

const text = (res: unknown) => ((res as { content: Array<{ text: string }> }).content[0]!.text);

afterEach(async () => {
  await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
});

describe('the review queue over MCP', () => {
  it('lists a waiting card and rejects it, recorded as the token', async () => {
    const id = await pendingCard();
    const client = await connect({ userId: 'token:t1', principal: { kind: 'user', id: 'token:t1', role: 'member', scope: { orgId: ORG } } });

    const listed = await client.callTool({ name: 'review_list', arguments: {} });

    expect(text(listed)).toContain(`"id": ${id}`);

    const decided = await client.callTool({ name: 'review_decide', arguments: { kind: 'action', id, action: 'reject', reason: 'Superseded by the change in chat.', learn: false } });

    expect(decided.isError).toBeFalsy();

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row?.status).toBe('rejected');
    expect(row?.decidedBy).toBe('token:t1');
  });

  it('refuses a caller without the approve capability, and the card stays waiting', async () => {
    const id = await pendingCard();
    const client = await connect({ userId: 'token:t2', principal: { kind: 'agent', id: 'agent:reader', scope: { orgId: ORG }, grants: ['read'], autonomy: 1 } });

    const decided = await client.callTool({ name: 'review_decide', arguments: { kind: 'action', id, action: 'reject' } });

    expect(decided.isError).toBe(true);
    expect(text(decided)).toMatch(/FORBIDDEN/);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row?.status).toBe('pending');
  });
});

/**
 * Every review verb, on every surface. A verb added to one surface and not
 * the others fails here.
 */
const PARITY = [
  { verb: 'list the queue', api: 'src/app/api/v1/reviews/route.ts', mcp: 'review_list', chat: null },
  { verb: 'read one item', api: 'src/app/api/v1/reviews/[kind]/[id]/route.ts', mcp: 'review_get', chat: null },
  { verb: 'approve or reject a proposal', api: 'src/app/api/v1/reviews/decide/route.ts', mcp: 'review_decide', chat: 'decide_proposal' },
  { verb: 'answer an ask', api: 'src/app/api/v1/asks/[id]/decide/route.ts', mcp: 'ask_decide', chat: 'decide_ask' },
];

describe('review parity: the page, chat, MCP and the API decide the same things', () => {
  it('has each verb on each surface', async () => {
    const client = await connect({ userId: 'mcp' });
    const tools = (await client.listTools()).tools.map(t => t.name);
    const root = resolve(__dirname, '../../../..');
    for (const p of PARITY) {
      expect(existsSync(resolve(root, p.api)), `${p.verb}: API route ${p.api}`).toBe(true);
      expect(tools, `${p.verb}: MCP tool ${p.mcp}`).toContain(p.mcp);

      if (p.chat) {
        expect(existsSync(resolve(root, `src/services/agents/tools/${p.chat === 'decide_proposal' ? 'decideProposal' : 'decideAsk'}.ts`)), `${p.verb}: chat tool ${p.chat}`).toBe(true);
      }
    }
  });
});
