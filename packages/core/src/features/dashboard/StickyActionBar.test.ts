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
    expect(out).toContain('<span>Enroll</span>');
    expect(out).toContain('<span>Decline</span>');
    expect(out).toContain('<span>Snooze</span>');
    expect(out).toContain('>a</kbd>');
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
