/** Opt-in integration test: a real remote sandbox MCP, with an isolated Review ledger. */
import type { Principal } from '@/services/authz';
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The local TLS fixture is deliberately loopback. Production validation remains unchanged.
vi.mock('@/libs/net/publicUrl', () => ({ resolvesPublicly: async () => ({ ok: true }) }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: async () => ({ baseUrl: process.env.FINANCE_TEST_URL, token: process.env.FINANCE_TEST_KEY }),
}));
const { db } = await import('@/libs/DB');
const { actionRunSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { proposeAction, executeAction } = await import('@/services/ActionService');
const { callMcpTool, listMcpTools, withMcp } = await import('@/libs/outboundMcp/client');

describe.skipIf(process.env.RUN_FINANCE_SANDBOX !== '1')('remote sandbox through Review', () => {
  it('proposes, approves, executes and verifies both finance writes', async () => {
    const orgId = 'org_sandbox_mcp_test';
    const principal: Principal = { kind: 'agent', id: 'agent:finance', grants: ['mcp_call'], autonomy: 5, scope: { orgId } };
    const sourceSlug = 'finance-sandbox';
    await db.insert(knowledgeSourceSchema).values({ orgId, slug: sourceSlug, configJson: {
      _connector: 'mcp',
      readTools: ['quickbooks_get', 'quickbooks_write_receipt'],
      writeTools: ['quickbooks_recategorize_expense', 'quickbooks_post_journal_entry'],
    } });
    const stamp = process.env.FINANCE_TEST_STAMP!;
    const proposals = [
      { tool: 'quickbooks_recategorize_expense', input: {
        expense_id: process.env.FINANCE_TEST_PURCHASE!,
        line_id: process.env.FINANCE_TEST_LINE!,
        to_account_id: process.env.FINANCE_TEST_TO_ACCOUNT!,
        expected_sync_token: process.env.FINANCE_TEST_SYNC!,
        expected_account_id: process.env.FINANCE_TEST_FROM_ACCOUNT!,
        idempotency_key: `recat-${stamp}`,
      } },
      { tool: 'quickbooks_post_journal_entry', input: {
        txn_date: '2026-10-15',
        memo: `MCP sandbox verification ${stamp}`,
        idempotency_key: `journal-${stamp}`,
        lines: [
          { account_id: process.env.FINANCE_TEST_FROM_ACCOUNT!, amount: '0.01', posting_type: 'Debit' },
          { account_id: process.env.FINANCE_TEST_TO_ACCOUNT!, amount: '0.01', posting_type: 'Credit' },
        ],
      } },
    ];
    const evidence = [];
    for (const proposal of proposals) {
      const pending = await proposeAction({ orgId, actionId: 'mcp.call', input: { sourceSlug, ...proposal, summary: 'Authorized sandbox integration test on disposable records' }, principal });

      expect(pending.status).toBe('pending');

      const done = await executeAction(pending.runId, orgId, { reviewedBy: 'sandbox-test-approval' });

      expect(done.status, done.error ?? undefined).toBe('done');

      const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, pending.runId));

      expect(row?.decidedBy).toBe('sandbox-test-approval');

      const remote = done.result?.result as { structuredContent?: { verified?: boolean; environment?: string; id?: string } };

      expect(remote.structuredContent).toMatchObject({ verified: true, environment: 'sandbox' });

      const credentials = { baseUrl: process.env.FINANCE_TEST_URL!, token: process.env.FINANCE_TEST_KEY! };
      // Replaying the identical approved arguments returns the same durable receipt.
      const replay = await withMcp(credentials, async (client) => {
        const tool = (await listMcpTools(client)).find(tool => tool.name === proposal.tool)!;
        return callMcpTool(client, tool, proposal.input);
      });

      expect(replay.structuredContent).toEqual(remote.structuredContent);

      evidence.push({ tool: proposal.tool, runId: pending.runId, proposed: pending.status, decidedBy: row?.decidedBy, status: done.status, receipt: remote.structuredContent, replayMatched: true });
      if (process.env.FINANCE_TEST_EVIDENCE) {
        writeFileSync(process.env.FINANCE_TEST_EVIDENCE, JSON.stringify(evidence, null, 2));
      }
    }
  }, 120_000);
});
