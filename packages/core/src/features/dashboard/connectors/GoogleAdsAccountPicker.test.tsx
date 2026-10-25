import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { GoogleAdsAccountPicker } from './GoogleAdsAccountPicker';
import '@/styles/global.css';

/**
 * After "Log in with Google", the Ads account is a pick, never ten typed
 * digits. Every account name and id is fictional.
 */
const ACCOUNTS = [
  { customerId: '4440000004', name: 'Kestrel Video', managerId: '2220000002' },
  { customerId: '1110000001', name: 'Northwind Outdoors', managerId: null },
];

describe('GoogleAdsAccountPicker', () => {
  it('lists the login\'s accounts; picking one under a manager also names the manager', async () => {
    const onChange = vi.fn();
    const onManager = vi.fn();
    await render(<GoogleAdsAccountPicker value="" onChange={onChange} onManager={onManager} label="Google Ads account" required inputClass="" load={async () => ({ accounts: ACCOUNTS })} />);

    const picker = page.getByTestId('google-ads-account-picker');

    await expect.element(picker).toBeInTheDocument();

    await picker.selectOptions('4440000004');

    expect(onChange).toHaveBeenLastCalledWith('4440000004');
    expect(onManager).toHaveBeenLastCalledWith('2220000002');
  });

  it('with one account and nothing picked, picks it', async () => {
    const onChange = vi.fn();
    const onManager = vi.fn();
    await render(<GoogleAdsAccountPicker value="" onChange={onChange} onManager={onManager} label="Google Ads account" required inputClass="" load={async () => ({ accounts: [ACCOUNTS[1]!] })} />);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('1110000001'));

    expect(onManager).toHaveBeenCalledWith('');
  });

  it('with no login yet, keeps the typed input and says what to do first', async () => {
    await render(<GoogleAdsAccountPicker value="" onChange={vi.fn()} onManager={vi.fn()} label="Google Ads account" required inputClass="" load={async () => ({ accounts: [], reason: 'Log in with Google first, then pick the account.' })} />);

    await expect.element(page.getByText('Log in with Google first, then pick the account.')).toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Look again' })).toBeInTheDocument();
  });
});
