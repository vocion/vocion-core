'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * TEMPORARY — phase 2 deletes this file.
 *
 * Clears the personalization queue so the sweep can be tested more than once
 * (the unique index makes a second run a no-op otherwise). Rendered only when
 * `VOCION_ALLOW_QUEUE_RESET` is set and the viewer is an org admin; the route
 * behind it enforces both again.
 *
 * The confirm dialog is inline rather than a Radix AlertDialog because there
 * is no AlertDialog in `components/ui/` and this control is coming back out.
 * The operator has to type the row count, so the number they are destroying
 * is something they read rather than something they clicked past.
 * @param props
 * @param props.rowCount
 */
export const QueueResetControl = (props: { rowCount: number }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = String(props.rowCount);
  const armed = typed.trim() === expected && !submitting;

  const close = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/personalization/queue', { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? `Reset failed (${res.status})`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        Delete queue
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-xl">
            <div className="border-b px-4 py-3">
              <h3 className="font-display text-lg">Delete the personalization queue</h3>
            </div>
            <div className="space-y-4 p-4 text-sm">
              <p>
                This deletes
                {' '}
                <span className="font-semibold">{props.rowCount}</span>
                {' '}
                {props.rowCount === 1 ? 'lead' : 'leads'}
                {' '}
                from this workspace's queue. The HubSpot mirror is untouched, so
                the next sweep can re-queue without a re-sync.
              </p>
              <label className="block">
                <span className="text-foreground/80">
                  Type
                  {' '}
                  <span className="font-mono font-semibold">{expected}</span>
                  {' '}
                  to confirm
                </span>
                <Input
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  inputMode="numeric"
                  aria-label="Type the row count to confirm"
                  className="mt-1"
                />
              </label>
              {error && <p className="text-destructive">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!armed}
                onClick={submit}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-white transition disabled:opacity-40"
              >
                {submitting ? 'Deleting…' : 'Delete queue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
