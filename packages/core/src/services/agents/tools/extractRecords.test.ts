/**
 * extract_records in a person's turn: the badges they dropped are read (the
 * model is scripted, the images are the fictional fixtures), the clear ones
 * are written, and what is held comes up as ONE Decision docked in the
 * conversation — raised by the tool, not left to the agent to remember.
 */
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const READINGS: Record<string, unknown> = {
  'badge-jamie-smith.png': { readable: true, records: [{ confidence: 0.95, fields: [
    { name: 'name', value: 'Jamie Smith', confidence: 0.98 },
    { name: 'company', value: 'Contoso Supply', confidence: 0.97 },
    { name: 'email', value: 'jamie.smith@contoso.example', confidence: 0.9 },
  ] }] },
  'badge-blurred.png': { readable: false, reason: 'too blurred', records: [] },
};

vi.mock('@/libs/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/llm')>();
  return {
    ...real,
    buildChatModelForOrg: vi.fn(async () => ({
      invoke: async (messages: Array<{ content: unknown }>) => {
        const human = messages[1]!.content as Array<{ text?: string }>;
        const file = /File: (\S+)/.exec(human[0]!.text!)![1]!;
        return { content: JSON.stringify(READINGS[file]) };
      },
    })),
  };
});

process.env.VOCION_ARTIFACTS_DIR = path.join(import.meta.dirname, '../../intake/fixtures');

const { db } = await import('@/libs/DB');
const { artifactSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { createConversation } = await import('@/services/ConversationService');
const { extractRecordsTool } = await import('./extractRecords');

const ORG = 'org_extract_tool';
const USER = 'usr_extract_alex';
let conversationId = 0;

beforeAll(async () => {
  await createObjectType({ slug: 'lead', label: 'Lead', schema: { 'x-identity': { email: 'email', name: 'name', company: 'company' }, 'properties': { name: { type: 'string' }, email: { type: 'string', format: 'email' }, company: { type: 'string' }, event: { type: 'string' } } } } as never, ORG);
  conversationId = (await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', createdBy: USER })).id;
  for (const f of ['badge-jamie-smith.png', 'badge-blurred.png']) {
    await db.insert(artifactSchema).values({ orgId: ORG, conversationId, kind: 'file', title: f, spec: { filename: f, originalName: f, contentType: 'image/png', bytes: 1, url: '/x', uploaded: true }, lastAuthorKind: 'human', lastAuthorId: USER, createdBy: USER });
  }
});

describe('extract_records', () => {
  it('writes the clear badge, then docks one Decision for the rest', async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const ctx = { orgId: ORG, userId: USER, agentSlug: 'revenue-lead', conversationId, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: (e: never) => events.push(e), citationSeq: { current: 0 } };
    const tool = extractRecordsTool(ctx as never);
    const out = await (tool as unknown as { invoke: (a: unknown) => Promise<string> }).invoke({ object_type: 'lead', room: 'Northwind Expo 2026 — badges', set: { event: 'Northwind Expo 2026' } });

    expect(out).toContain('Added 1: [Jamie Smith]');
    expect(out).toContain('ONE decision docked');

    const decision = events.find(e => e.type === 'decision') as { decision: { question: string; options: Array<{ id: string }> } } | undefined;

    expect(decision?.decision.question).toBe('1 unreadable — leave them out?');
    expect(decision?.decision.options.map(o => o.id)).toEqual(['skip']);
    expect(events.some(e => e.type === 'record_created')).toBe(true);
  });

  it('says plainly when there is nothing new to read', async () => {
    const ctx = { orgId: ORG, userId: USER, agentSlug: 'revenue-lead', conversationId, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } };
    const out = await (extractRecordsTool(ctx as never) as unknown as { invoke: (a: unknown) => Promise<string> }).invoke({ object_type: 'lead', room: 'Northwind Expo 2026 — badges' });

    expect(out).toMatch(/^Nothing read: Every file here has been read already/);
  });
});
