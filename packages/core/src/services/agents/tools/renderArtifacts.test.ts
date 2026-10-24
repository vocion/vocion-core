import type { AgentEvent, RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const { renderChartTool, renderMarkdownTool, renderTableTool } = await import('./renderArtifacts');
const { listArtifactsForConversation, listArtifactVersions } = await import('@/services/ArtifactService');

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
  it('render_table persists an artifact at v1, emits the event, and answers with a receipt (not the payload)', async () => {
    const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't', createdBy: 'u' });
    const events: AgentEvent[] = [];
    const t = renderTableTool(ctxFor(c.id, events));
    const out = await t.invoke({ title: 'Open deals', columns: JSON.stringify([{ key: 'name' }, { key: 'amount', type: 'currency' }]), rows: [{ name: 'Acme', amount: 1200 }] });

    expect(String(out)).toMatch(/Rendered table "Open deals" \(1 rows\) as artifact #\d+/);
    expect(String(out)).toMatch(/update_artifact/);
    expect(String(out)).not.toContain('Acme');

    const ev = events.find(e => e.type === 'artifact');

    expect(ev && ev.type === 'artifact' ? ev.artifact : null).toMatchObject({ kind: 'table', title: 'Open deals', version: 1, authorKind: 'agent' });

    const rows = await listArtifactsForConversation({ orgId: ORG, conversationId: c.id });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.spec).toMatchObject({ columns: [{ key: 'name' }, { key: 'amount', type: 'currency' }] });
    expect(await listArtifactVersions({ orgId: ORG, artifactId: rows[0]!.id })).toHaveLength(1);
  });

  it('render_markdown emits a pending shell before the row exists, then the settled artifact, and honours a folder', async () => {
    const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't2', createdBy: 'u' });
    const events: AgentEvent[] = [];
    const t = renderMarkdownTool(ctxFor(c.id, events));
    await t.invoke({ title: 'Release readiness', md: '# Ready', folder: 'Revenue / Weekly' });

    const artifactEvents = events.filter(e => e.type === 'artifact');

    expect(artifactEvents).toHaveLength(2);
    expect(artifactEvents[0]).toMatchObject({ pending: true });
    expect(artifactEvents[1] && artifactEvents[1].type === 'artifact' ? artifactEvents[1].artifact : null)
      .toMatchObject({ kind: 'markdown', folder: 'revenue/weekly', version: 1 });
  });

  it('render_chart rejects a misaligned series with a fixable message and emits nothing', async () => {
    const events: AgentEvent[] = [];
    const t = renderChartTool(ctxFor(undefined, events));
    const out = await t.invoke({ title: 'Trend', type: 'line', x: ['Jan', 'Feb'], series: [{ name: 'Pipeline', values: [1] }] });

    expect(String(out)).toMatch(/render_chart rejected: invalid chart spec/);
    expect(events).toHaveLength(0);
  });

  it('render_chart refuses only data it cannot draw honestly, says what to fix, and emits nothing', async () => {
    const events: AgentEvent[] = [];
    const t = renderChartTool(ctxFor(undefined, events));
    const out = String(await t.invoke({ title: 'Booked and pipeline by month', type: 'bar', x: ['Sep', 'Oct'], series: [{ name: 'Booked', values: [1, 2] }, { name: 'Pipeline', values: [1, 1] }], stack: 'stack', totals: [2, 9], format: 'currency' }));

    expect(out).toMatch(/render_chart refused/);
    expect(out).toContain('[stack-total]');
    expect(events).toHaveLength(0);
  });

  it('render_chart draws a chart an analyst would question, and hands the model the review to judge (2026-10-24)', async () => {
    const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't-chart-review', createdBy: 'u' });
    const events: AgentEvent[] = [];
    const t = renderChartTool(ctxFor(c.id, events));
    const out = String(await t.invoke({ title: '2026 Revenue', type: 'bar', x: ['Jul', 'Aug', 'Sep', 'EOY: booked'], series: [{ name: 'Revenue', values: [1, 2, 3, 4] }], aggregation: 'cumulative', format: 'currency' }));

    expect(out).toMatch(/Rendered chart/);
    expect(out).toContain('Review at a phone\'s width (390px');
    expect(out).toContain('[mixed-axis]');
    expect(out).toContain('revise it once with update_artifact');
    expect(events.some(e => e.type === 'artifact')).toBe(true);
  });

  it('render_chart draws a stacked-by-month chart with its forecast marked', async () => {
    const c = await createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 't-chart', createdBy: 'u' });
    const events: AgentEvent[] = [];
    const t = renderChartTool(ctxFor(c.id, events));
    const out = String(await t.invoke({
      title: 'On pace for $1.6M, the last month carried by pipeline',
      type: 'bar',
      x: ['Sep', 'Oct', 'Nov', 'Dec'],
      series: [{ name: 'Invoiced', values: [400, 410, 300, 120] }, { name: 'Weighted pipeline', values: [null, null, 100, 280], forecast: true }],
      stack: 'stack',
      aggregation: 'period',
      forecastFrom: 'Nov',
      format: 'currency',
      asOf: '2026-10-23',
    }));

    expect(out).toMatch(/Rendered chart/);

    const ev = events.find(e => e.type === 'artifact');

    expect(ev && ev.type === 'artifact' ? ev.artifact.spec : null).toMatchObject({ stack: 'stack', forecastFrom: 'Nov' });
  });

  it('no render_* tool takes a tile placement any more — there is no grid to place on', () => {
    const schemas = [renderTableTool, renderMarkdownTool, renderChartTool].map(f => Object.keys((f(ctxFor(1, [])) as unknown as { schema: { shape: Record<string, unknown> } }).schema.shape));

    for (const keys of schemas) {
      expect(keys).not.toContain('tile_slot');
      expect(keys).not.toContain('tile_span');
      expect(keys).toContain('folder');
    }
  });
});
