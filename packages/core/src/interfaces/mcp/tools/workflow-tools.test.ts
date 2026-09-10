/**
 * `workflow_run_resume` over the real MCP wire (vocion-core#111 follow-up).
 *
 * `workflow-tools.ts` does no error handling of its own — it hands
 * `resumeWorkflow`'s rejection straight up the call stack. Nothing in this
 * repo previously drove a `WorkflowRunNotResumableError` through the actual
 * MCP transport, so there was no proof an MCP caller sees a readable error
 * ("this run isn't resumable") rather than a crashed tool call or an opaque
 * failure. This test drives a real client through a real server
 * (`InMemoryTransport`, same setup as `agent-tools.test.ts`) against the real
 * `WorkflowService` — no mocking — end to end.
 *
 * Note on scope: the MCP SDK's own tool dispatcher already catches a
 * thrown error before it would otherwise reach the transport, so this test
 * does not by itself pin down where in the stack that catch has to live —
 * it pins down the observable contract an MCP caller depends on: a resume
 * that cannot proceed comes back as `isError: true` with the typed error's
 * message, never a rejected `callTool()`.
 */
import type { McpConfig } from '../config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/libs/Langfuse', () => {
  const fakeTrace = () => ({
    id: 'test-trace',
    generation: () => ({ end: vi.fn() }),
    span: () => ({ end: vi.fn() }),
    update: vi.fn(),
    event: vi.fn(),
  });
  return {
    flushTraces: vi.fn(async () => {}),
    getLangfuseClient: () => ({ trace: fakeTrace }),
    traceFor: fakeTrace,
    cleanUsageDetails: (x: Record<string, number | undefined>) => x,
  };
});

const { db } = await import('@/libs/DB');
const { workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { startWorkflow } = await import('@/services/WorkflowService');
const { buildServer } = await import('../server');

const ORG = 'test_org_mcp_workflow_resume';

function configFor(): McpConfig {
  return {
    orgId: ORG,
    contextPath: '/tmp/does-not-matter-for-this-test',
    autoCommit: false,
    autoApply: false,
    serverName: 'vocion-test',
    serverVersion: '0.0.0',
  };
}

async function setupClientServer() {
  const server = await buildServer(configFor(), { userId: 'mcp' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

function resultText(result: ToolResult): string {
  return result.content?.find(c => c.type === 'text')?.text ?? '';
}

beforeEach(async () => {
  await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
  await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
});

afterEach(async () => {
  await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
  await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
});

describe('workflow_run_resume over MCP', () => {
  it('reports the typed not-resumable error as a tool error instead of crashing the call', async () => {
    const [wf] = await db.insert(workflowSchema).values({
      orgId: ORG,
      slug: 'no_gate',
      name: 'no_gate',
      version: 1,
      status: 'active',
      trigger: { type: 'manual' },
      steps: [{ name: 's', type: 'action', action: 'log', input: {} }],
    }).returning();

    // No approve/ask step, so this finishes on its own — already completed by
    // the time we ask to resume it, same as a real "double-click after it
    // already finished" caller.
    const run = await startWorkflow({ orgId: ORG, slug: 'no_gate' });

    expect(run.status).toBe('completed');
    expect(wf).toBeDefined();

    const client = await setupClientServer();
    const result = await client.callTool({ name: 'workflow_run_resume', arguments: { run_id: run.id } }) as ToolResult;

    // The MCP contract for a failed call is `isError: true` with the reason
    // as text — not a thrown/rejected `callTool`. A regression that let the
    // error escape the handler uncaught would fail this call outright rather
    // than return a result at all.
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('not resumable');
    expect(resultText(result)).toContain(`workflow_run ${run.id}`);
  });

  it('still succeeds normally when the run really is resumable', async () => {
    await db.insert(workflowSchema).values({
      orgId: ORG,
      slug: 'has_gate',
      name: 'has_gate',
      version: 1,
      status: 'active',
      trigger: { type: 'manual' },
      steps: [
        { name: 'gate', type: 'approve', prompt: 'go?' },
        { name: 'after', type: 'action', action: 'log', input: {} },
      ],
    }).returning();

    const run = await startWorkflow({ orgId: ORG, slug: 'has_gate' });

    expect(run.status).toBe('paused');

    const client = await setupClientServer();
    const result = await client.callTool({ name: 'workflow_run_resume', arguments: { run_id: run.id } }) as ToolResult;

    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain('"status": "completed"');
  });
});
