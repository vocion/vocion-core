import type { AgentEvent, RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND } from '@/libs/factory/architectureDiagram.fixture';

/**
 * draw_architecture at the seam: which record it will file on, who may call
 * it, what it refuses before anything is drawn, and what it tells the model
 * afterwards. Filing itself is `services/factory/architectureDiagram.test.ts`.
 */

const getBusinessObject = vi.fn();
const factoryTypes = vi.fn();
const fileArchitecture = vi.fn();

vi.mock('@/services/BusinessObjectService', () => ({ getBusinessObject: (...a: unknown[]) => getBusinessObject(...a) }));
vi.mock('@/libs/factory/types', () => ({ factoryTypes: (...a: unknown[]) => factoryTypes(...a) }));
vi.mock('@/services/factory/architectureDiagram', () => ({ fileArchitecture: (...a: unknown[]) => fileArchitecture(...a) }));
vi.mock('@/services/ArtifactService', () => ({ toPayload: (row: { id: number }) => ({ id: row.id, kind: 'file' }) }));

const { DRAW_ARCHITECTURE_TOOL, drawArchitectureTools } = await import('./drawArchitecture');

/** The plugin under test calls its product type something of its own. */
const TYPES = { request: 'ask', task: 'job', plan: 'approach', environment: 'env', release: 'ship', product: 'offering', repo: 'code' };

function ctxFor(over: Partial<RuntimeContext> = {}): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: 'org',
    userId: 'usr-northwind',
    agentSlug: 'release',
    connectorSources: [],
    objectTypeSlugs: ['offering'],
    searchConfig: {},
    // Granted, as the plugin grants its Release seat.
    harnessConfig: { grantTools: ['draw_architecture'] },
    citationSeq: { current: 0 },
    emit: (e: AgentEvent) => events.push(e),
    events,
    ...over,
  } as unknown as RuntimeContext & { events: AgentEvent[] };
}

const MAPPED = [{ repo: 'northwind/send-api', ref: 'main' }];

async function call(ctx: RuntimeContext, args: Record<string, unknown>) {
  const [t] = drawArchitectureTools(ctx);
  return String(await t!.invoke({ productId: 2, graph: SEND, summary: 'Send lets a person upload a file and know when it was opened.', mappedFrom: MAPPED, ...args }));
}

beforeEach(() => {
  getBusinessObject.mockReset().mockResolvedValue({ id: 2, title: 'Send', metadata: {}, type: { slug: 'offering', label: 'Offering' } });
  factoryTypes.mockReset().mockResolvedValue(TYPES);
  fileArchitecture.mockReset().mockResolvedValue({
    ok: true,
    diagramArtifactId: 71,
    summaryArtifactId: 72,
    artifacts: [{ id: 71 }, { id: 72 }],
    write: { status: 'done', runId: 500, version: { from: 3, to: 4 } },
    product: { id: 2, title: 'Send', typeSlug: 'offering', typeLabel: 'Offering' },
    warnings: [],
  });
});

describe('who gets the tool', () => {
  it('is named draw_architecture', () => {
    expect(DRAW_ARCHITECTURE_TOOL).toBe('draw_architecture');
    expect(drawArchitectureTools(ctxFor()).map(t => t.name)).toEqual(['draw_architecture']);
  });

  it('is granted-only: an agent that merely works with records does not carry it', () => {
    expect(drawArchitectureTools(ctxFor({ harnessConfig: {} }))).toEqual([]);
    expect(drawArchitectureTools(ctxFor({ objectTypeSlugs: [], harnessConfig: { grantTools: ['draw_architecture'] } }))).toHaveLength(1);
  });
});

