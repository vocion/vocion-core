'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Send a brief back to be written again.
 *
 * The instruction is required, not optional. A rewrite without a reason
 * teaches nothing: the next pass has no more to go on than the last one had,
 * and the reviewer has no record of what they objected to. The note is stored
 * on the row, read by the next briefing run, and shown above the brief it
 * produced.
 *
 * Regenerating returns the lead to unbriefed, so it leaves this screen until
 * the next sweep writes a new brief. That is stated on the control rather than
 * discovered when the row disappears.
 * @param props
 * @param props.briefId
 * @param props.contactName
 */
export const RegenerateBriefControl = (props: { briefId: number; contactName: string }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = note.trim().length > 0 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/personalization/briefs/${props.briefId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? `Regenerate failed (${res.status})`);
        return;
      }
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs transition hover:bg-muted"
      >
        Regenerate
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border p-3">
      <label className="block">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          What should the next brief do differently?
        </span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          aria-label={`Regenerate instruction for ${props.contactName}`}
          placeholder="e.g. The angle leans on an industry pattern rather than anything about this company. Find something specific to them or say there is nothing."
          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>
      <p className="mt-1 text-[13px] text-muted-foreground">
        This clears the brief and puts the lead back in line, so it leaves Review until the next
        sweep writes a new one. Your note goes to that pass.
      </p>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!armed}
          onClick={submit}
          className="rounded-md border border-border bg-foreground px-3 py-1.5 text-sm text-background transition disabled:opacity-40"
        >
          {submitting ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
};
