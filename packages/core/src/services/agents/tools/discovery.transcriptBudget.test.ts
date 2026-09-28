/**
 * `read_discovery_transcript` hands the follow-up agent a capped transcript
 * (vocion-core#280).
 *
 * The classifier's copy was capped, but this tool returned the whole joined
 * transcript, so a two-hour call put 100k+ characters into the lead agent's
 * context on its first tool call. The DB is the PGlite test mock; no model
 * is called.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, discoveryCandidateSchema, knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { CLASSIFIER_TRANSCRIPT_CHAR_BUDGET } = await import('@/services/DiscoveryDetectionService');
const { readDiscoveryTranscriptTool } = await import('./discovery');

const ORG = 'org_transcript_budget';
const EMBED = Array.from({ length: 1536 }, () => 0);

/** The langchain tool's overloads defeat direct .invoke() typing. */
type Invokable = { invoke: (input: Record<string, unknown>) => Promise<string> };

function ctx(): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    missionRunId: 7,
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

/**
 * A matched call a person approved for follow-up, with this transcript.
 * @param transcript - The call's text, stored as one chunk.
 * @returns The candidate id.
 */
async function seedApprovedCall(transcript: string): Promise<number> {
  const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'zoom', kind: 'plugin' }).returning({ id: knowledgeSourceSchema.id });
  const [doc] = await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: source!.id,
    externalId: 'zoom:long-call',
    title: 'Acme <> Metacto discovery',
    metadata: { kind: 'zoom-recording' },
    contentHash: 'hash-long',
  }).returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values({ documentId: doc!.id, orgId: ORG, chunkIdx: 0, content: transcript, contentTokens: 1, embedding: EMBED });
  const [review] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'discovery.review_proposal', status: 'done', input: {} }).returning({ id: actionRunSchema.id });
  const [candidate] = await db.insert(discoveryCandidateSchema).values({
    orgId: ORG,
    meetingExternalId: 'zoom:long-call',
    meetingDocId: doc!.id,
    matchType: 'hubspot-contact',
    status: 'routed',
    route: 'generate',
    reviewActionRunId: review!.id,
  }).returning({ id: discoveryCandidateSchema.id });
  return candidate!.id;
}

async function readTranscript(candidateId: number) {
  const tool = readDiscoveryTranscriptTool(ctx()) as unknown as Invokable;
  return JSON.parse(await tool.invoke({ candidate_id: candidateId })) as { transcript?: string; omittedChars?: number; note?: string; error?: string };
}

async function clear() {
  await db.delete(discoveryCandidateSchema);
  await db.delete(actionRunSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
}

beforeEach(clear);

afterAll(clear);

describe('read_discovery_transcript on a long call', () => {
  it('returns the start and end within the budget, and says how much of the middle was left out', async () => {
    const transcript = `OPENING ${'#'.repeat(150_000)} CLOSING`;
    const id = await seedApprovedCall(transcript);

    const result = await readTranscript(id);

    expect(result.error).toBeUndefined();
    expect(result.transcript!.length).toBeLessThan(CLASSIFIER_TRANSCRIPT_CHAR_BUDGET + 500);
    expect(result.transcript).toContain('OPENING');
    expect(result.transcript).toContain('CLOSING');
    expect(result.omittedChars).toBeGreaterThan(transcript.length - CLASSIFIER_TRANSCRIPT_CHAR_BUDGET - 1);
    expect(result.note).toContain('left out');
  });

  it('returns a short call whole, with no note', async () => {
    const id = await seedApprovedCall('We have 40 stores and need help with proposals.');

    const result = await readTranscript(id);

    expect(result.transcript).toContain('We have 40 stores and need help with proposals.');
    expect(result.omittedChars).toBeUndefined();
  });
});
