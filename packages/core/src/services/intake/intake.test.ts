/**
 * List intake against PGlite, with a scripted reader: badges and booth notes
 * from a fictional event (Northwind Expo 2026) become Lead records with
 * per-field provenance; the same person read twice is one record; a person
 * already on file or already in the CRM, a record the reader was unsure of
 * and a blurred badge are held for ONE Decision; choosing "merge" settles
 * them, and Undo puts everything back. Every name and address is invented.
 */
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const { artifactSchema, businessObjectSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { createConversation } = await import('@/services/ConversationService');
const { intakeDecision, intakeSources, IntakeError } = await import('./intake');
const { recordsSettleIntakeAction } = await import('@/libs/actions/records-settle-intake');

const ORG = 'org_list_intake';
const USER = 'usr_intake_alex';
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const LEAD_SCHEMA = {
  'type': 'object',
  'x-identity': { email: 'email', name: 'name', company: 'company' },
  'properties': {
    name: { type: 'string', description: 'Full name as printed' },
    email: { type: 'string', format: 'email' },
    company: { type: 'string' },
    title: { type: 'string', description: 'Job title' },
    event: { type: 'string' },
    met_by: { type: 'string' },
    interest: { type: 'string', description: 'What they asked about' },
  },
};

/** What the scripted reader "sees" on each file, by file name. */
const READINGS: Record<string, unknown> = {
  'badge-jamie-smith.png': { readable: true, records: [{ confidence: 0.95, fields: [
    { name: 'name', value: 'Jamie Smith', confidence: 0.98, page: 1 },
    { name: 'company', value: 'Contoso Supply', confidence: 0.97, page: 1 },
    { name: 'title', value: 'Head of Operations', confidence: 0.92, page: 1 },
    { name: 'email', value: 'jamie.smith@contoso.example', confidence: 0.9, page: 1 },
  ] }] },
  'badge-dana-reyes.png': { readable: true, records: [{ confidence: 0.94, fields: [
    { name: 'name', value: 'Dana Reyes', confidence: 0.98 },
    { name: 'company', value: 'Kestrel Capital', confidence: 0.96 },
    { name: 'email', value: 'dana@kestrel.example', confidence: 0.91 },
  ] }] },
  'badge-rowan-pike.png': { readable: true, records: [{ confidence: 0.93, fields: [
    { name: 'name', value: 'Rowan Pike', confidence: 0.97 },
    { name: 'company', value: 'Tideline Gaming Marketing', confidence: 0.95 },
    { name: 'title', value: 'Growth Lead', confidence: 0.9 },
    { name: 'email', value: 'ROWAN@tideline.example', confidence: 0.9 },
  ] }] },
  'badge-blurred.png': { readable: false, reason: 'the badge is too blurred to read', records: [] },
  'booth-notes.txt': { readable: true, records: [
    { confidence: 0.9, fields: [
      { name: 'name', value: 'Jamie Smith', confidence: 0.9, row: 1 },
      { name: 'company', value: 'Contoso Supply', confidence: 0.9, row: 1 },
      { name: 'interest', value: 'pricing for 40 seats', confidence: 0.85, row: 1, quote: 'wants pricing for 40 seats' },
    ] },
    { confidence: 0.4, note: 'card lost; only an initial', fields: [
      { name: 'name', value: 'R. Okafor', confidence: 0.5, row: 2 },
      { name: 'company', value: 'Harbor & Finch', confidence: 0.8, row: 2 },
    ] },
  ] },
};

const NOTES = [
  'Northwind Expo 2026 — booth notes (Alex)',
  '- Jamie Smith, Contoso Supply: came back after the panel, wants pricing for 40 seats.',
  '- Harbor & Finch: R. Okafor? card lost, maybe their ops lead.',
].join('\n');

/** A reader that answers from READINGS by the file named in the message. */
function scriptedReader() {
  const seen: Array<{ file: string; image: boolean }> = [];
  const invoke = vi.fn(async (messages: Array<{ content: unknown }>) => {
    const human = messages[1]!.content;
    const text = typeof human === 'string' ? human : (human as Array<{ type: string; text?: string }>)[0]!.text!;
    const file = /File: (\S+)/.exec(text)![1]!;
    seen.push({ file, image: Array.isArray(human) });
    return { content: JSON.stringify(READINGS[file]), usage_metadata: { input_tokens: 900, output_tokens: 120, total_tokens: 1020 } };
  });
  return { model: { invoke } as never, seen, invoke };
}

let conversationId = 0;
const uploadIds: Record<string, number> = {};

async function upload(name: string, opts: { image?: boolean; text?: string }) {
  const [row] = await db.insert(artifactSchema).values({
    orgId: ORG,
    conversationId,
    kind: 'file',
    title: name,
    spec: { filename: name, originalName: name, contentType: opts.image ? 'image/png' : 'text/plain', bytes: 1000, url: '/x', uploaded: true, ...(opts.text ? { text: opts.text } : {}) },
    lastAuthorKind: 'human',
    lastAuthorId: USER,
    createdBy: USER,
  }).returning();
  uploadIds[name] = row!.id;
}

beforeAll(async () => {
  await createObjectType({ slug: 'lead', label: 'Lead', schema: LEAD_SCHEMA } as never, ORG);
  // Rowan is already a Lead here, written by hand.
  const [type] = await db.select().from((await import('@/models/Schema')).businessObjectTypeSchema).where(eq((await import('@/models/Schema')).businessObjectTypeSchema.orgId, ORG));
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Rowan Pike', metadata: { name: 'Rowan Pike', email: 'rowan@tideline.example', company: 'Tideline Gaming Marketing' } });
  // Dana is a contact the CRM sync mirrored.
  const [src] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', configJson: { _connector: 'hubspot' } }).returning();
  await db.insert(knowledgeDocumentSchema).values({ orgId: ORG, sourceId: src!.id, externalId: 'contacts:5101', title: 'Dana Reyes', contentHash: 'h1', metadata: { objectType: 'contacts', primaryEmail: 'dana@kestrel.example', company: 'Kestrel Capital' } });

  const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });
  conversationId = conv.id;
  for (const f of ['badge-jamie-smith.png', 'badge-dana-reyes.png', 'badge-rowan-pike.png', 'badge-blurred.png']) {
    await upload(f, { image: true });
  }
  await upload('booth-notes.txt', { text: NOTES });
});

