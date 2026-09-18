import type { AgentEvent, RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const { renderTableTool } = await import('./renderArtifacts');
const { openArtifactId, readArtifactTool, updateArtifactTool } = await import('./editArtifacts');
const { getArtifact, listArtifactVersions } = await import('@/services/ArtifactService');

const ORG = 'org_edit_artifact_test';

function ctxFor(conversationId: number | undefined, events: AgentEvent[], pageContext?: unknown): RuntimeContext {
  return {
    orgId: ORG,
    agentSlug: 'revenue-lead',
    conversationId,
    pageContext,
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: (e: AgentEvent) => events.push(e),
    citationSeq: { current: 0 },
  } as unknown as RuntimeContext;
}

async function seedTable() {
  const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't', createdBy: 'u' });
  const events: AgentEvent[] = [];
  await renderTableTool(ctxFor(c.id, events)).invoke({
    title: 'Open deals',
    columns: [{ key: 'name' }, { key: 'amount' }],
    rows: [{ name: 'Acme', amount: 1200 }],
  });
  const ev = events.find(e => e.type === 'artifact');
  const id = ev && ev.type === 'artifact' ? ev.artifact.id : 0;
  return { conversationId: c.id, id };
}

describe('read_artifact / update_artifact', () => {
  it('reads the open artifact from the page context without an id', () => {
    expect(openArtifactId(ctxFor(1, [], { path: '/dashboard/chat/1', title: 't', record: { type: 'artifact', id: '42' } }))).toBe(42);
    expect(openArtifactId(ctxFor(1, [], { path: '/x', title: 't', refs: [{ type: 'briefing', id: 'b' }, { type: 'artifact', id: '9' }] }))).toBe(9);
    expect(openArtifactId(ctxFor(1, [], { path: '/x', title: 't' }))).toBeUndefined();
  });

  it('read_artifact returns the current spec so an edit modifies what is really there', async () => {
    const { conversationId, id } = await seedTable();
    const out = await readArtifactTool(ctxFor(conversationId, [])).invoke({ id });

    expect(JSON.parse(String(out))).toMatchObject({ id, kind: 'table', version: 1, spec: { rows: [{ name: 'Acme', amount: 1200 }] } });
  });

  it('update_artifact changes it in place, writes v2, and emits the new head', async () => {
    const { conversationId, id } = await seedTable();
    const events: AgentEvent[] = [];
    const out = await updateArtifactTool(ctxFor(conversationId, events)).invoke({
      id,
      spec: JSON.stringify({ columns: [{ key: 'name' }, { key: 'amount', type: 'currency' }], rows: [{ name: 'Acme', amount: 1200 }] }),
      change_summary: 'made Amount a currency column',
    });

    expect(String(out)).toMatch(/Updated "Open deals" to v2/);

    const row = await getArtifact({ orgId: ORG, id });

    expect(row?.currentVersion).toBe(2);
    expect((row?.spec as { columns: Array<{ type?: string }> }).columns[1]?.type).toBe('currency');
    expect(await listArtifactVersions({ orgId: ORG, artifactId: id })).toHaveLength(2);
    expect(events.at(-1) && events.at(-1)!.type === 'artifact' ? (events.at(-1) as { artifact: { version: number } }).artifact.version : 0).toBe(2);
  });

  it('falls back to the conversation’s last artifact when nothing names one, and refuses when there is nothing at all', async () => {
    const { conversationId, id } = await seedTable();
    const out = await updateArtifactTool(ctxFor(conversationId, [])).invoke({ title: 'Open deals (Q3)', change_summary: 'scoped to Q3' });

    expect(String(out)).toMatch(/to v2/);
    expect((await getArtifact({ orgId: ORG, id }))?.title).toBe('Open deals (Q3)');

    const empty = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'empty', createdBy: 'u' });
    const none = await updateArtifactTool(ctxFor(empty.id, [])).invoke({ title: 'x', change_summary: 'y' });

    expect(String(none)).toMatch(/No artifact is open/);
  });

  it('rejects a spec that breaks the kind’s schema with a message the model can act on', async () => {
    const { conversationId, id } = await seedTable();
    const out = await updateArtifactTool(ctxFor(conversationId, [])).invoke({
      id,
      spec: JSON.stringify({ columns: [], rows: [] }),
      change_summary: 'broke it',
    });

    expect(String(out)).toMatch(/update_artifact rejected: invalid table spec/);
    expect((await getArtifact({ orgId: ORG, id }))?.currentVersion).toBe(1);
  });

  it('needs something to change', async () => {
    const { conversationId, id } = await seedTable();
    const out = await updateArtifactTool(ctxFor(conversationId, [])).invoke({ id, change_summary: 'nothing' });

    expect(String(out)).toMatch(/needs at least one of/);
  });
});
