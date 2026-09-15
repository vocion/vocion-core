import type { AgentEvent, RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const { renderChartTool, renderTableTool } = await import('./renderArtifacts');
const { listArtifactsForConversation } = await import('@/services/ArtifactService');

const ORG = 'org_render_test';

function ctxFor(conversationId: number | undefined, events: AgentEvent[]): RuntimeContext {
  return {
    orgId: ORG,
    agentSlug: 'revenue-lead',
    conversationId,
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: (e: AgentEvent) => events.push(e),
    citationSeq: { current: 0 },
  } as unknown as RuntimeContext;
}

describe('render_* tools', () => {
  it('render_table persists an artifact, emits the event, and answers with a receipt (not the payload)', async () => {
    const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't', createdBy: 'u' });
    const events: AgentEvent[] = [];
    const t = renderTableTool(ctxFor(c.id, events));
    const out = await t.invoke({ title: 'Open deals', columns: JSON.stringify([{ key: 'name' }, { key: 'amount', type: 'currency' }]), rows: [{ name: 'Acme', amount: 1200 }], tile_slot: 2 });

    expect(String(out)).toMatch(/Rendered table "Open deals" \(1 rows\) as artifact #\d+/);
    expect(String(out)).not.toContain('Acme');

    const ev = events.find(e => e.type === 'artifact');

    expect(ev).toBeTruthy();
    expect(ev && ev.type === 'artifact' ? ev.artifact : null).toMatchObject({ kind: 'table', title: 'Open deals', tile: { slot: 2, span: 2 } });

    const rows = await listArtifactsForConversation({ orgId: ORG, conversationId: c.id });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.spec).toMatchObject({ columns: [{ key: 'name' }, { key: 'amount', type: 'currency' }] });
  });

  it('render_chart rejects a misaligned series with a fixable message and emits nothing', async () => {
    const events: AgentEvent[] = [];
    const t = renderChartTool(ctxFor(undefined, events));
    const out = await t.invoke({ title: 'Trend', type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'Pipeline', values: [1] }] });

    expect(String(out)).toMatch(/render_chart rejected: invalid chart spec/);
    expect(events).toHaveLength(0);
  });
});