const readImage = async (filename: string) => readFile(path.join(FIXTURES, filename)).catch(() => null as Buffer | null);

describe('extracting records from dropped files', () => {
  let result: Awaited<ReturnType<typeof intakeSources>>;
  let reader: ReturnType<typeof scriptedReader>;

  beforeAll(async () => {
    reader = scriptedReader();
    result = await intakeSources({
      orgId: ORG,
      userId: USER,
      agentSlug: 'revenue-lead',
      conversationId,
      objectType: 'lead',
      roomTitle: 'Northwind Expo 2026 — badges',
      set: { event: 'Northwind Expo 2026', met_by: 'Alex', mood: 'great' },
      hint: 'badges scanned at our booth',
      model: reader.model,
      readImage,
    });
  });

  it('reads each file once, images as images', () => {
    expect(reader.seen).toHaveLength(5);
    expect(reader.seen.find(s => s.file === 'badge-jamie-smith.png')?.image).toBe(true);
    expect(reader.seen.find(s => s.file === 'booth-notes.txt')?.image).toBe(false);
  });

  it('writes the clear record once, though two files saw the same person', async () => {
    expect(result.created.map(c => c.title)).toEqual(['Jamie Smith']);
    expect(result.merged).toBe(1);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, result.created[0]!.id));

    expect(row!.metadata).toMatchObject({ name: 'Jamie Smith', email: 'jamie.smith@contoso.example', interest: 'pricing for 40 seats', event: 'Northwind Expo 2026', met_by: 'Alex' });
  });

  it('keeps where every value came from on the record', async () => {
    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, result.created[0]!.id));
    const prov = row!.provenance as { sources: Array<{ artifactId: number }>; fields: Record<string, Record<string, unknown>>; intake: { roomId: number } };

    expect(prov.sources.map(s => s.artifactId).sort()).toEqual([uploadIds['badge-jamie-smith.png'], uploadIds['booth-notes.txt']].sort());
    expect(prov.fields.name).toMatchObject({ artifactId: uploadIds['badge-jamie-smith.png'], page: 1, confidence: 0.98, from: 'file' });
    expect(prov.fields.interest).toMatchObject({ artifactId: uploadIds['booth-notes.txt'], row: 1, quote: 'wants pricing for 40 seats' });
    expect(prov.fields.event).toEqual({ confidence: 1, from: 'conversation' });
    expect(prov.intake.roomId).toBe(result.room.id);
  });

  it('drops a value the type does not declare, and says so', () => {
    expect(result.ignoredSet).toEqual(['mood']);
  });

  it('files every upload into the room the agent named, as the room\'s evidence', async () => {
    expect(result.room).toMatchObject({ title: 'Northwind Expo 2026 — badges', created: true });

    const rows = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.conversationId, conversationId)));

    expect(rows.every(r => r.recordType === 'object' && r.recordId === String(result.room.id) && r.recordRole === `source:${r.id}`)).toBe(true);
  });

  it('holds what it could not settle: unreadable, already on file, already in the CRM, unsure', () => {
    const byReason = (r: string) => result.pending.filter(p => p.reason === r).map(p => p.label).sort();

    expect(byReason('unreadable')).toEqual(['badge-blurred.png']);
    expect(byReason('duplicate')).toEqual(['Dana Reyes', 'Rowan Pike']);
    expect(byReason('uncertain')).toEqual(['R. Okafor']);
    expect(result.pending.find(p => p.label === 'Dana Reyes')!.match).toMatchObject({ kind: 'crm', system: 'hubspot', systemLabel: 'HubSpot', externalId: '5101', on: 'email' });
    expect(result.pending.find(p => p.label === 'Rowan Pike')!.match).toMatchObject({ kind: 'record', on: 'email' });
  });

  it('puts them to the person as ONE Decision, merge recommended', () => {
    const d = intakeDecision(result, { conversationId })!;

    expect(d.question).toBe('1 unreadable · 1 already in HubSpot · 1 already on file · 1 unsure — merge?');
    expect(d.options.map(o => o.id)).toEqual(['merge', 'add', 'skip']);
    expect(d.options[0]!.recommended).toBe(true);
    expect(d.options[0]!.action!.input).toMatchObject({ choice: 'merge', objectType: 'lead', roomId: result.room.id });
    expect((d.options[0]!.action!.input.items as unknown[]).length).toBe(3);
    expect(d.contextMd).toContain('| badge-blurred.png | unreadable | the badge is too blurred to read |');
  });

  it('does not read a file twice', async () => {
    await expect(intakeSources({ orgId: ORG, userId: USER, agentSlug: 'revenue-lead', conversationId, objectType: 'lead', roomTitle: 'Northwind Expo 2026 — badges', model: scriptedReader().model, readImage })).rejects.toThrow(IntakeError);
  });

  it('settles the held items on "merge", and Undo puts them back', async () => {
    const d = intakeDecision(result, { conversationId })!;
    const input = recordsSettleIntakeAction.inputSchema.parse(d.options[0]!.action!.input);
    const done = await recordsSettleIntakeAction.execute({ orgId: ORG, reviewedBy: USER }, input);

    // Rowan's record gains what the badge added and keeps what was written.
    const [rowan] = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.title, 'Rowan Pike')));

    expect(rowan!.metadata).toMatchObject({ email: 'rowan@tideline.example', title: 'Growth Lead', event: 'Northwind Expo 2026' });

    // Dana becomes a Lead linked to her CRM contact; R. Okafor is added as read.
    const [dana] = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.title, 'Dana Reyes')));

    expect(dana).toMatchObject({ externalSystem: 'hubspot', externalId: '5101' });
    expect((done.created as unknown[]).length).toBe(2);
    expect((done.merged as unknown[]).length).toBe(1);

    await recordsSettleIntakeAction.undo!({ orgId: ORG }, input, done as Record<string, unknown>);
    const after = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));

    expect(after.map(r => r.title).sort()).toEqual(['Jamie Smith', 'Northwind Expo 2026 — badges', 'Rowan Pike']);
    expect(after.find(r => r.title === 'Rowan Pike')!.metadata).toEqual({ name: 'Rowan Pike', email: 'rowan@tideline.example', company: 'Tideline Gaming Marketing' });
  });
});

describe('refusals in words the agent can act on', () => {
  it('names the types there are when the one asked for is not', async () => {
    await expect(intakeSources({ orgId: ORG, userId: USER, agentSlug: null, conversationId, objectType: 'contact', roomTitle: 'x', readImage })).rejects.toThrow(/No object type "contact" here\. Types: lead/);
  });

  it('says there is nothing to read in a conversation with no files', async () => {
    const conv = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER });

    await expect(intakeSources({ orgId: ORG, userId: USER, agentSlug: null, conversationId: conv.id, objectType: 'lead', roomTitle: 'x', readImage })).rejects.toThrow(/No files were dropped/);
  });
});

void Buffer;
