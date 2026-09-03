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

describe('WorkTimeline three-level transcript', () => {
  it('renders one collapsed claim line per action, with the blast radius on the line', async () => {
    await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);

    await expect.element(page.getByText('Searched the data room')).toBeInTheDocument();
    await expect.element(page.getByText('Edited proposal.md')).toBeInTheDocument();
    await expect.element(page.getByText('+38 −12')).toBeInTheDocument();
    // Level 2 stays hidden until asked.
    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
  });

  it('expands a claim to its steps, and a stepless claim to its payload', async () => {
    await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);

    await userEvent.click(page.getByRole('button', { name: /Searched the data room/ }));
    await expect.element(page.getByText('Found the precedent table')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: /Edited proposal.md/ }));
    await expect.element(page.getByText('section 4 rewritten')).toBeInTheDocument();
  });

  it('reasoning is collapsed like everything else and opens to the text', async () => {
    await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);

    await expect.element(page.getByText('The angle rests on two sourced facts.')).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: /Thought it through/ }));

    await expect.element(page.getByText('The angle rests on two sourced facts.')).toBeInTheDocument();
  });

  it('one control recollapses everything', async () => {
    await render(<WorkTimeline runs={[]} streaming={false} trace={TRACE} />);
    await userEvent.click(page.getByRole('button', { name: /Searched the data room/ }));
    await userEvent.click(page.getByRole('button', { name: /Thought it through/ }));

    await userEvent.click(page.getByRole('button', { name: 'Collapse all' }));

    await expect.element(page.getByText('Found the precedent table')).not.toBeInTheDocument();
    await expect.element(page.getByText('The angle rests on two sourced facts.')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument();
  });

  it('a streaming turn shows the working verb, never claims', async () => {
    await render(<WorkTimeline runs={[]} streaming trace={TRACE} activity="Rewriting section 4" />);

    await expect.element(page.getByText('Rewriting section 4')).toBeInTheDocument();
    await expect.element(page.getByText('Edited proposal.md')).not.toBeInTheDocument();
  });
});
