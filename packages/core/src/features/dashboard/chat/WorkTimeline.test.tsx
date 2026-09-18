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

  it('a streaming turn shows the working verb AND the live rows as they land, reasoning folded to its first line (§9)', async () => {
    const live: TraceNode[] = [
      { ...TRACE[0]!, status: 'done' },
      { ...TRACE[1]!, status: 'done' },
      { ...TRACE[3]!, status: 'start', label: 'Editing proposal.md…' },
    ];
    await render(<WorkTimeline runs={[]} streaming trace={live} activity="Rewriting section 4" />);

    await expect.element(page.getByText('Rewriting section 4')).toBeInTheDocument();
    await expect.element(page.getByText('Searched the data room')).toBeInTheDocument();
    await expect.element(page.getByText('Editing proposal.md…')).toBeInTheDocument();
    // Reasoning shows its first sentence on the folded line; the full text waits for a tap.
    await expect.element(page.getByText(/The angle rests on two sourced facts\./)).toBeInTheDocument();
    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
  });

  it('a tool error closes its row as an error with the message', async () => {
    const errored: TraceNode[] = [{ ...TRACE[3]!, status: 'error', result: 'HubSpot 429' }];
    await render(<WorkTimeline runs={[]} streaming trace={errored} activity={null} />);

    await expect.element(page.getByText('HubSpot 429')).toBeInTheDocument();
  });
});
