import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AgentMessage } from './AgentMessage';
// The phone-width test below is about CSS — the real stylesheet, not the component tree.
import '@/styles/global.css';

describe('AgentMessage inline citations', () => {
  it('renders [n] markers in the prose as tappable citations wired to the handler', async () => {
    const onCitationClick = vi.fn();
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        onCitationClick={onCitationClick}
        message={{
          role: 'assistant',
          content: 'The angle rests on the compliance blog cadence [1] and the unfilled roles [2].',
          runs: [{ type: 'text', text: 'The angle rests on the compliance blog cadence [1] and the unfilled roles [2].' }],
          documents: [
            { document_id: 'd1', semantic_identifier: 'compliance-watch', link: 'https://example.com/1', source_type: 'web', blurb: '', citationIndex: 1 },
            { document_id: 'd2', semantic_identifier: 'jobs page', link: 'https://example.com/2', source_type: 'web', blurb: '', citationIndex: 2 },
          ],
        }}
      />,
    );

    await expect.element(page.getByText(/The angle rests on/)).toBeInTheDocument();

    const cite = page.getByRole('button', { name: 'Open source 1' });

    await expect.element(cite).toBeInTheDocument();

    await userEvent.click(cite);

    expect(onCitationClick).toHaveBeenCalledWith(1);
  });
});

describe('AgentMessage attribution (§9.10)', () => {
  it('renders a routed reply under the workspace with a "via <specialist>" eyebrow', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        via="via Proposal Writer"
        message={{ role: 'assistant', content: 'Here is the brief.', runs: [{ type: 'text', text: 'Here is the brief.' }] }}
      />,
    );

    await expect.element(page.getByText('Revenue')).toBeInTheDocument();
    await expect.element(page.getByTestId('via-eyebrow')).toHaveTextContent('via Proposal Writer');
  });

  it('shows no eyebrow when the workspace agent answered itself', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: 'Pipeline is up 12%.', runs: [{ type: 'text', text: 'Pipeline is up 12%.' }] }}
      />,
    );

    await expect.element(page.getByText('Pipeline is up 12%.')).toBeInTheDocument();
    expect(page.getByTestId('via-eyebrow').query()).toBeNull();
  });
});

describe('a tool error is inspectable (2026-09-16)', () => {
  const TRACE = [
    {
      id: 'n1',
      actor: { id: 'lead', kind: 'lead' as const, name: 'Revenue' },
      kind: 'delegate' as const,
      status: 'error' as const,
      label: 'Proposal Writer',
      tool: 'task',
      resultDetail: 'agent __search__ not found in org proj-2df61364-8d21-4f0b',
    },
  ];

  it('renders the badge as a button that opens the trace at the failed step, redacted', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        conversationId={41}
        timestamp={Date.parse('2026-09-16T10:04:00.000Z')}
        message={{
          id: 913,
          role: 'assistant',
          content: 'I could not complete that.',
          runs: [{ type: 'text', text: 'I could not complete that.' }],
          trace: TRACE,
        }}
      />,
    );

    const badge = page.getByTestId('tool-error-badge');

    await expect.element(badge).toBeInTheDocument();
    // Inert until asked: the failed step is behind the collapsed trace.
    expect(page.getByTestId('failed-step').elements()).toHaveLength(0);

    await userEvent.click(badge);

    const step = page.getByTestId('failed-step');

    await expect.element(step).toBeVisible();
    // The message a person reads carries neither the tenant id nor the slug.
    await expect.element(page.getByText(/not found in org \[id\]/)).toBeVisible();
    expect((await step.element()).textContent).not.toContain('proj-2df61364');
    expect((await step.element()).textContent).not.toContain('__search__');
  });

  it('copies a block carrying all six fields, ids included', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    await render(
      <AgentMessage
        agentName="Revenue"
        conversationId={41}
        timestamp={Date.parse('2026-09-16T10:04:00.000Z')}
        message={{ id: 913, role: 'assistant', content: 'x', runs: [{ type: 'text', text: 'x' }], trace: TRACE }}
      />,
    );

    await userEvent.click(page.getByTestId('tool-error-badge'));
    await userEvent.click(page.getByTestId('copy-failure'));

    await vi.waitFor(() => expect(written).toHaveLength(1));

    const block = written[0]!;

    expect(block).toContain('turn:         913');
    expect(block).toContain('conversation: 41');
    expect(block).toContain('when:         2026-09-16T10:04:00.000Z');
    expect(block).toContain('tool:         task');
    expect(block).toContain('delegate:     none');
    expect(block).toContain('proj-2df61364');
  });
});

