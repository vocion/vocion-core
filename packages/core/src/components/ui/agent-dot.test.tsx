import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { AgentDot } from './agent-dot';
import '@/styles/global.css';

/** One face per agent (2026-10-23): its colour at rest, the spark only while it works. */
describe('AgentDot', () => {
  it('wears the agent colour at rest and the spark while it works, on the same element', async () => {
    const { container, rerender } = await render(<AgentDot name="Dana" accent="violet" size="md" decorative />);
    const dot = container.querySelector('[data-slot="agent-dot"]')!;

    expect(dot.hasAttribute('data-working')).toBe(false);
    expect(dot.querySelector('.agent-dot-spark')).not.toBeNull();

    await rerender(<AgentDot name="Dana" accent="violet" size="md" decorative working />);

    expect(container.querySelector('[data-slot="agent-dot"]')).toBe(dot);
    expect(dot.hasAttribute('data-working')).toBe(true);
  });

  it('draws the initial from 24px up, and only the colour below', async () => {
    const md = await render(<AgentDot name="Dana" size="md" decorative />);

    expect(md.container.textContent).toBe('D');

    const xs = await render(<AgentDot name="Dana" size="xs" decorative />);

    expect(xs.container.textContent).toBe('');
  });
});
