import type { AgentEvent } from './types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const { getArtifact, listArtifactVersions } = await import('@/services/ArtifactService');
const {
  buildStub,
  isLongForm,
  parseComposed,
  renderedAnArtifact,
  runDeliverableBackstop,
  subjectOf,
  titleForWrapped,
} = await import('./deliverableBackstop');

const ORG = 'org_deliverable_backstop';

/** A long-form answer: headings and enough of a body to be a document. */
const LONG_ANSWER = [
  '## Open pipeline',
  '',
  'Three deals are aging past 45 days and two have no next step booked.',
  '',
  '| Deal | Stage | Age |',
  '| --- | --- | --- |',
  '| One | Proposal | 52d |',
].join('\n');

/** The narration case: the turn said what it was about to do, and then stopped. */
const SHORT_ANSWER = 'Let me check the right structure first, then hand this off.';

async function collector() {
  const events: AgentEvent[] = [];
  const conv = await createConversation({ orgId: ORG, agentSlug: 'lead', createdBy: 'usr-a' });
  return { events, emit: (e: AgentEvent) => void events.push(e), conversationId: conv.id };
}

describe('isLongForm', () => {
  it.each([
    ['## A heading\n\nand a line', true],
    ['| a | b |\n| --- | --- |\n| 1 | 2 |', true],
    [`${Array.from({ length: 130 }, (_, i) => `w${i}`).join(' ')}`, true],
    ['Short reply.', false],
    ['', false],
  ])('reads %j as long-form: %s', (text, expected) => {
    expect(isLongForm(text as string)).toBe(expected);
  });
});

describe('titles', () => {
  it('takes a wrapped artifact\'s title from its first heading', () => {
    expect(titleForWrapped('# Pipeline health\n\nbody', 'draft a pipeline report')).toBe('Pipeline health');
  });

  it('falls back to the request with its make-verb stripped', () => {
    expect(titleForWrapped('no headings here', 'draft a pipeline report')).toBe('Pipeline report');
    expect(subjectOf('can you write up the three risks as a memo?')).toBe('Three risks as a memo');
  });
});

describe('renderedAnArtifact', () => {
  it('recognises every tool that creates or changes one', () => {
    expect(renderedAnArtifact([{ tool: 'search_knowledge' }, { tool: 'render_markdown' }])).toBe(true);
    expect(renderedAnArtifact([{ tool: 'update_artifact' }])).toBe(true);
    expect(renderedAnArtifact([{ tool: 'search_knowledge' }, { tool: 'lookup_objects' }])).toBe(false);
  });
});

describe('parseComposed', () => {
  it('reads bare JSON and fenced JSON alike', () => {
    expect(parseComposed('{"title":"A","md":"# A"}')).toEqual({ title: 'A', md: '# A' });
    expect(parseComposed('```json\n{"title":"A","md":"# A"}\n```')).toEqual({ title: 'A', md: '# A' });
  });

  it('refuses anything without a body, so the caller falls back to the stub', () => {
    expect(parseComposed('sorry, I cannot')).toBeNull();
    expect(parseComposed('{"title":"A"}')).toBeNull();
    expect(parseComposed('')).toBeNull();
  });
});

