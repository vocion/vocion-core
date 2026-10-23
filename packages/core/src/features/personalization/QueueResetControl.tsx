'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/**
 * TEMPORARY — phase 2 deletes this file.
 *
 * Clears the personalization queue so the sweep can be tested more than once
 * (the unique index makes a second run a no-op otherwise). Rendered only when
 * `VOCION_ALLOW_QUEUE_RESET` is set and the viewer is an org admin; the route
 * behind it enforces both again.
 *
 * The confirm is the shared `Dialog` (design sweep, 2026-10-23: it was a
 * hand-made `fixed inset-0` overlay; there is still no AlertDialog in
 * `components/ui/` and this control is coming back out).
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
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Delete queue
      </button>

      <Dialog open={open} onOpenChange={next => !next && close()}>
        <DialogContent className="max-w-md gap-0 p-0" showCloseButton={false}>
          <div className="w-full">
            <div className="border-b px-4 py-3">
              <DialogTitle className="font-display text-lg">Delete the personalization queue</DialogTitle>
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
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!armed}
                onClick={submit}
                className={buttonVariants({ variant: 'destructive', size: 'sm' })}
              >
                {submitting ? 'Deleting…' : 'Delete queue'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