describe('what it refuses before drawing', () => {
  it('files only on the plugin\'s product type, read from the manifest and never written here', async () => {
    getBusinessObject.mockResolvedValue({ id: 2, title: 'A thing', metadata: {}, type: { slug: 'ask', label: 'Ask' } });
    const out = await call(ctxFor(), {});

    expect(out).toMatch(/Refused: ask #2 "A thing" is not a product \(its type is "ask"; products are "offering"\)/);
    expect(fileArchitecture).not.toHaveBeenCalled();
  });

  it('says when there is no such record', async () => {
    getBusinessObject.mockResolvedValue(null);

    expect(await call(ctxFor(), { productId: '44' })).toBe('Refused: no record #44 in this workspace.');
  });

  it('refuses a record the agent may not write, the way every record write does', async () => {
    const out = await call(ctxFor({ objectTypeSlugs: ['ask'], harnessConfig: { grantTools: ['draw_architecture'] } }), {});

    expect(out).toMatch(/^Refused: offering #2 is not on the person's page/);
    expect(fileArchitecture).not.toHaveBeenCalled();
  });

  it('lets the page\'s own record through whatever the agent\'s types', async () => {
    const ctx = ctxFor({ objectTypeSlugs: ['ask'], pageContext: { record: { type: 'object', id: '2', objectType: 'offering' } } as never });
    await call(ctx, {});

    expect(fileArchitecture).toHaveBeenCalledTimes(1);
  });

  it('rejects a graph that does not validate, in words the model can act on, and asks for data not prose', async () => {
    const out = await call(ctxFor(), { graph: { ...SEND, edges: [{ from: 'web', to: 'ghost' }] } });

    expect(out).toMatch(/Refused: the graph did not validate — edges\.0\.to: edge to "ghost" names no node/);
    expect(out).toMatch(/do not describe the architecture in prose instead/);
    expect(fileArchitecture).not.toHaveBeenCalled();
  });

  it('reads a graph the model sent as JSON text', async () => {
    await call(ctxFor(), { graph: JSON.stringify(SEND) });

    expect(fileArchitecture).toHaveBeenCalledTimes(1);
    expect((fileArchitecture.mock.calls[0]![0] as { graph: { title: string } }).graph.title).toBe('Send');
  });
});

describe('what it files and says', () => {
  it('hands the service the product, the graph, the prose, the repositories and the turn', async () => {
    const ctx = ctxFor();
    await call(ctx, {});

    expect(fileArchitecture.mock.calls[0]![0]).toMatchObject({ orgId: 'org', productId: 2, summary: 'Send lets a person upload a file and know when it was opened.', mappedFrom: MAPPED, actor: ctx });
  });

  it('announces both artifacts on the stream and names them and the page in its reply', async () => {
    const ctx = ctxFor();
    const out = await call(ctx, {});

    expect(ctx.events.map(e => e.type)).toEqual(['artifact', 'artifact']);
    expect(out).toContain('Filed on offering #2 "Send": diagram #71 (10 components, 13 connections), summary #72.');
    expect(out).toContain('/dashboard/objects/2');
    expect(out).toContain('version 4');
    expect(out).toMatch(/do not repeat the component list/);
  });

  it('says PENDING when the write waits on a person, and does not claim the page shows it', async () => {
    fileArchitecture.mockResolvedValue({ ok: true, diagramArtifactId: 71, summaryArtifactId: 72, artifacts: [], write: { status: 'pending', runId: 501 }, product: { id: 2, title: 'Send', typeSlug: 'offering', typeLabel: 'Offering' }, warnings: [] });
    const out = await call(ctxFor(), {});

    expect(out).toMatch(/PENDING a person's decision \(run #501\); do NOT say the page shows them yet/);
  });

  it('relays a refused record write with its reason, so the field can be declared', async () => {
    fileArchitecture.mockResolvedValue({ ok: true, diagramArtifactId: 71, summaryArtifactId: 72, artifacts: [], write: { status: 'failed', reason: 'Object type "offering" declares no field "architecture".' }, product: { id: 2, title: 'Send', typeSlug: 'offering', typeLabel: 'Offering' }, warnings: ['both artifacts are filed on offering #2, but the record\'s "architecture" field was not written: Object type "offering" declares no field "architecture".'] });
    const out = await call(ctxFor(), {});

    expect(out).toContain('But the product record was not updated: Object type "offering" declares no field "architecture".');
  });

  it('relays a step that failed, naming the step', async () => {
    fileArchitecture.mockResolvedValue({ ok: false, step: 'diagram', reason: 'the diagram could not be filed: disk full', warnings: [] });

    expect(await call(ctxFor(), {})).toBe('Refused: nothing was filed (diagram): the diagram could not be filed: disk full');
  });
});
