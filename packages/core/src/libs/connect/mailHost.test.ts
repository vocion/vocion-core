import { describe, expect, it } from 'vitest';
import { exchangeMatches, mailDomainOf, mailExchangesFor } from './mailHost';

describe('mail host evidence', () => {
  it('takes the domain of an address, and never looks up a reserved fixture domain', () => {
    expect(mailDomainOf('Dana@Northwind-Traders.org')).toBe('northwind-traders.org');
    expect(mailDomainOf('dana@northwind.example')).toBeNull();
    expect(mailDomainOf('not an address')).toBeNull();
    expect(mailDomainOf(null)).toBeNull();
  });

  it('matches an exchange to a declared host or a subdomain of it, not a lookalike', () => {
    expect(exchangeMatches('aspmx.l.google.com.', ['google.com'])).toBe(true);
    expect(exchangeMatches('google.com', ['google.com'])).toBe(true);
    expect(exchangeMatches('mail.notgoogle.com', ['google.com'])).toBe(false);
  });

  it('answers no evidence, quickly, when the lookup fails or hangs', async () => {
    await expect(mailExchangesFor('northwind-traders.org', { resolve: async () => {
      throw new Error('ENOTFOUND');
    } })).resolves.toEqual([]);
    await expect(mailExchangesFor('northwind-traders.org', { resolve: () => new Promise(() => {}), timeoutMs: 10 })).resolves.toEqual([]);
  });
});
