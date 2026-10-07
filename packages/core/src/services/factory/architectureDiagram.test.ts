import type { Buffer } from 'node:buffer';
import type { RuntimeContext } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND } from '@/libs/factory/architectureDiagram.fixture';

/**
 * The rules about WHAT gets filed where when an agent hands over a product's
 * architecture, and how each failure is reported. The drawing itself is
 * argued with in `libs/factory/architectureDiagram.test.ts`.
 */

const saveArtifact = vi.fn();
const upsertRecordArtifact = vi.fn();
const getBusinessObject = vi.fn();
const writeRecordAsAgent = vi.fn();

vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: (...a: unknown[]) => saveArtifact(...a) }));
vi.mock('@/services/ArtifactService', () => ({ upsertRecordArtifact: (...a: unknown[]) => upsertRecordArtifact(...a) }));
vi.mock('@/services/BusinessObjectService', () => ({ getBusinessObject: (...a: unknown[]) => getBusinessObject(...a) }));
vi.mock('@/services/agents/tools/recordWrite', () => ({ writeRecordAsAgent: (...a: unknown[]) => writeRecordAsAgent(...a) }));

const { ARCHITECTURE_DIAGRAM_ROLE, ARCHITECTURE_SUMMARY_ROLE, fileArchitecture, mappedFromMarkdown, recordSummary } = await import('./architectureDiagram');

const NOW = new Date('2026-10-07T10:00:00Z');
const ctx = { missionRunId: 9, orgId: 'org', agentSlug: 'release', conversationId: 9, emit: () => {} } as unknown as RuntimeContext;
const MAPPED = [{ repo: 'northwind/send-web', ref: 'main', sha: 'abcdef1234567890' }, { repo: 'northwind/send-api', ref: 'main' }];

function file(over: Partial<Parameters<typeof fileArchitecture>[0]> = {}) {
  return fileArchitecture({ orgId: 'org', productId: 2, graph: SEND, summary: 'Send lets a person upload a file and know when it was opened.', mappedFrom: MAPPED, actor: ctx, now: NOW, ...over });
}

beforeEach(() => {
  saveArtifact.mockReset().mockResolvedValue({ filename: 'org-a.svg', contentType: 'image/svg+xml', bytes: 9000, url: '/api/artifacts/org-a/org-a.svg' });
  let nextId = 70;
  upsertRecordArtifact.mockReset().mockImplementation(async (input: { record: { role: string }; title: string }) => ({ artifact: { id: ++nextId, title: input.title, recordRole: input.record.role }, unchanged: false }));
  getBusinessObject.mockReset().mockResolvedValue({ id: 2, title: 'Send', metadata: {}, type: { slug: 'thing', label: 'Thing' } });
  writeRecordAsAgent.mockReset().mockResolvedValue({ status: 'done', runId: 500, version: { artifactId: 5, from: 3, to: 4 } });
});

