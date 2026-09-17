'use client';

import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * Regenerate ONE artifact, optionally with an instruction.
 *
 * > "put a regenerate and regenerate with prompt UX in there? shouldn't we
 * > already have that?" — Chris, 2026-09-16
 *
 * We did. `RegenerateBriefControl` had both forms and good copy, and it sat at
 * the bottom of the right-hand metadata column, below confidence, timeline and
 * CRM context — so it was never found. That is a reduction-pass lesson rather
 * than a missing feature: a real capability made invisible by the column it
 * was parked in. This is the same control, generalised and re-homed **next to
 * the artifact it regenerates**.
 *
 * What the three-artifact split changes:
 *
 * - There is one of these per artifact — brief, recommendation, draft sequence
 *   — instead of one control in a sidebar that silently meant "the brief". The
 *   sequence had no whole-artifact regenerate at all; now it does.
 * - **The instruction becomes the new version's change summary**, so the
 *   history reads "v3 — regenerated: the angle leans on an industry pattern
 *   rather than anything about this company", and a person can see which
 *   instruction produced which draft.
 * - A regeneration is a new version, never a silent overwrite. The decision's
 *   pin is unaffected: it still names the versions that were approved.
 *
 * The per-send rewrite (`@change`, the selection control → `rewriteDraft`) is
 * deliberately NOT this. That is a targeted edit of one send; this rewrites the
 * whole artifact, and the two read as different things.
 *
 * Generated copy goes through the workspace voice gate (#370). A rewrite that
 * fails it twice used to return the old text with nothing on screen — the
 * person pressed a button and watched nothing happen. `voiceError` is rendered
 * here instead, with the rules it broke.
 */

export type RegenerateTarget = 'brief' | 'recommendation' | 'sequence';

export type ArtifactRegenerateControlProps = {
  /** `lead_brief.id` — what the endpoint regenerates against. */
  leadId: number;
  target: RegenerateTarget;
  /** The artifact's name, for the accessible label. */
  artifactTitle: string;
  /** True when this artifact's instruction is mandatory (the brief's is). */
  requireNote?: boolean;
  /** The field's placeholder — keep it specific; the brief's is the model. */
  placeholder: string;
  /** What happens as a consequence, said on the control rather than discovered. */
  consequence: string;
};

const FIELD = 'mt-1.5 w-full resize-y rounded-lg bg-surface-soft px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30';

export function ArtifactRegenerateControl(props: ArtifactRegenerateControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const armed = (!props.requireNote || note.trim().length > 0) && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setVoiceError(null);
    try {
      const res = await fetch(`/api/v1/personalization/leads/${props.leadId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: props.target, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? `Regenerate failed (${res.status})`);
        return;
      }
      // The voice gate rejected the rewrite twice and kept the old copy. Say
      // so — a silent no-op after a click is the dead end this fixes.
      if (typeof body?.voiceError === 'string' && body.voiceError) {
        setVoiceError(body.voiceError);
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
        data-testid={`regenerate-${props.target}`}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Regenerate
      </button>
    );
  }

  return (
    <div className="border-t border-rule pt-3" data-testid={`regenerate-${props.target}-open`}>
      <label className="block">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {props.requireNote ? 'What should the next version do differently?' : 'What should change? (optional)'}
        </span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          aria-label={`Regenerate instruction for ${props.artifactTitle}`}
          placeholder={props.placeholder}
          className={FIELD}
        />
      </label>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {props.consequence}
        {' '}
        Your instruction becomes this version's change summary, so the history says which note produced which draft.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {voiceError && (
        <div className="mt-2 flex items-start gap-2.5 border-l-2 border-brand-fail py-1 pl-3 text-sm" data-testid="voice-gate-rejected">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-fail" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-brand-fail">The rewrite was rejected by the workspace's voice rules</p>
            <p className="mt-0.5 text-[13px] whitespace-pre-line text-muted-foreground">{voiceError}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Nothing changed. Say what you want differently and try again.</p>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setVoiceError(null);
          }}
          className="h-9 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!armed}
          onClick={submit}
          className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg bg-action px-3 text-sm text-action-foreground transition hover:opacity-90 disabled:opacity-40')}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {submitting ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
}
