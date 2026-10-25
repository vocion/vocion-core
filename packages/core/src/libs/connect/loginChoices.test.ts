import { describe, expect, it } from 'vitest';
import { loginChoicesFrom } from './loginChoices';

describe('loginChoicesFrom', () => {
  it('offers each ad account a login reaches, by name and id, once', () => {
    expect(loginChoicesFrom({ accessToken: 'x', adAccounts: [{ id: 'act_1', name: 'Northwind Brand' }, { id: 'act_1', name: 'dup' }, { id: '508000002', name: '' }] })).toEqual([
      { value: 'act_1', label: 'Northwind Brand (act_1)' },
      { value: '508000002', label: '508000002' },
    ]);
  });

  it('offers nothing for a pasted token, an older login or no login', () => {
    expect(loginChoicesFrom({ token: 'pasted' })).toEqual([]);
    expect(loginChoicesFrom({ accessToken: 'x', accounts: ['Names only'] })).toEqual([]);
    expect(loginChoicesFrom(null)).toEqual([]);
  });
});

describe('the ad account settings pick from the login', () => {
  it('LinkedIn Ads and Meta Ads offer the login\'s ad accounts instead of a typed id', async () => {
    const { CONFIG_FIELDS } = await import('@/libs/sources/configFields');

    for (const connector of ['linkedin-ads', 'meta-ads']) {
      expect(CONFIG_FIELDS[connector]!.find(field => field.key === 'accountId')?.choicesFromLogin).toBe(true);
    }
  });
});
