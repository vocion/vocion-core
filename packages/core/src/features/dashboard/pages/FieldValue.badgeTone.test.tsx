import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import '@/styles/global.css';

// Registered here as in every page test, so this file never meets another file's mock of it
// unregistered (the "Mock /src/libs/I18nNavigation.ts wasn't registered" flake).
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { FieldValue } = await import('./FieldValue');

/**
 * A badge whose row carries its own tone (backlog 045): the Work page's state
 * says how it looks (`meta.stateTone`), and the manifest names only the tones
 * it changes. Fixture rows.
 */

const STATUS = { key: 'status', label: 'Status', from: 'meta.state', format: 'badge', toneFrom: 'meta.stateTone' } as PageField;
const row = (meta: Record<string, unknown>): PageRow => ({ id: 1, title: 'Room PDF export', status: null, createdAt: null, meta });

describe('a badge drawn in the tone its row carries', () => {
  it('draws the carried tone when the page names none', async () => {
    const { container } = await render(<FieldValue row={row({ state: 'Stalled', stateTone: 'warn' })} field={STATUS} now={Date.now()} />);

    expect(container.querySelector('[data-slot="status-pill"]')?.getAttribute('data-status')).toBe('pending');
  });

  it('lets the page override the carried tone', async () => {
    const { container } = await render(<FieldValue row={row({ state: 'Stalled', stateTone: 'warn' })} field={{ ...STATUS, tones: { Stalled: 'bad' } }} now={Date.now()} />);

    expect(container.querySelector('[data-slot="status-pill"]')?.getAttribute('data-status')).toBe('failed');
  });

  it('draws a plain badge when neither names a tone', async () => {
    const { container } = await render(<FieldValue row={row({ state: 'Stalled', stateTone: 'purple' })} field={STATUS} now={Date.now()} />);

    expect(container.querySelector('[data-slot="status-pill"]')).toBeNull();
  });
});
