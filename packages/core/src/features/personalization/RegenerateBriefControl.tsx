'use client';

import { RefreshCw } from 'lucide-react';
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
 *
 * A ghost verb that opens an inline field (Detail archetype: no box around a
 * form; the field is a soft fill, the one ink button is the commit).
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
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Regenerate
      </button>
    );
  }

  return (
    <div className="border-t border-rule pt-3" data-testid="regenerate-brief">
      <label className="block">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          What should the next brief do differently?
        </span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          aria-label={`Regenerate instruction for ${props.contactName}`}
          placeholder="e.g. The angle leans on an industry pattern rather than anything about this company. Find something specific to them or say there is nothing."
          className="mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30"
        />
      </label>
      <p className="mt-1 text-[13px] text-muted-foreground">
        This clears the brief and puts the lead back in line, so it leaves Review until the next
        sweep writes a new one. Your note goes to that pass.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="h-9 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!armed}
          onClick={submit}
          className="h-9 rounded-lg bg-action px-3 text-sm text-action-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
};
