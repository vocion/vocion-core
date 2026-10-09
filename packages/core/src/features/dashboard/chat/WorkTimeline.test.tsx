import type { TraceNode } from './types';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { WorkTimeline } from './WorkTimeline';

const actor = { id: 'revops-lead', kind: 'lead' as const, name: 'RevOps Lead' };

const TRACE: TraceNode[] = [
  { id: 'r1', actor, kind: 'reason', status: 'done', label: 'Reasoned', text: 'The angle rests on two sourced facts.' },
  { id: 's1', actor, kind: 'search', status: 'done', label: 'Searched the data room', detail: 'hosting, monthly', result: '3 results' },
  { id: 's1a', parentId: 's1', actor, kind: 'tool', status: 'done', label: 'Found the precedent table', tool: 'search', resultDetail: 'precedents.md' },
  { id: 't1', actor, kind: 'tool', status: 'done', label: 'Edited proposal.md', result: '+38 −12', tool: 'edit_file', args: '{"path":"proposal.md"}', resultDetail: 'section 4 rewritten' },
];

/** After the turn the trace is one folded line; every test that reads the claims opens it first (§9). */
async function renderUnfolded() {
  await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);
  await userEvent.click(page.getByTestId('work-group').getByRole('button').first());
}

/**
 * A level-1 claim row, by its label — inside the steps list, never the headline that quotes the same words.
 * @param name
 */
const claim = (name: RegExp) => page.getByTestId('work-steps').getByRole('button', { name });