describe('the live indicator while streaming', () => {
  const streamed = {
    role: 'assistant' as const,
    content: 'Here is where things stand.',
    runs: [{ type: 'text' as const, text: 'Here is where things stand.' }],
  };

  it('shows what is happening at the BOTTOM once prose has started', async () => {
    // The work timeline opens the message and is the record of the turn. But
    // once text is arriving you are reading the bottom, and a pause there —
    // a tool call mid-stream, a slow token — looked exactly like a finished
    // answer, because the only thing still moving had scrolled off the top.
    await render(<AgentMessage agentName="RevOps Lead" message={streamed} streaming activity="Searching the CRM" />);

    // Scoped to the indicator on purpose: the activity also names the timeline
    // header above, and the point of this test is that it now reads at the
    // bottom too.
    await expect.element(page.getByTestId('streaming-indicator')).toBeVisible();
    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Searching the CRM');
  });

  it('falls back to a plain label when there is no activity to name', async () => {
    await render(<AgentMessage agentName="RevOps Lead" message={streamed} streaming />);

    await expect.element(page.getByTestId('streaming-indicator')).toBeVisible();
  });

  it('is present during the tool phase too, before any text has arrived', async () => {
    // The first version gated this on text having started, which left the
    // bottom of the transcript silent for the whole tool phase — the exact
    // case that reads as a finished answer while five calls are still running.
    // OpenClaw and Claude Code both keep the indicator present for the whole
    // turn, and that is why they read better.
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{ role: 'assistant', content: '', runs: [] }}
        streaming
        activity="Reading the briefing"
      />,
    );

    await expect.element(page.getByTestId('streaming-indicator')).toBeVisible();
    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Reading the briefing');
  });

  it('disappears when the turn lands', async () => {
    await render(<AgentMessage agentName="RevOps Lead" message={streamed} />);

    expect(page.getByTestId('streaming-indicator').elements()).toHaveLength(0);
  });
});

describe('a tool failure says what failed', () => {
  // The badge was a way IN to the trace, which is right — but it opened the
  // trace at the failed step, and a failure arriving as a typed trace node has
  // no row among the tool runs to open to. So a turn whose visible steps all
  // succeeded showed a red "Tool error" that led nowhere.
  it('names the tool and shows its message on click', async () => {
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{
          role: 'assistant',
          content: 'Done.',
          runs: [
            { type: 'tool', name: 'render_markdown', state: 'error', output: 'ArtifactError: spec.md must be a string' },
            { type: 'text', text: 'Done.' },
          ],
        }}
      />,
    );

    await expect.element(page.getByTestId('tool-error-badge')).toHaveTextContent('render_markdown failed');

    await userEvent.click(page.getByTestId('tool-error-badge'));

    await expect.element(page.getByTestId('tool-error-detail')).toHaveTextContent('spec.md must be a string');
  });

  it('finds a failure that arrived as a typed trace node, not a run', async () => {
    // The exact case that produced a badge with nothing behind it.
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{
          role: 'assistant',
          content: 'Done.',
          runs: [{ type: 'text', text: 'Done.' }],
          trace: [{ id: 'n1', actor: { id: 'revops', kind: 'lead', name: 'RevOps Lead' }, kind: 'tool', label: 'update_artifact', status: 'error', detail: 'artifact 91 not found' }],
        }}
      />,
    );

    await userEvent.click(page.getByTestId('tool-error-badge'));

    await expect.element(page.getByTestId('tool-error-detail')).toHaveTextContent('artifact 91 not found');
  });

  it('still says something useful when the failure carried no message', async () => {
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{
          role: 'assistant',
          content: 'Done.',
          runs: [{ type: 'tool', name: 'web_search', state: 'error' }, { type: 'text', text: 'Done.' }],
        }}
      />,
    );

    await userEvent.click(page.getByTestId('tool-error-badge'));

    await expect.element(page.getByTestId('tool-error-detail')).toHaveTextContent('returned no message');
  });

  it('shows no badge when nothing failed', async () => {
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{ role: 'assistant', content: 'Done.', runs: [{ type: 'text', text: 'Done.' }] }}
      />,
    );

    expect(page.getByTestId('tool-error-badge').elements()).toHaveLength(0);
  });
});

