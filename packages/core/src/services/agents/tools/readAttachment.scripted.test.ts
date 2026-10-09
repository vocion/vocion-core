/**
 * An agent turn that reads an attached sheet, on the real harness. Only the
 * reasoning is written down, by the scripted model (`libs/llm/scripted.ts`):
 *
 *   - the user turn the model is handed carries the attachment's PREVIEW —
 *     the sheet's columns, its row count, its first rows and the file's id —
 *     and not the 1,200 rows;
 *   - its step calls `read_attachment` with no id, a filter and a group_by,
 *     and the tool really runs over all 1,200 rows of the stored original.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const scriptDir = mkdtempSync(path.join(tmpdir(), 'read-attachment-script-'));
const scriptFile = path.join(scriptDir, 'script.json');
writeFileSync(scriptFile, JSON.stringify({
  turns: [
    {
      match: 'which companies have the qualified leads',
      steps: [{ tool: 'read_attachment', args: { where: [{ column: 'Stage', op: 'equals', value: 'Qualified' }], group_by: 'Company' } }],
      reply: 'All 240 qualified leads sit at Contoso Supply.',
    },
  ],
  fallback: 'no line',
}));

const saved = { provider: process.env.VOCION_LLM_PROVIDER, script: process.env.VOCION_LLM_SCRIPT, runtime: process.env.VOCION_DISABLE_RUNTIME, dir: process.env.VOCION_ARTIFACTS_DIR };
process.env.VOCION_LLM_PROVIDER = 'scripted';
process.env.VOCION_LLM_SCRIPT = scriptFile;
process.env.VOCION_DISABLE_RUNTIME = '1';
process.env.VOCION_ARTIFACTS_DIR = mkdtempSync(path.join(tmpdir(), 'read-attachment-files-'));

vi.mock('@/libs/DB');
// The user turn exactly as the harness builds it, kept for the assertions.
const handed: unknown[] = [];
vi.mock('@/services/chat/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/chat/attachments')>();
  return {
    ...actual,
    composeUserContent: async (...args: Parameters<typeof actual.composeUserContent>) => {
      const out = await actual.composeUserContent(...args);
      handed.push(out);
      return out;
    },
  };
});

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { saveArtifact } = await import('@/libs/tools/artifacts/store');
const { createArtifact } = await import('@/services/ArtifactService');
const { convertUpload, loadedFromArtifact, uploadSpec } = await import('@/services/chat/attachments');
const fx = await import('@/services/chat/officeFixtures');
const { createConversation } = await import('@/services/ConversationService');
const { runAgentDeep } = await import('@/services/AgentService');

const ACCOUNT = 'acct-attach-northwind';
const ORG = 'proj-attach-revenue';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-attach' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'revenue-attach', name: 'Revenue', leadAgentSlug: 'revenue-lead' });
  await db.insert(agentSchema).values({ orgId: ORG, projectId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'You lead revenue.', role: 'lead', active: 'true' });
});

afterAll(() => {
  for (const [key, value] of [['VOCION_LLM_PROVIDER', saved.provider], ['VOCION_LLM_SCRIPT', saved.script], ['VOCION_DISABLE_RUNTIME', saved.runtime], ['VOCION_ARTIFACTS_DIR', saved.dir]] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('an agent turn with an attached spreadsheet', () => {
  it('sees the preview, then reads every row of the sheet through read_attachment', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: 'usr-sam' });
    // What the upload route does with Export-All-Leads.xlsx.
    const name = 'Export-All-Leads.xlsx';
    const data = await fx.workbook({ Leads: fx.leadRows(1200) });
    const stored = await saveArtifact({ orgId: ORG, data, ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const converted = await convertUpload(data, { name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { artifact } = await createArtifact({
      orgId: ORG,
      conversationId: conv.id,
      kind: 'file',
      title: name,
      spec: uploadSpec({ filename: stored.filename, originalName: name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: stored.bytes, url: stored.url, text: converted.text, sheets: converted.sheets }),
      url: stored.url,
      author: { kind: 'human', id: 'usr-sam' },
      visibility: 'user',
      changeSummary: 'Uploaded',
    });

    const result = await runAgentDeep({
      orgId: ORG,
      agentSlug: 'revenue-lead',
      message: 'Which companies have the qualified leads?',
      userId: 'usr-sam',
      conversationId: conv.id,
      attachments: [loadedFromArtifact(artifact)],
      onEvent: () => {},
    });

    expect(result.response).toContain('All 240 qualified leads sit at Contoso Supply.');

    // The model was handed the preview under the message: the shape, the
    // first rows, the way to the rest — not the whole sheet.
    const turn = String(handed.at(-1));

    expect(turn).toContain(`--- attached: Export-All-Leads.xlsx (Excel spreadsheet, `);
    expect(turn).toContain(`file #${artifact.id}; read_attachment(id: ${artifact.id})`);
    expect(turn).toContain('1,200 rows × 5 columns');
    expect(turn).toContain('| Lead 020 |');
    expect(turn).not.toContain('Lead 021');
    expect(turn).toContain('(1,180 more rows not shown. Read, filter or count every row with read_attachment.)');

    // And the tool counted over the whole sheet, not the twenty preview rows.
    const call = result.toolCalls.find(c => c.tool === 'read_attachment');

    expect(call?.output).toContain('Export-All-Leads.xlsx · sheet “Leads” · 1,200 rows');
    expect(call?.output).toContain('Filter: Stage equals "Qualified" → 240 matching rows.');
    expect(call?.output).toContain('Counts by Company over 240 rows (1 distinct value):');
    expect(call?.output).toContain('Contoso Supply,240');
  });
});
