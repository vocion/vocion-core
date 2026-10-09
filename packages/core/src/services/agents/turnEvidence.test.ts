/**
 * Turn evidence (`turnEvidence.ts`): a repeated search is answered from the
 * first, a source keeps its number, hits are snippets, and a consult starts
 * from what the turn already has. Regression for trace c126f3ca, where one
 * person's name was searched three times and the consult re-ran the lead's
 * searches from nothing.
 */
import type { RuntimeContext } from './types';
import type { SearchHit } from '@/services/RetrievalService';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/RetrievalService', () => ({ search: vi.fn() }));

const { search } = await import('@/services/RetrievalService');
const { searchKnowledgeTool } = await import('./tools/searchKnowledge');
const { createEvidenceHandoffMiddleware, evidenceBlock, newTurnEvidence, noteSources, searchKey } = await import('./turnEvidence');
const { runtimeContextFromScope } = await import('./runtimeContext');

const hit = (documentId: number, title: string, content: string): SearchHit => ({
  chunkId: documentId * 10,
  documentId,
  sourceId: 1,
  sourceSlug: 'gmail',
  chunkIdx: 0,
  content,
  title,
  uri: null,
  score: 1,
  scores: {},
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  metadata: {},
});

function turn(): RuntimeContext {
  const documents: unknown[] = [];
  const ctx = runtimeContextFromScope('org-evidence', { slug: 'revops-lead', connectorSources: ['gmail'], objectTypeSlugs: [], searchConfig: {}, harnessConfig: {} } as never, { enabledPlugins: [], defaultTimeZone: 'UTC', filingTypes: [], restSources: [], sourceKinds: {} } as never, {
    emit: (e) => {
      if (e.type === 'documents') {
        documents.push(...e.documents);
      }
    },
  });
  return Object.assign(ctx, { documentsSeen: documents });
}

describe('the search key', () => {
  it('is the same for the same search written differently, and different for a different one', () => {
    expect(searchKey('search_knowledge', { query: '  Pricing   for Contoso ', source_types: ['gmail', 'hubspot'] }))
      .toBe(searchKey('search_knowledge', { query: 'pricing for contoso', source_types: ['hubspot', 'gmail'] }));
    expect(searchKey('search_knowledge', { query: 'pricing for contoso' })).not.toBe(searchKey('search_knowledge', { query: 'pricing for acme' }));
    expect(searchKey('search_knowledge', { query: 'pricing', facets: { reply_state: 'needs_my_reply' } })).not.toBe(searchKey('search_knowledge', { query: 'pricing' }));
  });
});

describe('search_knowledge on the turn\'s ledger', () => {
  it('answers a repeat from the first search, keeps a source\'s number, and shows snippets', async () => {
    const long = `Could you send pricing for 40 seats? ${'We decide on Friday after the board meets. '.repeat(20)}`;
    vi.mocked(search).mockResolvedValue([hit(7, 'Pricing for the managed service', long), hit(7, 'Pricing for the managed service', 'second chunk of the same email'), hit(8, 'Re: Agents for your field team', 'Could we talk next week?')]);
    const ctx = turn();
    const tool = searchKnowledgeTool(ctx);

    const first = await tool.invoke({ query: 'Pricing for Contoso' }) as string;

    expect(first).toContain('[1] **Pricing for the managed service**');
    expect(first).toContain('[2] **Re: Agents for your field team**');
    // One hit per document, and a snippet rather than the whole text.
    expect(first).not.toContain('second chunk');
    expect(first).toContain('…');
    expect(first.length).toBeLessThan(900);

    const again = await tool.invoke({ query: 'pricing   for contoso' }) as string;

    expect(again).toContain('Already searched this turn');
    expect(again).toContain('[1][2]');
    expect(vi.mocked(search)).toHaveBeenCalledTimes(1);

    // A different search that finds a source already numbered keeps its number.
    vi.mocked(search).mockResolvedValue([hit(8, 'Re: Agents for your field team', 'Could we talk next week?'), hit(9, 'Invoice question', 'Why did the invoice double?')]);
    const other = await tool.invoke({ query: 'field team' }) as string;

    expect(other).toContain('[2] **Re: Agents for your field team**');
    expect(other).toContain('[3] **Invoice question**');
    expect([...ctx.evidence!.sources.keys()]).toEqual([1, 2, 3]);
  });
});

