/**
 * An approval's preview is the payload it runs with. Fixtures are fictional
 * (Northwind, Kestrel Capital).
 */
import { describe, expect, it } from 'vitest';
import { payloadPreview } from './preview';

describe('payloadPreview', () => {
  it('shows a message as its envelope then its words', () => {
    expect(payloadPreview({ to: 'ops@kestrel.example', subject: 'Renewal', body: 'Hi Pat — the renewal terms are attached.' })).toBe('To: ops@kestrel.example\nSubject: Renewal\n\nHi Pat — the renewal terms are attached.');
  });

  it('shows a record update field by field, on its record', () => {
    expect(payloadPreview({ objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation', amount: 12000 } })).toBe('deal #4410\ndealstage → negotiation\namount → 12000');
  });

  it('shows a command as it will run, anything else as its JSON, and nothing for no input', () => {
    expect(payloadPreview({ command: 'npm run deploy' })).toBe('$ npm run deploy');
    expect(payloadPreview({ app: 'software-factory' })).toBe('{\n  "app": "software-factory"\n}');
    expect(payloadPreview({})).toBeNull();
  });
});
