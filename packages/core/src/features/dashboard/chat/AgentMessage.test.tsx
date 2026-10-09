import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AgentMessage } from './AgentMessage';
// The phone-width test below is about CSS — the real stylesheet, not the component tree.
import '@/styles/global.css';

/**
 * Level 1 → 2 → 3: the turn's line, then the failed step on it. The error
 * itself is only ever behind both taps (founder, 2026-10-09).
 */
async function openFailedStep() {
  await userEvent.click(page.getByTestId('work-group').getByRole('button').first());
  await userEvent.click(page.getByTestId('work-steps').getByRole('button', { name: /failed/ }).first());
}

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

    expect(onCitationClick).toHaveBeenCalledWith(1, undefined);
  });
});

describe('AgentMessage Sources chip', () => {
  it('says which turn was pressed, so a surface can open that turn\'s sources (Chris, 2026-09-29)', async () => {
    const onShowSources = vi.fn();
    await render(
      <AgentMessage
        agentName="Revenue"
        onShowSources={onShowSources}
        message={{
          id: 9051,
          role: 'assistant',
          content: 'Ships Friday.',
          runs: [{ type: 'text', text: 'Ships Friday.' }],
          documents: [{ document_id: 'd1', semantic_identifier: 'Kestrel kickoff notes', link: 'https://notes.example/k1', source_type: 'web', blurb: '' }],
        }}
      />,
    );

    await userEvent.click(page.getByTestId('sources-chip'));

    expect(onShowSources).toHaveBeenCalledWith(9051);
  });
});

describe('AgentMessage speaker (founder, 2026-10-09: agent avatars in chat)', () => {
  it('opens a turn the speaker changed to with that teammate\'s avatar and name ("Dana · Pricing")', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        via="via Dana"
        opener={{ name: 'Dana', accent: 'violet', eyebrow: 'Pricing' }}
        message={{ role: 'assistant', content: 'Here is the price.', runs: [{ type: 'text', text: 'Here is the price.' }] }}
      />,
    );

    await expect.element(page.getByTestId('speaker-opener')).toHaveTextContent('Dana· Pricing');
    expect(document.querySelector('[data-testid="speaker-opener"] [data-slot="agent-dot"]')).not.toBeNull();
  });

  it('keeps the quiet mark when the same speaker carries on, and on the lead\'s own turns', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: 'Pipeline is up 12%.', runs: [{ type: 'text', text: 'Pipeline is up 12%.' }] }}
      />,
    );

    await expect.element(page.getByText('Pipeline is up 12%.')).toBeInTheDocument();
    expect(page.getByTestId('speaker-opener').query()).toBeNull();
  });

  it('says who is writing, with their avatar', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        streaming
        writer={{ name: 'Dana', accent: 'violet' }}
        message={{ role: 'assistant', content: 'Draft', runs: [{ type: 'text', text: 'Draft' }] }}
      />,
    );

    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Dana is writing…');
    expect(document.querySelector('[data-testid="streaming-indicator"] [data-slot="agent-dot"]')).not.toBeNull();
  });
});