describe('the work sits where it happened (interleaved, not hoisted)', () => {
  const actor = { id: 'lead', kind: 'lead' as const, name: 'Revenue' };

  it('renders each group of steps between the passages it fell between', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Reading the brief first.\n\nThree deals moved.',
          runs: [
            { type: 'tool', name: 'get_briefing', state: 'done' },
            { type: 'text', text: 'Reading the brief first.' },
            { type: 'tool', name: 'lookup_objects', state: 'done' },
            { type: 'text', text: 'Three deals moved.' },
          ],
          trace: [
            { id: 'a', actor, kind: 'tool', status: 'done', label: 'Read the briefing', anchor: 0 },
            { id: 'b', actor, kind: 'search', status: 'done', label: 'Looked up 3 deals', anchor: 1 },
          ],
        }}
      />,
    );

    await expect.element(page.getByText('Three deals moved.')).toBeInTheDocument();

    // Document order: step a, passage 1, step b, passage 2.
    const order = [
      page.getByRole('button', { name: /Read the briefing/ }),
      page.getByText('Reading the brief first.'),
      page.getByRole('button', { name: /Looked up 3 deals/ }),
      page.getByText('Three deals moved.'),
    ].map(l => l.element());
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('a trace without anchors still renders hoisted, as it was persisted', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Done.',
          runs: [{ type: 'text', text: 'Done.' }],
          trace: [
            { id: 'a', actor, kind: 'tool', status: 'done', label: 'Read the briefing' },
            { id: 'b', actor, kind: 'search', status: 'done', label: 'Looked up 3 deals' },
          ],
        }}
      />,
    );

    const folded = page.getByRole('button', { name: /Looked up 3 deals and read the briefing · 2 steps/ });

    await expect.element(folded).toBeInTheDocument();
    expect(folded.element().compareDocumentPosition(page.getByText('Done.').element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// 2026-09-20: a transcript showed `<scratch> No engineering tasks on record.
// Let me check knowledge / wiki … </scratch>` as body text, twice, between
// tool-call rows, the second one cut mid-sentence. A block in a stored text
// run is the model thinking; it folds to a muted line and never reads as prose.
describe('a <scratch> block in a stored text run folds to "Thinking"', () => {
  it('hides the block behind a disclosure and keeps the prose around it', async () => {
    await render(
      <AgentMessage
        agentName="Northwind Lead"
        message={{
          role: 'assistant',
          content: 'Checking.\n\n<scratch>No engineering tasks on record. Let me check knowledge / wiki.</scratch>\n\nFifteen runs, two still going.',
          runs: [{ type: 'text', text: 'Checking.\n\n<scratch>No engineering tasks on record. Let me check knowledge / wiki.</scratch>\n\nFifteen runs, two still going.' }],
        }}
      />,
    );

    await expect.element(page.getByText('Checking.')).toBeInTheDocument();
    await expect.element(page.getByText('Fifteen runs, two still going.')).toBeInTheDocument();
    // Neither tag reaches the page, and the block's words stay folded.
    expect(document.body.textContent).not.toContain('<scratch>');
    expect(document.body.textContent).not.toContain('</scratch>');
    expect(page.getByTestId('scratch-fold-body').query()).toBeNull();

    const fold = page.getByRole('button', { name: 'Show thinking' });

    await expect.element(fold).toBeInTheDocument();

    await userEvent.click(fold);

    await expect.element(page.getByTestId('scratch-fold-body')).toHaveTextContent('No engineering tasks on record. Let me check knowledge / wiki.');
  });

  it('folds a block the stream cut off before it closed', async () => {
    await render(
      <AgentMessage
        agentName="Northwind Lead"
        message={{
          role: 'assistant',
          content: 'No tasks on record.\n\n<scratch>Let me check knowledge / wiki for what was bui',
          runs: [{ type: 'text', text: 'No tasks on record.\n\n<scratch>Let me check knowledge / wiki for what was bui' }],
        }}
      />,
    );

    await expect.element(page.getByText('No tasks on record.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('<scratch>');
    // Folded: the line carries its first sentence as a preview, the way the
    // trace's reasoning line does; the body itself stays closed.
    await expect.element(page.getByTestId('scratch-fold')).toBeInTheDocument();
    expect(page.getByTestId('scratch-fold-body').query()).toBeNull();
    expect(page.getByText('what was bui').query()?.tagName).not.toBe('P');
  });

  it('renders a plain answer with no fold at all', async () => {
    await render(
      <AgentMessage
        agentName="Northwind Lead"
        message={{ role: 'assistant', content: 'Fifteen runs.', runs: [{ type: 'text', text: 'Fifteen runs.' }] }}
      />,
    );

    await expect.element(page.getByText('Fifteen runs.')).toBeInTheDocument();
    expect(page.getByTestId('scratch-fold').query()).toBeNull();
  });

  it('a turn that failed outright names itself and opens its reason', async () => {
    // What Chris met on a phone: an empty bubble with a red chip reading
    // "error failed" — the node's generic label glued to the word failed —
    // and the reason a tap away with no hover to hint that there was one.
    await render(
      <AgentMessage
        agentName="Send Lead"
        conversationId={77}
        timestamp={Date.parse('2026-09-22T18:07:00.000Z')}
        message={{
          id: 941,
          role: 'assistant',
          content: '',
          runs: [],
          trace: [{
            id: 'n1',
            actor: { id: 'lead', kind: 'lead' as const, name: 'Send Lead' },
            kind: 'delegate' as const,
            status: 'error' as const,
            label: 'Error',
            detail: 'no model credentials configured for this workspace',
          }],
        }}
      />,
    );

    await expect.element(page.getByTestId('tool-error-badge')).toHaveTextContent('This turn failed');
    // Open already: there is nothing else on screen to read.
    await expect.element(page.getByTestId('tool-error-detail')).toHaveTextContent('no model credentials');
  });
});

describe('AgentMessage — a turn that died part-way (#114)', () => {
  it('says the answer is unfinished when the row is marked incomplete', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Four deals closed last month, worth',
          status: 'incomplete',
          statusReason: 'the model connection dropped mid-answer',
          runs: [{ type: 'text', text: 'Four deals closed last month, worth' }],
        }}
      />,
    );

    await expect.element(page.getByTestId('incomplete-turn-notice')).toBeInTheDocument();
    await expect.element(page.getByText(/stopped partway/)).toBeInTheDocument();
    // What went wrong, in the runtime's words, so a person can report it.
    await expect.element(page.getByText(/connection dropped mid-answer/)).toBeInTheDocument();
    // And no tool-error badge: nothing here was a failing tool.
    expect(page.getByTestId('tool-error-badge').elements()).toHaveLength(0);
  });

  it('says nothing on a turn that finished, so a healthy answer carries no warning', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Four deals closed last month.',
          runs: [{ type: 'text', text: 'Four deals closed last month.' }],
        }}
      />,
    );

    await expect.element(page.getByText(/Four deals closed/)).toBeInTheDocument();
    expect(page.getByTestId('incomplete-turn-notice').elements()).toHaveLength(0);
  });

  it('tells a person whose turn never ran that there is no answer above it', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '', status: 'failed', statusReason: 'the model refused the request' }}
      />,
    );

    // "Stopped partway through" would be describing nothing — there is no text.
    await expect.element(page.getByText(/did not run/)).toBeInTheDocument();
    expect(page.getByText(/stopped partway/).elements()).toHaveLength(0);
  });

  it('tells a person whose workspace declined the turn that nothing is broken', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: '',
          status: 'refused',
          statusReason: 'Budget exceeded for "revenue-lead" (monthly: 5100/5000). Raise the cap under Budgets or wait for the next period.',
        }}
      />,
    );

    // A spent budget is not a fault, and "ask again" is useless advice for it.
    await expect.element(page.getByText(/Nothing is broken/)).toBeInTheDocument();
    await expect.element(page.getByText(/Raise the cap under Budgets/)).toBeInTheDocument();
    expect(page.getByText(/Ask again for a complete one/).elements()).toHaveLength(0);
  });

  it('marks a stopped turn quietly, because the person chose where it ended', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: 'Northwind renews in March and', status: 'stopped' }}
      />,
    );

    await expect.element(page.getByTestId('turn-ending-marker')).toBeInTheDocument();
    await expect.element(page.getByText(/You stopped this answer/)).toBeInTheDocument();
    // Not a failure: no alarm-coloured notice over a turn that did what was asked.
    expect(page.getByTestId('incomplete-turn-notice').elements()).toHaveLength(0);
  });

  it('says which message holds the rest, on the half that holds it', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '$1.4M across eleven deals.', status: 'continued' }}
      />,
    );

    // Otherwise the second bubble reads as a new turn that started mid-sentence.
    await expect.element(page.getByText(/the rest of the answer above/)).toBeInTheDocument();
    expect(page.getByTestId('incomplete-turn-notice').elements()).toHaveLength(0);
  });

  it('does not say "not run" under the answer of a turn stopped partway by its budget', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Northwind renews in March and',
          status: 'refused',
          statusReason: 'This turn stopped partway because it reached its budget.',
        }}
      />,
    );

    await expect.element(page.getByText(/This answer stopped before it finished/)).toBeInTheDocument();
    expect(page.getByText(/This turn was not run/).elements()).toHaveLength(0);
  });

  it('labels a refusal\'s reason without calling it a fault', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '', status: 'refused', statusReason: 'Budget exceeded for "revenue-lead".' }}
      />,
    );

    // The sentence above just said nothing is broken; "what went wrong" would
    // take that straight back.
    await expect.element(page.getByText(/Why:/)).toBeInTheDocument();
    expect(page.getByText(/What went wrong/).elements()).toHaveLength(0);
  });

  it('says where the rest of a truncated answer went', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: 'The pipeline stands at', status: 'truncated' }}
      />,
    );

    await expect.element(page.getByText(/cut off at a time limit/)).toBeInTheDocument();
    expect(page.getByTestId('incomplete-turn-notice').elements()).toHaveLength(0);
  });
});

