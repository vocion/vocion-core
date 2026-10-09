/**
 * A spreadsheet attached in chat, end to end below the model: the upload
 * route stores the original and a preview, and `read_attachment` reads every
 * row of the original — filtered, counted, paged — without the preview's
 * limits. Fixtures are fictional and built in the test (`officeFixtures.ts`).
 */
import type { RuntimeContext } from '../types';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_ARTIFACTS_DIR = mkdtempSync(path.join(tmpdir(), 'read-attachment-'));

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { POST } = await import('@/app/api/chat/attachments/route');
const { getArtifact } = await import('@/services/ArtifactService');
const { createConversation } = await import('@/services/ConversationService');
const fx = await import('@/services/chat/officeFixtures');
const { clearAttachmentCache, readAttachmentTool } = await import('./readAttachment');

const ORG = 'proj-read-attachment';
const OTHER_ORG = 'proj-read-attachment-other';

function ctxFor(orgId: string, conversationId?: number): RuntimeContext {
  return { orgId, agentSlug: 'revenue-lead', conversationId, emit: () => {}, citationSeq: { current: 0 } } as unknown as RuntimeContext;
}

async function upload(name: string, data: Uint8Array, orgId = ORG): Promise<Response> {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'usr-sam', orgId, accountId: 'acct-northwind', projectId: orgId, role: 'member', workspaceRole: 'member', has: () => true } as never);
  const form = new FormData();
  form.append('file', new Blob([data as BlobPart]), name);
  return POST(new Request('https://app.northwind.example/api/chat/attachments', { method: 'POST', body: form }));
}

async function uploadId(name: string, data: Uint8Array, orgId = ORG): Promise<number> {
  const res = await upload(name, data, orgId);

  expect(res.status).toBe(201);

  return ((await res.json()) as { attachments: Array<{ id: number }> }).attachments[0]!.id;
}

const read = (args: Record<string, unknown>, orgId = ORG, conversationId?: number) => readAttachmentTool(ctxFor(orgId, conversationId)).invoke(args).then(String);

beforeEach(() => {
  resetMemoryRateLimits();
  clearAttachmentCache();
});

describe('the upload route', () => {
  it('stores an Excel file with a summarised preview and its shape — never the 1,200 rows', async () => {
    const id = await uploadId('Export-All-Leads.xlsx', await fx.workbook({ Leads: fx.leadRows(1200) }));
    const row = await getArtifact({ orgId: ORG, id });
    const spec = row!.spec as { text: string; sheets: unknown; contentType: string };

    expect(row).toMatchObject({ kind: 'file', title: 'Export-All-Leads.xlsx' });
    expect(spec.sheets).toEqual([{ name: 'Leads', rows: 1200, columns: ['Name', 'Company', 'Email', 'Stage', 'Deal size'] }]);
    expect(spec.text).toContain('1,200 rows × 5 columns');
    expect(spec.text).not.toContain('Lead 1200');
  });

  it('keeps the text it converted on the saved row (the file spec used to strip it, and the model read "no text")', async () => {
    const id = await uploadId('notes.txt', new TextEncoder().encode('Kestrel Capital renews in November.'));
    const spec = (await getArtifact({ orgId: ORG, id }))!.spec as Record<string, unknown>;

    expect(spec).toMatchObject({ text: 'Kestrel Capital renews in November.', originalName: 'notes.txt', uploaded: true });
  });

  it('answers an unreadable file with the plain-language copy', async () => {
    const res = await upload('Q4 board.key', new TextEncoder().encode('not really keynote'));
    const body = await res.json() as { error: { message: string } };

    expect(res.status).toBe(415);
    expect(body.error.message).toBe('Vocion can\'t read .key files yet. Export it as PDF or PowerPoint.');
  });
});

