/**
 * `artifacts.update` with `ops` — the deliverable pane's door. A person's
 * edit to a deck or a document is the same operation the agent's
 * `edit_deck` / `edit_document` makes, through the same engine call, with
 * the person as author and one version per commit.
 */
import { ORPCError } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
// Versions, not pixels: render-verify is the render tests' job.
vi.mock('@/libs/documents/render', async orig => ({ ...(await orig<object>()), renderAvailable: async () => ({ ok: false, reason: 'not in this test' }) }));

const { guardAuth } = await import('./AuthGuards');
const { createDeck } = await import('@/services/decks/DeckEngine');
const { createDocument } = await import('@/services/documents/DocumentEngine');
const { getArtifact, listArtifactVersions } = await import('@/services/ArtifactService');
const { update } = await import('./Artifacts');

const ORG = 'org_router_artifact_ops';
const AGENT = { kind: 'agent' as const, id: 'agent:proposal-writer' };
const s = (id: string, body: string) => `<section id="${id}" style="padding:120px">${body}<aside>From the Larkfield Systems kickoff.</aside></section>`;

vi.mocked(guardAuth).mockResolvedValue({ orgId: ORG, userId: 'usr-pane' } as unknown as Awaited<ReturnType<typeof guardAuth>>);

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

async function newDeck() {
  const { artifact } = await createDeck({
    orgId: ORG,
    author: AGENT,
    deck: {
      title: 'Larkfield Systems — concept',
      order: ['cover', 'plan'],
      slides: { cover: s('cover', '<h1>One record</h1>'), plan: s('plan', '<h2>The plan</h2><p>Three phases.</p>') },
    },
  });
  return artifact;
}

type UpdateResult = { artifact: { version: number; spec: Record<string, unknown> }; version: { version: number; changeSummary: string | null } };

describe('artifacts.update with ops', () => {
  it('writes a person\'s replace_slide as one version, with their summary', async () => {
    const deck = await newDeck();
    const res = await call<UpdateResult>(update, {
      id: deck.id,
      ops: [{ op: 'replace_slide', id: 'plan', html: s('plan', '<h2>The plan</h2><p>Two phases.</p>') }],
      changeSummary: 'Edited text on slide 2',
      ifVersion: 1,
    });

    expect(res.artifact.version).toBe(2);
    expect((res.artifact.spec.slides as Record<string, string>).plan).toContain('Two phases.');

    const versions = await listArtifactVersions({ orgId: ORG, artifactId: deck.id, limit: 5 });

    expect(versions[0]).toMatchObject({ version: 2, authorKind: 'human', changeSummary: 'Edited text on slide 2' });
  });

  it('applies move, insert, notes and remove the way edit_deck does', async () => {
    const deck = await newDeck();
    await call(update, { id: deck.id, ops: [{ op: 'move_slide', id: 'plan', to: 1 }], changeSummary: 'Moved slide 2 to 1' });
    await call(update, { id: deck.id, ops: [{ op: 'insert_slide', after: 'plan', html: s('plan-2', '<h2>The plan, again</h2>') }], changeSummary: 'Added slide 2' });
    await call(update, { id: deck.id, ops: [{ op: 'set_notes', id: 'cover', notes: 'Say the price last.' }], changeSummary: 'Edited the notes on slide 3' });
    await call(update, { id: deck.id, ops: [{ op: 'remove_slide', id: 'plan-2' }], changeSummary: 'Removed slide 2' });
    const row = await getArtifact({ orgId: ORG, id: deck.id });
    const spec = row!.spec as { order: string[]; slides: Record<string, string> };

    expect(spec.order).toEqual(['plan', 'cover']);
    expect(spec.slides.cover).toContain('<aside>Say the price last.</aside>');
    expect(row!.currentVersion).toBe(5);
  });

  it('refuses a stale edit instead of writing over the agent', async () => {
    const deck = await newDeck();
    await call(update, { id: deck.id, ops: [{ op: 'set_title', title: 'Larkfield Systems — concept v2' }], changeSummary: 'Retitled' });
    const err = await call(update, { id: deck.id, ops: [{ op: 'remove_slide', id: 'plan' }], changeSummary: 'Removed slide 2', ifVersion: 1 }).catch(e => e);

    expect(err).toBeInstanceOf(ORPCError);
    expect((err as Error).message).toContain('conflict');
  });

  it('says why a bad op is refused, in a sentence', async () => {
    const deck = await newDeck();
    const err = await call(update, { id: deck.id, ops: [{ op: 'remove_slide', id: 'nope' }], changeSummary: 'Removed slide 9' }).catch(e => e);

    expect(err).toBeInstanceOf(ORPCError);
    expect((err as Error).message).toMatch(/nope/);
  });

  it('takes a document\'s sheet ops through the document engine', async () => {
    const html = '<!doctype html><html><head><title>Northwind — scope</title></head><body>'
      + '<article class="sheet"><div class="body"><h1>Northwind starts here.</h1></div></article>'
      + '<article class="sheet"><div class="body"><h2>Plan</h2><p>Three phases.</p></div></article>'
      + '</body></html>';
    const { artifact } = await createDocument({ orgId: ORG, author: AGENT, html, title: 'Northwind — scope' });
    const res = await call<UpdateResult>(update, {
      id: artifact.id,
      ops: [{ op: 'replace_sheet', n: 2, html: '<article class="sheet"><div class="body"><h2>Plan</h2><p>Two phases.</p></div></article>' }],
      changeSummary: 'Edited text on sheet 2',
    });

    expect(res.artifact.version).toBe(2);
    expect(res.artifact.spec.html).toContain('Two phases.');
    expect(res.version.changeSummary).toBe('Edited text on sheet 2');
  });

  it('refuses ops on a kind that has none', async () => {
    const deck = await newDeck();
    const err = await call(update, { id: deck.id, ops: [{ op: 'replace_sheet', n: 1, html: '<article class="sheet">x</article>' }] }).catch(e => e);

    expect(err).toBeInstanceOf(ORPCError);
    expect((err as Error).message).toContain('not a deck edit');
  });
});