describe('WorkTimeline three-level transcript', () => {
  it('folds a finished turn to one line that says what the work was, and opens on tap', async () => {
    await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);

    // The headline is composed from the steps' own finished labels; the count rides in the accessible name.
    await expect.element(page.getByRole('button', { name: /Searched the data room and edited proposal.md · 3 steps/ })).toBeInTheDocument();
    await expect.element(page.getByTestId('work-steps')).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('work-group').getByRole('button').first());

    await expect.element(claim(/Searched the data room/)).toBeInTheDocument();
  });

  it('renders one collapsed claim line per action, with the blast radius on the line', async () => {
    await renderUnfolded();

    await expect.element(claim(/Searched the data room/)).toBeInTheDocument();
    await expect.element(claim(/Edited proposal.md/)).toBeInTheDocument();
    await expect.element(page.getByText('+38 −12')).toBeInTheDocument();
    // Level 2 stays hidden until asked.
    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
  });

  it('expands a claim to its steps, and a stepless claim to its payload', async () => {
    await renderUnfolded();

    await userEvent.click(claim(/Searched the data room/));

    await expect.element(page.getByText('Found the precedent table')).toBeInTheDocument();

    await userEvent.click(claim(/Edited proposal.md/));

    await expect.element(page.getByText('section 4 rewritten')).toBeInTheDocument();
  });

  it('reasoning is collapsed like everything else and opens to the text', async () => {
    await renderUnfolded();

    await expect.element(page.getByText('The angle rests on two sourced facts.')).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: /Thought it through/ }));

    await expect.element(page.getByText('The angle rests on two sourced facts.')).toBeInTheDocument();
  });

  it('one control recollapses everything', async () => {
    await renderUnfolded();
    await userEvent.click(claim(/Searched the data room/));
    await userEvent.click(page.getByRole('button', { name: /Thought it through/ }));

    await userEvent.click(page.getByRole('button', { name: 'Collapse all' }));

    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
    await expect.element(page.getByText('The angle rests on two sourced facts.')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument();
  });

  it('a streaming turn is folded: the status line says what is happening, the rows wait for a tap (Chris, 2026-09-25)', async () => {
    const live: TraceNode[] = [
      { ...TRACE[0]!, status: 'done' },
      { ...TRACE[1]!, status: 'done' },
      { ...TRACE[3]!, status: 'start', label: 'Editing proposal.md…' },
    ];
    await render(<WorkTimeline runs={[]} streaming trace={live} activity="Rewriting section 4" />);

    // One shimmering line says what is happening now.
    await expect.element(page.getByRole('status')).toHaveTextContent('Rewriting section 4');
    await expect.element(page.getByTestId('work-steps-live')).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: /2 steps/ }));

    const rows = page.getByTestId('work-steps-live');

    await expect.element(rows.getByText('Searched the data room')).toBeInTheDocument();
    await expect.element(rows.getByText('Editing proposal.md…')).toBeInTheDocument();
    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
  });

  it('is ONE line while live: the running step, the count and the clock, not a summary over a status line (Chris, 2026-10-08)', async () => {
    const live: TraceNode[] = [
      { ...TRACE[0]!, status: 'done' },
      { ...TRACE[1]!, status: 'done' },
      { ...TRACE[3]!, status: 'start', label: 'Editing proposal.md…' },
    ];
    const { container } = await render(<WorkTimeline runs={[]} streaming trace={live} activity={null} elapsed={12} />);

    const line = page.getByTestId('streaming-indicator');

    // The running step names the line; the finished ones are counted, not composed into a second headline.
    await expect.element(line).toHaveTextContent('Editing proposal.md…');
    await expect.element(line).toHaveTextContent('· 2 steps · 12s');
    expect(container.querySelectorAll('.work-shimmer')).toHaveLength(1);
    expect(container.textContent).not.toContain('Searched the data room and');
    // One polite live region, holding the words only — never the ticking seconds.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Editing proposal.md…');
  });

  it('thinking only: the line says so, and opens onto the reasoning', async () => {
    const thinking: TraceNode[] = [{ ...TRACE[0]!, status: 'progress' }];
    await render(<WorkTimeline runs={[]} streaming trace={thinking} activity={null} />);

    await expect.element(page.getByTestId('streaming-indicator')).toHaveTextContent('Thinking…');

    await userEvent.click(page.getByRole('button', { name: 'Thinking…' }));
    await userEvent.click(page.getByRole('button', { name: /Thought it through/ }));

    await expect.element(page.getByText('The angle rests on two sourced facts.')).toBeInTheDocument();
  });

  it('a failure inside a specialist\'s steps opens the live group by itself', async () => {
    const failed: TraceNode[] = [
      { ...TRACE[1]!, status: 'start' },
      { ...TRACE[2]!, status: 'error', resultDetail: 'precedents.md is locked' },
    ];
    await render(<WorkTimeline runs={[]} streaming trace={failed} activity={null} />);

    await expect.element(page.getByTestId('work-steps-live')).toBeInTheDocument();
    await expect.element(page.getByTestId('failed-step')).toHaveTextContent('precedents.md is locked');
  });

  it('a tool error closes its row as an error with the message', async () => {
    const errored: TraceNode[] = [{ ...TRACE[3]!, status: 'error', result: 'HubSpot 429' }];
    await render(<WorkTimeline runs={[]} streaming trace={errored} activity={null} />);

    await expect.element(page.getByText('HubSpot 429')).toBeInTheDocument();
  });
});

describe('the running step says where the call has got to', () => {
  /**
   * "'working…' isn't much info" (Chris, twice, 2026-09-18). A twelve-sheet
   * render holds one step line for a minute; the note rides that line.
   */
  const building: TraceNode[] = [
    { id: 'd1', actor, kind: 'tool', status: 'progress', label: 'Rendering the document…', tool: 'render_document', progress: 'sheet 7 of 12', labels: { running: 'Rendering the document…', done: 'Rendered the document' } },
  ];

  it('shows the note on the headline and on the step, not on a surface of its own', async () => {
    const { container } = await render(<WorkTimeline runs={[]} streaming trace={building} activity={null} />);
    await userEvent.click(page.getByRole('button', { name: /1 step/ }));

    const headline = container.querySelector('[data-testid="work-timeline-live"] [data-testid="streaming-indicator"] .work-shimmer');
    const step = container.querySelector('[data-testid="work-steps-live"] li');

    expect(headline?.textContent).toBe('Rendering the document… sheet 7 of 12');
    expect(step?.textContent).toContain('Rendering the document… sheet 7 of 12');
    // One timeline, one step row: the note added information, not a component.
    expect(container.querySelectorAll('[data-testid="work-timeline-live"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="work-steps-live"] > li')).toHaveLength(1);
  });

  it('reads plainly again the moment the step lands', async () => {
    const landed: TraceNode[] = [{ ...building[0]!, status: 'done', label: 'Rendered the document', progress: undefined }];
    const { container } = await render(<WorkTimeline runs={[]} streaming trace={landed} activity={null} />);
    // Nothing is running now, so the live line says the agent is thinking; the step itself reads plainly.
    await userEvent.click(page.getByRole('button', { name: /1 step/ }));

    expect(container.textContent).toContain('Rendered the document');
    expect(container.textContent).not.toContain('sheet 7 of 12');
  });
});