describe('read_attachment on a sheet', () => {
  it('filters every row, not just the preview, and says how many matched', async () => {
    const id = await uploadId('leads.xlsx', await fx.workbook({ Leads: fx.leadRows(1200) }));
    const out = await read({ id, where: [{ column: 'stage', op: 'equals', value: 'Qualified' }, { column: 'Deal size', op: 'gte', value: 5000 }], limit: 3 });

    // Stage Qualified is i % 5 === 2; deal size ≥ 5000 is (i % 7) + 1 ≥ 5.
    const expected = Array.from({ length: 1200 }, (_, k) => k + 1).filter(i => i % 5 === 2 && (i % 7) + 1 >= 5);

    expect(out).toContain('leads.xlsx · sheet “Leads” · 1,200 rows');
    expect(out).toContain(`Filter: stage equals "Qualified" and Deal size gte 5000 → ${expected.length} matching rows.`);
    expect(out).toContain(`row,Name,Company,Email,Stage,Deal size\n${expected[0]! + 1},Lead ${String(expected[0]).padStart(3, '0')},`);
    expect(out).toContain(`Showing 1–3 of ${expected.length}. Call again with offset: 3`);
  });

  it('counts rows per value with group_by instead of reading them', async () => {
    const id = await uploadId('leads.xlsx', await fx.workbook({ Leads: fx.leadRows(1200) }));
    const out = await read({ id, group_by: 'Company' });

    expect(out).toContain('Counts by Company over 1,200 rows (5 distinct values):');
    expect(out).toContain('Northwind,240');
    expect(out).toContain('Kestrel Capital,240');
  });

  it('pages to the very last row, with only the columns asked for', async () => {
    const id = await uploadId('leads.xlsx', await fx.workbook({ Leads: fx.leadRows(1200) }));
    const out = await read({ id, columns: ['Name', 'Email'], offset: 1198, limit: 50 });

    expect(out).toContain('row,Name,Email\n1200,Lead 1199,');
    expect(out).toContain('1201,Lead 1200,lead1200@northwind.example');
    expect(out).toContain('Showing 1,199–1,200 of 1,200 — that is every row.');
  });

  it('picks a sheet by name and names the columns when asked for one that is not there', async () => {
    const id = await uploadId('book.xlsx', await fx.workbook({ Leads: fx.leadRows(3), Owners: [['Owner', 'Region'], ['Sam Ito', 'West']] }));

    expect(await read({ id, sheet: 'owners' })).toContain('2,Sam Ito,West');
    expect(await read({ id, sheet: 'Owners', columns: ['Territory'] })).toBe('Sheet “Owners” has no column “Territory”. Its columns: Owner, Region.');
    expect(await read({ id, sheet: 'Pipeline' })).toBe('book.xlsx has no sheet “Pipeline”. Its sheets: “Leads”, “Owners”.');
  });

  it('caps a page at 200 rows whatever the limit asked', async () => {
    const id = await uploadId('leads.csv', new TextEncoder().encode(fx.leadRows(500).map(r => r.join(',')).join('\n')));
    const out = await read({ id, limit: 10_000 });

    expect(out).toContain('Showing 1–200 of 500. Call again with offset: 200');
  });
});

describe('read_attachment on a document', () => {
  it('reads by range and finds paragraphs by search', async () => {
    const id = await uploadId('plan.docx', await fx.docx());

    expect(await read({ id })).toContain('# Northwind renewal plan');
    expect(await read({ id, search: 'kestrel' })).toContain('1 paragraph contain "kestrel".\n\n[at ');
  });

  it('reads the deck slide by slide', async () => {
    const id = await uploadId('review.pptx', await fx.pptx());

    expect(await read({ id })).toContain('## Slide 2: Pipeline');
  });
});

describe('read_attachment scope', () => {
  it('finds the latest upload in the conversation when no id is given', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'leads', createdBy: 'usr-sam' });
    const id = await uploadId('later.xlsx', await fx.workbook({ Leads: fx.leadRows(2) }));
    const { db } = await import('@/libs/DB');
    const { artifactSchema } = await import('@/models/Schema');
    const { eq } = await import('drizzle-orm');
    await db.update(artifactSchema).set({ conversationId: conv.id }).where(eq(artifactSchema.id, id));

    expect(await read({}, ORG, conv.id)).toContain('later.xlsx · sheet “Leads” · 2 rows');
    expect(await read({}, ORG, undefined)).toContain('No file is attached in this conversation.');
  });

  it('reads another workspace\'s file as missing', async () => {
    const id = await uploadId('private.xlsx', await fx.workbook({ Leads: fx.leadRows(2) }), OTHER_ORG);

    expect(await read({ id }, ORG)).toBe(`No attached file #${id} in this workspace.`);
  });
});
