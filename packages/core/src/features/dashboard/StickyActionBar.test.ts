import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '@/locales/en.json';
import { StickyActionBar } from './StickyActionBar';

// Static render under the unit project (node): what the bar puts on the page
// before any interaction. Clicking is the browser project's job.
const html = (el: ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', messages, timeZone: 'UTC', children: el }));
const noop = () => {};
const primary = { 'label': 'Enroll', 'onClick': noop, 'shortcut': 'a', 'data-testid': 'decide-approve' };

describe('StickyActionBar', () => {
  it('sticks to the bottom of its column, pads the phone safe area and always shows the verbs', () => {
    const out = html(createElement(StickyActionBar, {
      primary,
      secondary: [{ label: 'Decline', onClick: noop, shortcut: 'd' }, { label: 'Snooze', onClick: noop, shortcut: 's' }],
    }));

    expect(out).toContain('sticky bottom-0');
    expect(out).toContain('safe-area-inset-bottom');
    // Every verb's word is in the markup at every width. On a phone the
    // secondaries' words are `sr-only` rather than `hidden`, so they still
    // reach a screen reader and `getByRole('button', { name })` — the icon is
    // what a sighted person reads there, not a nameless control.
    expect(out).toContain('<span>Enroll</span>');
    expect(out).toContain('sr-only sm:not-sr-only">Decline</span>');
    expect(out).toContain('sr-only sm:not-sr-only">Snooze</span>');
    expect(out).toContain('>a</kbd>');
  });

  it('keeps the verbs on ONE row at every width, sized to their content', () => {
    // The defect: `flex-col` plus `w-full` buttons stacked three full-width
    // verbs and the note toggle down a phone, taking half the viewport on the
    // one surface whose job is reading what is underneath them.
    const out = html(createElement(StickyActionBar, {
      primary,
      secondary: [{ label: 'Decline', onClick: noop }, { label: 'Snooze', onClick: noop }],
      field: { label: 'Note', value: '', onChange: noop },
    }));

    expect(out).not.toContain('flex flex-col gap-2 sm:flex-row');
    expect(out).toContain('flex flex-row flex-wrap items-center gap-2');
    // Sized to content, never to the column.
    expect(out).not.toContain('h-11 w-full');
    // And the note toggle rides the same row rather than being pushed last.
    expect(out).not.toContain('order-last');
  });

  it('paints the primary in ink from the --action token, falling back to the foreground on main', () => {
    const out = html(createElement(StickyActionBar, { primary }));

    expect(out).toMatch(/<button[^>]*bg-\[var\(--action,var\(--foreground\)\)\][^>]*data-testid="decide-approve"/);
  });

  it('keeps the feedback field folded until asked', () => {
    const out = html(createElement(StickyActionBar, { primary, field: { label: 'Feedback', value: '', onChange: noop } }));

    expect(out).toContain('Add a note');
    expect(out).not.toContain('<textarea');
  });

  it('opens the field when it already holds text, with the field action beside it', () => {
    const out = html(createElement(StickyActionBar, {
      primary,
      field: { label: 'Feedback', value: 'shorter, mention the July call', onChange: noop, action: { label: 'Regenerate', onClick: noop } },
    }));

    expect(out).toContain('<textarea');
    expect(out).toContain('Hide the note');
    expect(out).toContain('Regenerate');
  });

  it('renders a disabled field action as disabled — Regenerate waits for text', () => {
    const out = html(createElement(StickyActionBar, {
      primary,
      field: { label: 'Feedback', value: '', onChange: noop, defaultOpen: true, action: { label: 'Regenerate', onClick: noop, disabled: true } },
    }));

    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?Regenerate/);
  });
});
