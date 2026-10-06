import { describe, expect, it } from 'vitest';
import { withArticle } from './withArticle';

describe('withArticle', () => {
  it('puts "an" before a credential that starts with a capital vowel, so chat never says "Paste a API key"', () => {
    expect(withArticle('API key')).toBe('an API key');
    expect(withArticle('OAuth client and refresh token')).toBe('an OAuth client and refresh token');
  });

  it('puts "a" before a consonant, and nothing before a plural', () => {
    expect(withArticle('Session token')).toBe('a Session token');
    expect(withArticle('Server-to-server OAuth app credentials')).toBe('Server-to-server OAuth app credentials');
  });
});