describe('the consult hand-off', () => {
  it('appends what the turn has to a task description, and leaves other calls alone', async () => {
    const ev = newTurnEvidence();
    noteSources(ev, [{ citationIndex: 1, semantic_identifier: 'Pricing for the managed service', source_type: 'gmail', document_id: '7', updated_at: '2026-10-07T10:00:00Z' }]);
    ev.searches.set('k', { query: 'pricing for contoso', key: 'k', numbers: [1], output: '', hits: 1 });
    const block = evidenceBlock(ev);

    expect(block).toContain('"pricing for contoso" → [1]');
    expect(block).toContain('[1] Pricing for the managed service (gmail, 2026-10-07)');

    const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
    const wrap = createEvidenceHandoffMiddleware(ev).wrapToolCall as unknown as (r: unknown, h: (r: { toolCall: { name: string; args: Record<string, unknown> } }) => unknown) => Promise<unknown>;
    const handler = (r: { toolCall: { name: string; args: Record<string, unknown> } }) => {
      seen.push(r.toolCall);
      return {};
    };
    await wrap({ toolCall: { name: 'task', args: { description: 'Triage the inbox', subagent_type: 'follow-up-coordinator' }, id: 't1' } }, handler);
    await wrap({ toolCall: { name: 'search_knowledge', args: { query: 'x' }, id: 't2' } }, handler);

    expect(String(seen[0]!.args.description)).toContain('Triage the inbox\n\n--- ALREADY GATHERED THIS TURN');
    expect(seen[0]!.args.subagent_type).toBe('follow-up-coordinator');
    expect(seen[1]!.args).toEqual({ query: 'x' });
    expect(evidenceBlock(newTurnEvidence())).toBe('');
  });
});

describe('the lookup memo', () => {
  it('answers a repeated read from the first, only for tools that declare it', async () => {
    const { ToolMessage } = await import('@langchain/core/messages');
    const { createLookupMemoMiddleware } = await import('./turnEvidence');
    const ev = newTurnEvidence();
    let runs = 0;
    const handler = async (r: { toolCall: { id: string; name: string } }) => {
      runs += 1;
      return new ToolMessage({ content: `result ${runs}`, tool_call_id: r.toolCall.id, name: r.toolCall.name });
    };
    const wrap = createLookupMemoMiddleware(ev).wrapToolCall as unknown as (r: unknown, h: typeof handler) => Promise<{ content: string }>;
    const owed = { name: 'mail_owed_replies', metadata: { turnMemo: true } };

    const first = await wrap({ tool: owed, toolCall: { id: 'a', name: 'mail_owed_replies', args: { category: ['sales'] } } }, handler);
    const second = await wrap({ tool: owed, toolCall: { id: 'b', name: 'mail_owed_replies', args: { category: ['sales'] } } }, handler);
    const other = await wrap({ tool: owed, toolCall: { id: 'c', name: 'mail_owed_replies', args: { category: ['customer'] } } }, handler);
    await wrap({ tool: { name: 'propose_action' }, toolCall: { id: 'd', name: 'propose_action', args: {} } }, handler);
    await wrap({ tool: { name: 'propose_action' }, toolCall: { id: 'e', name: 'propose_action', args: {} } }, handler);

    expect(first.content).toBe('result 1');
    expect(second.content).toContain('Already looked up this turn');
    expect(second.content).toContain('result 1');
    expect(other.content).toBe('result 2');
    // A tool that did not declare it always runs.
    expect(runs).toBe(4);
  });
});