describe('runDeliverableBackstop', () => {
  it('does nothing when the turn owed an answer', async () => {
    const { emit, events, conversationId } = await collector();
    const result = await runDeliverableBackstop({
      orgId: ORG,
      conversationId,
      deliverable: 'answer',
      request: 'what should I do right now?',
      finalText: SHORT_ANSWER,
      toolCalls: [],
      emit,
    });

    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('does nothing when the turn already rendered one', async () => {
    const { emit, events, conversationId } = await collector();
    const result = await runDeliverableBackstop({
      orgId: ORG,
      conversationId,
      deliverable: 'artifact',
      request: 'draft a pipeline report',
      finalText: SHORT_ANSWER,
      toolCalls: [{ tool: 'render_markdown' }],
      emit,
    });

    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('wraps a long-form answer verbatim, with no model in the loop', async () => {
    const { emit, events, conversationId } = await collector();
    const compose = vi.fn();
    const result = await runDeliverableBackstop({
      orgId: ORG,
      agentSlug: 'lead',
      conversationId,
      deliverable: 'artifact',
      request: 'draft a pipeline report',
      finalText: LONG_ANSWER,
      toolCalls: [{ tool: 'search_knowledge' }],
      emit,
      compose,
    });

    expect(compose).not.toHaveBeenCalled();
    expect(result?.branch).toBe('wrapped');
    expect(result?.title).toBe('Open pipeline');

    const row = await getArtifact({ orgId: ORG, id: result!.artifactId });

    expect(row?.kind).toBe('markdown');
    // Verbatim: the pane must show exactly what the agent wrote.
    expect((row?.spec as { md: string }).md).toBe(LONG_ANSWER);
    // `system`, because the harness made it — not the agent's own judgement.
    expect(row?.lastAuthorKind).toBe('system');

    const [v1] = await listArtifactVersions({ orgId: ORG, artifactId: result!.artifactId });

    expect(v1?.changeSummary).toMatch(/because an artifact was requested and none was rendered/);

    // The pane opens on it, and the answer says why it exists.
    expect(events.filter(e => e.type === 'artifact')).toHaveLength(1);
    expect(result?.notice).toContain('Open pipeline');
  });

  it('runs the gated pass for a short answer and files what it composes', async () => {
    const { emit, conversationId } = await collector();
    const compose = vi.fn().mockResolvedValue({ title: 'Pipeline report', md: '# Pipeline report\n\nThree deals are aging.' });
    const result = await runDeliverableBackstop({
      orgId: ORG,
      agentSlug: 'lead',
      conversationId,
      deliverable: 'artifact',
      request: 'draft a pipeline report',
      finalText: SHORT_ANSWER,
      toolCalls: [{ tool: 'lookup_objects', output: '[]' }],
      emit,
      compose,
    });

    expect(compose).toHaveBeenCalledOnce();
    expect(result?.branch).toBe('composed');

    const row = await getArtifact({ orgId: ORG, id: result!.artifactId });

    expect((row?.spec as { md: string }).md).toContain('Three deals are aging');
  });

  it('files an explicit stub when the gated pass cannot produce a document', async () => {
    const { emit, events, conversationId } = await collector();
    const result = await runDeliverableBackstop({
      orgId: ORG,
      agentSlug: 'lead',
      conversationId,
      deliverable: 'artifact',
      request: 'draft a pipeline report',
      finalText: SHORT_ANSWER,
      toolCalls: [{ tool: 'task' }],
      failures: [{ tool: 'task', message: 'the specialist did not respond' }],
      emit,
      compose: vi.fn().mockResolvedValue(null),
    });

    expect(result?.branch).toBe('stub');
    expect(result?.title).toBe('Pipeline report — not completed');

    const row = await getArtifact({ orgId: ORG, id: result!.artifactId });
    const md = (row?.spec as { md: string }).md;

    expect(md).toContain('## What failed');
    expect(md).toContain('the specialist did not respond');
    expect(md).toContain('## What is needed');
    // A stub is still an artifact: the pane opens, and the answer says so.
    expect(events.filter(e => e.type === 'artifact')).toHaveLength(1);
    expect(result?.notice).toMatch(/could not produce one/);
  });

  it('falls back to the stub when the gated pass throws', async () => {
    const { emit, conversationId } = await collector();
    const result = await runDeliverableBackstop({
      orgId: ORG,
      conversationId,
      deliverable: 'artifact',
      request: 'draft a pipeline report',
      finalText: SHORT_ANSWER,
      toolCalls: [],
      emit,
      compose: vi.fn().mockRejectedValue(new Error('model unavailable')),
    });

    expect(result?.branch).toBe('stub');
  });
});

describe('buildStub', () => {
  it('names what failed and what is needed, without inventing a document', () => {
    const { title, md } = buildStub('draft a pipeline report', [{ tool: 'task', message: 'hand-off timed out' }]);

    expect(title).toBe('Pipeline report — not completed');
    expect(md).toContain('hand-off timed out');
    expect(md).not.toMatch(/\$\d/);
  });
});
