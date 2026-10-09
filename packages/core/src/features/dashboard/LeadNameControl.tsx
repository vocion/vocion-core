'use client';

import { useState } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * Give the workspace's lead a first name ("Ava"), optional. Empty, it reads as
 * its role ("Revenue lead"), which follows the workspace's name. Shown on the
 * lead's profile and on Brand, in "Make it yours". Admins only; the server
 * says so to anyone else.
 * @param props - The control's inputs.
 * @param props.role - The lead's role, named for the workspace.
 * @param props.given - Its given name now, when it has one.
 */
export function LeadNameControl({ role, given }: { role: string; given: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(given ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setState('saving');
    setMessage(null);
    try {
      const named = await client.agents.setLeadName({ name: value });
      setState('saved');
      setMessage(named.given ? `Now "${named.label}".` : `Now "${named.label}".`);
      router.refresh();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Could not save the name.');
    }
  };

  return (
    <form
      data-testid="lead-name-control"
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="lead-given-name" className="text-[13px] font-medium text-foreground">
        {`Give the ${role} a name`}
        <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">(optional)</span>
      </label>
      <div className="flex items-center gap-2">
        <input
          id="lead-given-name"
          value={value}
          onChange={e => setValue(e.target.value)}
          maxLength={40}
          placeholder="e.g. Ava"
          className="h-9 w-48 rounded-lg border border-border bg-background px-3 text-[13px] outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <button
          type="submit"
          disabled={state === 'saving' || value.trim() === (given ?? '')}
          className="h-9 rounded-lg border border-border px-3 text-[13px] font-medium transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground" role="status">
        {message ?? (value.trim() ? `Reads as "${value.trim()} · ${role}".` : `Reads as "${role}".`)}
      </p>
    </form>
  );
}
