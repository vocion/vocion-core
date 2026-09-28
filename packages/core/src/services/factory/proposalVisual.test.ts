import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rules about WHEN the platform draws, and what it refuses to draw over.
 * The drawing itself is argued with in `libs/factory/proposalVisual.test.ts`.
 */

const saveArtifact = vi.fn();
const upsertRecordArtifact = vi.fn();
const listBusinessObjects = vi.fn();
const update = vi.fn();
const select = vi.fn();

vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: (...a: unknown[]) => saveArtifact(...a) }));
vi.mock('@/services/ArtifactService', () => ({ upsertRecordArtifact: (...a: unknown[]) => upsertRecordArtifact(...a) }));
vi.mock('@/services/BusinessObjectService', () => ({ listBusinessObjects: (...a: unknown[]) => listBusinessObjects(...a) }));
vi.mock('@/libs/DB', () => ({ db: { update: (...a: unknown[]) => update(...a), select: (...a: unknown[]) => select(...a) } }));
vi.mock('@/models/Schema', () => ({ businessObjectSchema: { orgId: 'orgId', id: 'id', metadata: 'metadata' } }));

const { ensureProposalVisual, redrawNeeded, visualInputFor } = await import('./proposalVisual');

/**
 * The row `linkVisual` re-reads before it writes.
 * @param metadata
 */
function rowIs(metadata: Record<string, unknown>) {
  select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ metadata }] }) }) });
}

const written: Array<Record<string, unknown>> = [];

beforeEach(() => {
  written.length = 0;
  saveArtifact.mockReset().mockResolvedValue({ filename: 'o-a.svg', contentType: 'image/svg+xml', bytes: 900, url: '/api/artifacts/o-a/o-a.svg' });
  upsertRecordArtifact.mockReset().mockResolvedValue({ artifact: { id: 77 } });
  listBusinessObjects.mockReset().mockResolvedValue([]);
  select.mockReset();
  rowIs({});
  update.mockReset().mockImplementation(() => ({
    set: (v: { metadata: Record<string, unknown> }) => {
      written.push(v.metadata);
      return { where: async () => undefined };
    },
  }));
});

describe('when the platform redraws', () => {
  it('redraws when the write could have changed what the picture says', () => {
    expect(redrawNeeded(['surface'])).toBe(true);
    expect(redrawNeeded(['acceptance'])).toBe(true);
    expect(redrawNeeded(['state'])).toBe(true);
    expect(redrawNeeded(['visuals'])).toBe(true);
  });

  it('leaves an ordinary write alone, so a priority does not cost a read of every plan', () => {
    expect(redrawNeeded(['priority'])).toBe(false);
    expect(redrawNeeded(['estimateCents', 'tags'])).toBe(false);
  });
});

describe('what the drawing is allowed to read', () => {
  it('takes the components off the NEWEST plan filed against this request', async () => {
    listBusinessObjects.mockResolvedValue([
      { id: 1, createdAt: new Date('2026-09-01'), metadata: { requestId: 5, components: ['old: x'] } },
      { id: 2, createdAt: new Date('2026-09-20'), metadata: { requestId: 5, components: ['new: y'], interfaces: ['GET /x'] } },
      { id: 3, createdAt: new Date('2026-09-21'), metadata: { requestId: 6, components: ['somebody else: z'] } },
    ]);
    const input = await visualInputFor('org', 5, { surface: 'infra', acceptance: [{}, {}] });

    expect(input.components).toEqual(['new: y']);
    expect(input.interfaceCount).toBe(1);
    expect(input.acceptanceCount).toBe(2);
  });

  it('falls back to the request alone in a workspace with no plan type at all', async () => {
    listBusinessObjects.mockRejectedValue(new Error('no such object type'));
    const input = await visualInputFor('org', 5, { surface: 'ui' });

    expect(input.components).toEqual([]);
    expect(input.surface).toBe('ui');
  });
});

describe('what it refuses to draw over', () => {
  it('draws nothing when the record says why it carries no visual', async () => {
    const out = await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { visuals: { noVisualReason: 'a copy change' } } });

    expect(out.status).toBe('skipped');
    expect(saveArtifact).not.toHaveBeenCalled();
  });

  it('files the drawing and names it on a record that has no picture', async () => {
    const out = await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { surface: 'ui' } });

    expect(out).toMatchObject({ status: 'drawn', artifactId: 77, linked: true });
    expect(written).toEqual([{ visuals: { drawnArtifactId: 77 } }]);
  });

  it('keeps its drawing on its own key beside a real mockup, and never on the mockup\'s', async () => {
    // The drawing is not the mockup (review, 2026-09-24): it lands on
    // `drawnArtifactId`, so `beforeArtifactIds` still says whether Design
    // filed anything and the board's `no mock` stays honest.
    rowIs({ visuals: { beforeArtifactIds: [42] } });
    const out = await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { surface: 'ui', visuals: { beforeArtifactIds: [42] } } });

    expect(upsertRecordArtifact).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: 'drawn', linked: true });
    expect(written).toEqual([{ visuals: { beforeArtifactIds: [42], drawnArtifactId: 77 } }]);
  });

  it('writes nothing twice when its own drawing is already named', async () => {
    const out = await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { surface: 'ui', visuals: { drawnArtifactId: 77 } } });

    expect(out).toMatchObject({ linked: true });
    expect(written).toEqual([]);
  });

  it('leaves every other field on the record alone', async () => {
    rowIs({ priority: 3, visuals: { surfaceUrl: '/work' } });
    await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { surface: 'ui' } });

    expect(written).toEqual([{ priority: 3, visuals: { surfaceUrl: '/work', drawnArtifactId: 77 } }]);
  });

  it('files the drawing against the request, at the one role it owns', async () => {
    await ensureProposalVisual({ orgId: 'org', requestId: 5, meta: { surface: 'ui' } });

    expect(upsertRecordArtifact.mock.calls[0]![0]).toMatchObject({
      kind: 'file',
      record: { type: 'object', id: '5', role: 'proposal-visual' },
      visibility: 'system',
    });
  });
});
