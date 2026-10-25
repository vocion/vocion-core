'use client';

import type { AdsAccountChoice } from '@/libs/googleAds/client';
import { useEffect, useRef, useState } from 'react';
import { noStoreClient } from '@/libs/Orpc';

/**
 * The Google Ads account, picked from the accounts the workspace's Google
 * login can run (`connect.googleAdsAccounts`), never ten digits a person has
 * to find and type. Picking an account reached through a manager also fills
 * the manager field. With no login yet, or none of its accounts readable, the
 * typed input stays, with the sentence saying why.
 * @param props - Component props.
 * @param props.value - The customer id the form holds.
 * @param props.onChange - Sets the customer id.
 * @param props.onManager - Sets the manager it is reached through ('' when direct).
 * @param props.label - The field's label, drawn by the caller.
 * @param props.required - Whether the form needs it.
 * @param props.inputClass - The form's input class, so the picker matches its siblings.
 * @param props.load - Where the choices come from (the route by default; a test passes its own).
 */
export function GoogleAdsAccountPicker({ value, onChange, onManager, label, required, inputClass, load }: {
  value: string;
  onChange: (customerId: string) => void;
  onManager: (managerId: string) => void;
  label: React.ReactNode;
  required: boolean;
  inputClass: string;
  load?: () => Promise<{ accounts: AdsAccountChoice[]; reason?: string }>;
}) {
  const [state, setState] = useState<{ loading: boolean; accounts: AdsAccountChoice[]; reason: string | null }>({ loading: true, accounts: [], reason: null });
  // "Look again" bumps this; the read below runs on mount and on every bump.
  const [attempt, setAttempt] = useState(0);
  // The latest value and setters, read when the list arrives without re-reading it on every keystroke.
  const latest = useRef({ value, onChange, onManager });
  useEffect(() => {
    latest.current = { value, onChange, onManager };
  });
  useEffect(() => {
    let cancelled = false;
    (load ?? (() => noStoreClient.connect.googleAdsAccounts()))()
      .then((got) => {
        if (cancelled) {
          return;
        }
        setState({ loading: false, accounts: got.accounts, reason: got.reason ?? null });
        // One account and nothing chosen yet: it is the answer.
        const only = got.accounts.length === 1 ? got.accounts[0] : undefined;
        if (only && !latest.current.value) {
          latest.current.onChange(only.customerId);
          latest.current.onManager(only.managerId ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ loading: false, accounts: [], reason: 'The account list could not be read just now; type the id instead.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const pick = (customerId: string) => {
    onChange(customerId);
    onManager(state.accounts.find(a => a.customerId === customerId)?.managerId ?? '');
  };
  const lookAgain = () => {
    setState(s => ({ ...s, loading: true }));
    setAttempt(n => n + 1);
  };

  if (state.accounts.length > 0) {
    const current = value.replace(/[\s-]/g, '');
    return (
      <label className="block">
        {label}
        <select value={current} required={required} onChange={e => pick(e.target.value)} className={inputClass} data-testid="google-ads-account-picker">
          {current === '' ? <option value="">Pick an account</option> : null}
          {state.accounts.map(a => (
            <option key={a.customerId} value={a.customerId}>{`${a.name} · ${dashed(a.customerId)}${a.managerId ? ' (through a manager account)' : ''}`}</option>
          ))}
          {current !== '' && !state.accounts.some(a => a.customerId === current) ? <option value={current}>{`${dashed(current)} (not on this login)`}</option> : null}
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <input
        type="text"
        required={required}
        value={value}
        placeholder="1234567890"
        onChange={e => onChange(e.target.value)}
        className={inputClass}
      />
      <span className="mt-1 block text-xs text-muted-foreground">
        {state.loading ? 'Reading the accounts your Google login can run…' : state.reason}
        {!state.loading
          ? (
              <button type="button" onClick={lookAgain} className="ml-2 underline underline-offset-2 hover:text-foreground">
                Look again
              </button>
            )
          : null}
      </span>
    </label>
  );
}

/**
 * 1234567890 → 123-456-7890, as Google Ads shows it.
 * @param id - Ten digits.
 */
function dashed(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}