describe('a live step is the same one-line row as a finished one', () => {
  const LIVE: TraceNode[] = [
    { id: 'l1', actor, kind: 'tool', status: 'done', label: 'Looked up requests', detail: 'request records', result: '54 records', tool: 'lookup_objects', args: '{"type":"request"}', resultDetail: 'request #126 Retry uploads' },
    { id: 'l2', actor, kind: 'tool', status: 'start', label: 'Retrieving the briefing', tool: 'get_briefing' },
  ];

  it('puts label, detail and result on one line, with the call behind a tap on the row', async () => {
    await render(<WorkTimeline runs={[]} streaming trace={LIVE} />);
    await userEvent.click(page.getByRole('button', { name: /2 steps/ }));
    const steps = page.getByTestId('work-steps-live');

    // No second line with a "Show call" link: the row itself is the control.
    await expect.element(steps.getByText(/Show call/)).not.toBeInTheDocument();

    const row = steps.getByRole('button', { name: /Looked up requests · request records/ });

    await expect.element(row).toBeInTheDocument();
    await expect.element(steps.getByText('54 records')).toBeInTheDocument();

    await userEvent.click(row);

    await expect.element(page.getByText(/request #126 Retry uploads/)).toBeInTheDocument();
  });
});

describe('a team answer (founder, 2026-10-09: agent avatars in chat)', () => {
  const lead = { id: 'revenue-lead', kind: 'lead' as const, name: 'Revenue lead' };
  const ASKED: TraceNode[] = [
    { id: 'd1', actor: lead, kind: 'delegate', status: 'done', label: 'Dana finished' },
    { id: 'd1a', parentId: 'd1', actor: { id: 'dana', kind: 'specialist', name: 'Dana' }, kind: 'tool', status: 'done', label: 'Read the price book' },
    { id: 'd2', actor: lead, kind: 'delegate', status: 'done', label: 'Kit finished' },
    { id: 'd2a', parentId: 'd2', actor: { id: 'kit', kind: 'specialist', name: 'Kit' }, kind: 'tool', status: 'done', label: 'Read the contract' },
    { id: 'd3', actor: lead, kind: 'delegate', status: 'done', label: 'Delegated to Morgan' },
  ];

  it('shows the cluster of everyone asked, and each answer under its own avatar', async () => {
    const { ChatAgentsProvider } = await import('./ChatAgents');
    await render(
      <ChatAgentsProvider value={[{ slug: 'dana', name: 'Dana', icon: 'bot', placeholder: '', accent: 'violet' }, { slug: 'kit', name: 'Kit', icon: 'bot', placeholder: '', accent: 'teal' }]}>
        <WorkTimeline runs={[]} streaming={false} trace={ASKED} />
      </ChatAgentsProvider>,
    );

    await expect.element(page.getByTestId('work-group')).toHaveAttribute('data-asked', '3');
    expect(document.querySelector('[data-testid="work-group"] [data-slot="agent-dots"]')?.getAttribute('aria-label')).toBe('Dana, Kit, Morgan');

    await userEvent.click(page.getByTestId('work-group').getByRole('button').first());

    expect(document.querySelectorAll('[data-testid="work-steps"] [data-slot="agent-dot"]').length).toBeGreaterThanOrEqual(3);
  });
});