describe('a tool error is inspectable, one tap under the step that failed (2026-10-09)', () => {
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

  it('the line says it failed in words; the step opens the error, redacted', async () => {
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

    // No badge on the message: the line itself says what failed.
    expect(page.getByTestId('tool-error-badge').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('work-group')).toHaveTextContent('Proposal Writer failed');
    // Folded until asked: neither the steps nor the error are on screen.
    expect(page.getByTestId('work-steps').elements()).toHaveLength(0);
    expect(page.getByTestId('failed-step').elements()).toHaveLength(0);

    await openFailedStep();

    const step = page.getByTestId('failed-step');

    await expect.element(step).toBeVisible();
    // The message a person reads carries neither the tenant id nor the slug:
    // this failure is the empty-workspace state, which has its own sentence.
    await expect.element(step.getByText(/isn't ready yet/)).toBeVisible();
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

    await openFailedStep();
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

  it('says the agent is writing when its words are the newest thing, never a bare "Working…"', async () => {
    await render(<AgentMessage agentName="RevOps Lead" message={streamed} streaming />);

    await expect.element(page.getByTestId('streaming-indicator')).toBeVisible();
    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Writing…');
    expect(document.body.textContent).not.toContain('Working…');
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

describe('one live line per turn (Chris, 2026-10-08: "Can we combine that into 1 line?")', () => {
  const actor = { id: 'lead', kind: 'lead' as const, name: 'Revenue' };
  const looked = { id: 'a', actor, kind: 'tool' as const, status: 'done' as const, label: 'Looked up 3 deals', anchor: 0 };
  const searching = { id: 'b', actor, kind: 'search' as const, status: 'start' as const, label: 'Searching the CRM…', anchor: 0 };

  it('rides the newest group while it is the last thing in the turn — no second line under it', async () => {
    const screen = await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '', runs: [], trace: [looked, searching] }}
        streaming
        activity="Searching the CRM… page 2 of 4"
      />,
    );

    const lines = page.getByTestId('streaming-indicator');

    await expect.element(lines).toHaveTextContent('Searching the CRM… page 2 of 4');

    expect(lines.elements()).toHaveLength(1);
    // The group's line is the turn's line: count and chevron on it, the rows behind it.
    expect(lines.element().closest('[data-testid="work-timeline-live"]')).not.toBeNull();
    await expect.element(lines).toHaveTextContent('2 steps');
    expect(screen.container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await userEvent.click(page.getByRole('button', { name: /2 steps/ }));

    await expect.element(page.getByTestId('work-steps-live')).toBeInTheDocument();
  });

  it('moves to the bottom once prose follows the steps, and the group folds to a quiet finished line', async () => {
    const screen = await render(
      <AgentMessage
        agentName="Revenue"
        message={{
          role: 'assistant',
          content: 'Three deals moved this week.',
          runs: [{ type: 'text', text: 'Three deals moved this week.' }],
          trace: [looked, { ...searching, status: 'done', label: 'Searched the CRM' }],
        }}
        streaming
      />,
    );

    const line = page.getByTestId('streaming-indicator');

    await expect.element(line).toHaveTextContent('Writing…');

    expect(line.elements()).toHaveLength(1);
    expect(line.element().closest('[data-testid="work-timeline-live"]')).toBeNull();
    // Under the words being written, not above them.
    expect(page.getByText('Three deals moved this week.').element().compareDocumentPosition(line.element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The group the agent wrote past is the finished line: no shimmer on it.
    await expect.element(page.getByTestId('work-group')).toBeInTheDocument();
    expect(screen.container.querySelectorAll('.work-shimmer')).toHaveLength(1);
  });

  it('sits at the bottom while the agent is only thinking, with nothing to open yet', async () => {
    const screen = await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '', runs: [], trace: [{ id: 'r', actor, kind: 'reason', status: 'progress', label: 'Thinking', anchor: 0 }] }}
        streaming
        activity={null}
      />,
    );

    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Thinking…');

    expect(page.getByTestId('streaming-indicator').elements()).toHaveLength(1);
    expect(page.getByTestId('work-timeline-live').elements()).toHaveLength(0);
    expect(screen.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('keeps a live group with a failed step folded; the error is two taps in', async () => {
    await render(
      <AgentMessage
        agentName="Revenue"
        message={{ role: 'assistant', content: '', runs: [], trace: [looked, { ...searching, status: 'error', result: 'HubSpot 429' }] }}
        streaming
        activity={null}
      />,
    );

    await expect.element(page.getByTestId('streaming-indicator')).toBeInTheDocument();
    expect(page.getByTestId('work-steps-live').elements()).toHaveLength(0);
    expect(page.getByText('HubSpot 429').elements()).toHaveLength(0);

    await userEvent.click(page.getByTestId('streaming-indicator').getByRole('button'));
    const failedRow = page.getByTestId('work-steps-live').getByRole('button', { name: /failed/ });

    await expect.element(failedRow).toBeInTheDocument();
    // The step says it failed; it does not carry the error on its line.
    expect(page.getByText('HubSpot 429').elements()).toHaveLength(0);

    await userEvent.click(failedRow);

    await expect.element(page.getByTestId('failed-step')).toHaveTextContent('HubSpot 429');
    expect(page.getByTestId('streaming-indicator').elements()).toHaveLength(1);
  });
});

describe('a tool failure says what failed', () => {
  // Once a red badge over the message; now the step says it failed, in words,
  // and the message is behind it (founder, 2026-10-09).
  it('a legacy run names its failure on the step and shows the message when opened', async () => {
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

    expect(page.getByTestId('tool-error-badge').elements()).toHaveLength(0);
    expect(page.getByText(/spec\.md must be a string/).elements()).toHaveLength(0);

    await userEvent.click(page.getByRole('button', { name: /error/ }));
    await userEvent.click(page.getByRole('button', { name: 'What went wrong' }));

    await expect.element(page.getByText(/spec\.md must be a string/)).toBeInTheDocument();
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

    await expect.element(page.getByTestId('work-group')).toHaveTextContent('update_artifact failed');
    expect(page.getByText('artifact 91 not found').elements()).toHaveLength(0);

    await openFailedStep();

    await expect.element(page.getByTestId('failed-step')).toHaveTextContent('artifact 91 not found');
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

    await userEvent.click(page.getByRole('button', { name: /error/ }));
    await userEvent.click(page.getByRole('button', { name: 'What went wrong' }));

    await expect.element(page.getByText(/failed without giving a reason/)).toBeInTheDocument();
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

  it('a turn that failed outright names itself; its reason is under the step', async () => {
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

    // Never "error failed", and never "→ This turn failed".
    await expect.element(page.getByTestId('work-group')).toHaveTextContent('This turn failed');
    expect((await page.getByTestId('work-group').element()).textContent).not.toMatch(/→|error failed/i);

    await openFailedStep();

    await expect.element(page.getByTestId('failed-step')).toHaveTextContent('no model credentials');
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

describe('AgentMessage and the card pass\'s refusals (2026-09-29)', () => {
  it('never shows a "not a card" line from a stored turn', async () => {
    const text = 'Plan 32 is approved; the build starts on its own.\n\n- **Link #41 to #42 as duplicate** — not a card: The values do not fit "request": state must be equal to one of the allowed values.';
    await render(<AgentMessage agentName="Product" message={{ role: 'assistant', content: text, runs: [{ type: 'text', text }] }} />);

    await expect.element(page.getByText(/Plan 32 is approved/)).toBeInTheDocument();

    expect(document.body.textContent).not.toContain('not a card');
  });
});

describe('AgentMessage effort line', () => {
  it('says the level and how long it took, and Dig deeper re-asks one level up', async () => {
    const onDigDeeper = vi.fn();
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        onDigDeeper={onDigDeeper}
        message={{
          role: 'assistant',
          content: 'Two sales threads owe a reply.',
          runs: [{ type: 'text', text: 'Two sales threads owe a reply.' }],
          effort: { level: 'standard', chosenBy: 'auto', reason: 'gather and synthesise', elapsedMs: 6_200, ceilingHit: null, next: 'deep' },
        }}
      />,
    );

    const line = page.getByTestId('turn-effort');

    await expect.element(line).toHaveTextContent('Standard · 6s');

    await userEvent.click(line);

    expect(onDigDeeper).toHaveBeenCalledWith('deep');
    await expect.element(page.getByTestId('dig-deeper')).not.toBeInTheDocument();
  });

  it('offers Dig deeper outright when a ceiling ended the work', async () => {
    const onDigDeeper = vi.fn();
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        onDigDeeper={onDigDeeper}
        message={{
          role: 'assistant',
          content: 'Here is what I found so far.',
          runs: [{ type: 'text', text: 'Here is what I found so far.' }],
          effort: { level: 'quick', chosenBy: 'person', elapsedMs: 41_000, ceilingHit: 'time', next: 'standard' },
        }}
      />,
    );

    await userEvent.click(page.getByTestId('dig-deeper'));

    expect(onDigDeeper).toHaveBeenCalledWith('standard');
  });
});
