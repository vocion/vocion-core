import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { CountBadge } from './count-badge';
import { Notice } from './notice';
import '@/styles/global.css';

describe('Notice (design foundations, 2026-10-23)', () => {
  it('speaks as an alert when something failed, and as a status otherwise', async () => {
    const fail = await render(<Notice tone="fail" title="Couldn't save">Try again in a moment.</Notice>);

    expect(fail.container.querySelector('[data-slot="notice"]')?.getAttribute('role')).toBe('alert');
    expect(fail.container.textContent).toContain('Couldn\'t save');

    const info = await render(<Notice tone="info">Sources sync every hour.</Notice>);

    expect(info.container.querySelector('[data-slot="notice"]')?.getAttribute('role')).toBe('status');
  });

  it('carries one action on the right', async () => {
    const { container } = await render(<Notice tone="warn" action={<button type="button">Review</button>}>Over budget at this pace.</Notice>);

    expect(container.querySelector('button')?.textContent).toBe('Review');
  });
});

describe('CountBadge', () => {
  it('shows nothing for zero, the count otherwise, and caps at 99+', async () => {
    const zero = await render(<CountBadge count={0} />);

    expect(zero.container.querySelector('[data-slot="count-badge"]')).toBeNull();

    const many = await render(<CountBadge count={140} />);

    expect(many.container.textContent).toBe('99+');
  });
});
