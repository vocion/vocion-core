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
