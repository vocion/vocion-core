import { describe, expect, it } from 'vitest';
import { canonicalGmailUrl, gmailThreadUrl, gmailUrl } from './gmailUrl';

describe('links into Gmail', () => {
  it('names the account by authuser, never in the u/ segment Gmail 404s on', () => {
    expect(gmailThreadUrl('rowan@northwind.example', 't-42')).toBe('https://mail.google.com/mail/?authuser=rowan%40northwind.example#all/t-42');
    expect(gmailUrl('rowan@northwind.example', '#drafts?compose=m1')).toBe('https://mail.google.com/mail/?authuser=rowan%40northwind.example#drafts?compose=m1');
    expect(gmailThreadUrl(null, 't-42')).toBe('https://mail.google.com/mail/#all/t-42');
  });

  it('rewrites a stored link filed in the old form, and leaves the rest alone', () => {
    expect(canonicalGmailUrl('https://mail.google.com/mail/u/rowan%40northwind.example/#all/t-42')).toBe('https://mail.google.com/mail/?authuser=rowan%40northwind.example#all/t-42');
    expect(canonicalGmailUrl('https://mail.google.com/mail/u/0/#all/t-42')).toBe('https://mail.google.com/mail/u/0/#all/t-42');
    expect(canonicalGmailUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(canonicalGmailUrl(null)).toBeNull();
  });
});
