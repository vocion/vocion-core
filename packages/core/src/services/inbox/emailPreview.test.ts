import { describe, expect, it } from 'vitest';
import { emailPreviewFrom } from './emailPreview';

describe('emailPreviewFrom', () => {
  it('reads a gmail.send payload as an email a person can proof', () => {
    const preview = emailPreviewFrom('gmail.send', {
      to: 'amy@northwind.example',
      cc: 'jordan@northwind.example',
      subject: 'Kestrel + Contoso intros',
      body: 'Amy,\r\n\r\nGreat reconnecting.\n\nChris',
      draft: true,
      baseUrl: 'https://gmail.googleapis.com/gmail/v1',
    });

    expect(preview).toEqual({
      to: 'amy@northwind.example',
      cc: 'jordan@northwind.example',
      subject: 'Kestrel + Contoso intros',
      body: 'Amy,\n\nGreat reconnecting.\n\nChris',
      draft: true,
    });
  });

  it('names a missing subject rather than showing an empty line', () => {
    expect(emailPreviewFrom('gmail.send', { to: 'amy@northwind.example', body: 'Hi' })?.subject).toBe('(no subject)');
    expect(emailPreviewFrom('gmail.send', { to: 'amy@northwind.example', body: 'Hi' })?.draft).toBe(false);
  });

  it('is null for anything that is not an email, or an email with nothing to read', () => {
    expect(emailPreviewFrom('hubspot.update', { objectType: 'deals', properties: { dealstage: 'won' } })).toBeNull();
    expect(emailPreviewFrom('gmail.send', { to: 'amy@northwind.example' })).toBeNull();
  });
});
