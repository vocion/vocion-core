import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '@/locales/en.json';
import { TypeChips } from './TypeChips';

const html = (el: ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', messages, timeZone: 'UTC', children: el }));
const noop = () => {};

const TYPES = [
  { actionId: 'hubspot.update', label: 'Update HubSpot record', count: 101 },
  { actionId: 'personalization.enroll', label: 'Enroll MQL in sequence', count: 82 },
  { actionId: 'discovery.review_proposal', label: 'Review discovery call → proposal', count: 20 },
  { actionId: 'gmail.send', label: 'Send email', count: 6 },
  { actionId: 'objects.propose_candidate', label: 'Propose a record for review', count: 4 },
];

describe('TypeChips', () => {
  it('leads with "All" and the whole queue count, pressed when nothing is chosen', () => {
    const out = html(createElement(TypeChips, { types: TYPES, active: [], onChange: noop }));

    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*>All<span[^>]*>·<\/span><span[^>]*>213<\/span>/);
    // Every type is a chip with its count; the action id stays out of the row text.
    expect(out).toContain('Enroll MQL in sequence');
    expect(out).toContain('>82<');
    expect(out).not.toContain('>personalization.enroll<');
  });

  it('fills the active chips in ink and releases "All"', () => {
    const out = html(createElement(TypeChips, { types: TYPES, active: ['hubspot.update', 'gmail.send'], onChange: noop }));

    expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>All</);
    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*bg-\[var\(--action,var\(--foreground\)\)\][^>]*>Update HubSpot record</);
    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Send email</);
    expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Enroll MQL in sequence</);
  });
});
