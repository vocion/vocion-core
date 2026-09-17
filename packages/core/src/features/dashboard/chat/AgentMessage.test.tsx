import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AgentMessage } from './AgentMessage';

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

  it('stays out of the way before any text arrives, so there is only ever one live indicator', async () => {
    await render(
      <AgentMessage
        agentName="RevOps Lead"
        message={{ role: 'assistant', content: '', runs: [] }}
        streaming
        activity="Reading the briefing"
      />,
    );

    expect(page.getByTestId('streaming-indicator').elements()).toHaveLength(0);
  });

  it('disappears when the turn lands', async () => {
    await render(<AgentMessage agentName="RevOps Lead" message={streamed} />);

    expect(page.getByTestId('streaming-indicator').elements()).toHaveLength(0);
  });
});