describe('agent prose fits a phone (backlog 023)', () => {
  it('a wide table, an unbroken id and a long URL never widen the column past its box', async () => {
    const wide = `| What | State | Owner | Cost | Risk | Since |\n|---|---|---|---|---|---|\n| Request #121 — Send/share from file detail | Triaged, recommended build, plan exists | Product manager | $18–30 | Email deliverability | 2026-09-22 |\n\nRun id: ${'a1b2c3d4'.repeat(30)}\n\nhttps://example.com/${'segment/'.repeat(40)}`;
    const screen = await render(
      <div style={{ width: 320 }} data-testid="phone-column">
        <AgentMessage agentName="Product manager" message={{ role: 'assistant', content: wide, runs: [{ type: 'text', text: wide }] }} />
      </div>,
    );

    await expect.element(page.getByText(/Run id:/)).toBeInTheDocument();

    const column = screen.container.querySelector('[data-testid="phone-column"]') as HTMLElement;

    // The column itself never grows; a table scrolls INSIDE its own box.
    expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);

    const hanging = Array.from(column.querySelectorAll('*')).filter((el) => {
      const r = el.getBoundingClientRect();
      const c = column.getBoundingClientRect();
      // Cells inside a scrolling table are allowed past the edge; nothing else is.
      return r.right > c.right + 1 && !el.closest('.overflow-x-auto');
    });

    expect(hanging.map(el => el.tagName)).toEqual([]);
  });
});