describe('what is filed', () => {
  it('files the picture and the words on the product, one role each, as system output', async () => {
    const out = await file();

    expect(out.ok).toBe(true);
    expect(upsertRecordArtifact).toHaveBeenCalledTimes(2);

    const [diagram, summary] = upsertRecordArtifact.mock.calls.map(c => c[0] as Record<string, unknown>);

    expect(diagram).toMatchObject({ kind: 'file', title: 'Send — architecture', record: { type: 'object', id: '2', role: ARCHITECTURE_DIAGRAM_ROLE }, visibility: 'system', author: { kind: 'agent', id: 'agent:release' } });

    // Asked for in chat (no mission run), the person finds it in the artifact log.
    upsertRecordArtifact.mockClear();
    await file({ actor: { ...ctx, missionRunId: undefined } as typeof ctx });

    expect(upsertRecordArtifact.mock.calls[0]![0]).toMatchObject({ visibility: 'user' });
    expect((diagram!.spec as Record<string, unknown>).contentType).toBe('image/svg+xml');
    expect(summary).toMatchObject({ kind: 'markdown', record: { type: 'object', id: '2', role: ARCHITECTURE_SUMMARY_ROLE }, visibility: 'system' });

    const md = (summary!.spec as { md: string }).md;

    expect(md).toContain('| Send API | api | `northwind/send-api` |');
    expect(md).toContain('## Mapped from');
    expect(md).toContain('- `northwind/send-web` at `main` (abcdef123456) — read 2026-10-07');
  });

  it('draws the SVG into the store before filing it', async () => {
    await file();

    const saved = saveArtifact.mock.calls[0]![0] as { ext: string; contentType: string; data: Buffer };

    expect(saved.ext).toBe('svg');
    expect(saved.contentType).toBe('image/svg+xml');
    expect(saved.data.toString('utf8')).toContain('<svg');
  });

  it('writes the pointers onto the product through the agent write path, with who and why', async () => {
    const out = await file();

    expect(writeRecordAsAgent).toHaveBeenCalledTimes(1);

    const [actor, write] = writeRecordAsAgent.mock.calls[0]!;

    expect(actor).toBe(ctx);
    expect(write).toMatchObject({
      objectType: 'thing',
      id: 2,
      set: { architecture: { diagramArtifactId: 71, summaryArtifactId: 72, mappedAt: NOW.toISOString(), mappedFrom: MAPPED } },
      confidence: 0.9,
      label: 'thing #2',
    });
    expect((write as { set: { architecture: { summary: string } } }).set.architecture.summary).toBe('Send lets a person upload a file and know when it was opened.');
    expect(out).toMatchObject({ ok: true, diagramArtifactId: 71, summaryArtifactId: 72, write: { status: 'done', runId: 500, version: { from: 3, to: 4 } }, warnings: [] });
  });

  it('reports a write that is waiting on a person as pending, not done', async () => {
    writeRecordAsAgent.mockResolvedValue({ status: 'pending', runId: 501 });
    const out = await file();

    expect(out.ok && out.write).toEqual({ status: 'pending', runId: 501 });
  });
});

describe('how failure is reported', () => {
  it('refuses a graph that does not validate, naming the problem', async () => {
    const out = await file({ graph: { ...SEND, edges: [{ from: 'web', to: 'ghost' }] } });

    expect(out).toMatchObject({ ok: false, step: 'graph' });
    expect(!out.ok && out.reason).toMatch(/edges\.0\.to: edge to "ghost" names no node/);
    expect(saveArtifact).not.toHaveBeenCalled();
  });

  it('says when there is no such record', async () => {
    getBusinessObject.mockResolvedValue(null);
    const out = await file();

    expect(out).toMatchObject({ ok: false, step: 'product', reason: 'no record #2 in this workspace' });
  });

  it('turns a store failure into a reason rather than a throw', async () => {
    saveArtifact.mockRejectedValue(new Error('disk full'));
    const out = await file();

    expect(out).toMatchObject({ ok: false, step: 'diagram' });
    expect(!out.ok && out.reason).toContain('disk full');
  });

  it('keeps the artifacts and warns when the type refuses the field', async () => {
    writeRecordAsAgent.mockRejectedValue(new Error('Object type "thing" declares no field "architecture".'));
    const out = await file();

    expect(out.ok).toBe(true);
    expect(out.ok && out.write.status).toBe('failed');
    expect(out.warnings[0]).toMatch(/"architecture" field was not written: Object type "thing" declares no field/);
  });

  it('says when nothing changed, so a remap that drew the same picture is not a surprise', async () => {
    upsertRecordArtifact.mockImplementation(async (input: { record: { role: string } }) => ({ artifact: { id: input.record.role === ARCHITECTURE_DIAGRAM_ROLE ? 71 : 72 }, unchanged: input.record.role === ARCHITECTURE_DIAGRAM_ROLE }));
    const out = await file();

    expect(out.warnings).toEqual(['the diagram is the same as the one already filed, so no new version was written']);
  });
});

describe('the record\'s own summary', () => {
  it('is one paragraph, cut at a word with an ellipsis past 600 characters', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const cut = recordSummary(long);

    expect(cut.length).toBeLessThanOrEqual(600);
    expect(cut.endsWith('…')).toBe(true);
    // Cut at a word boundary: the last word before the ellipsis is whole.
    expect(cut.slice(0, -1).split(' ').at(-1)).toMatch(/^word\d+$/);
    expect(recordSummary('  two\n  lines ')).toBe('two lines');
  });

  it('dates each repository it was read from', () => {
    expect(mappedFromMarkdown([{ repo: 'northwind/send-api', ref: 'v2.1' }], NOW)).toBe('\n## Mapped from\n\n- `northwind/send-api` at `v2.1` — read 2026-10-07\n');
    expect(mappedFromMarkdown([], NOW)).toBe('');
  });
});
