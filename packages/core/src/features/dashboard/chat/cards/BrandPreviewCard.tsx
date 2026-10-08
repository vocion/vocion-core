'use client';

import type { RecommendedAction } from '../types';
import type { OrgBrandFields } from '@/libs/branding/orgBrand';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BrandPreview } from '@/features/branding/BrandPreview';
import { alreadySettled, useSingleFlight } from '@/features/review/decideOnce';
import { cardDedupKey } from '@/libs/actions/cardDedupKey';
import { previewViewOf } from '@/libs/branding/orgBrand';
import { BRAND_CARD_KIND } from '@/libs/cards/card';
import { redactInternalIds } from '@/libs/chat/redact';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { useActionRunStatus } from '../useActionRunStatus';
import { useRecordCardDecision } from './CardDecisions';
import { SETUP_CHANGED_EVENT } from './SetupCard';

/**
 * "MAKE IT YOURS" — a drafted brand, decided in one move.
 *
 * The workspace lead's `propose_brand` reads the company's logo, colours and
 * fonts off its own site and puts the draft here: the app's sidebar and
 * sign-in page wearing it, then three typed choices.
 *
 *   1. **Use this brand** — preselected. Proposed as the person through the
 *      action registry (`review.actAsPerson`, `org.brand_apply`), so it runs
 *      within their authority, with Undo; the card announces the change
 *      (`SETUP_CHANGED_EVENT`), the shell re-reads (`AppSidebar`), and the app
 *      is in the brand at once.
 *   2. **Adjust** — Brand settings, with the draft in it (the card's `href`).
 *   3. **Skip** — set aside; the card remembers it (`recordCardDecision`
 *      with `turn: false`), so a reload draws "Skipped", not the choices.
 *
 * Keyboard first: 1 / 2 / 3 pick, ↑ ↓ move, Enter takes the highlighted one,
 * Esc skips. The card takes focus when it lands, unless the person is
 * already typing.
 *
 * A typed card with its own renderer, so the decisions work can wrap it as
 * an objective with a progress line later without changing it.
 */

/**
 * Whether this card is a drafted brand.
 * @param rec - The card as the chat holds it.
 */
export function isBrandCard(rec: RecommendedAction): boolean {
  return rec.kind === BRAND_CARD_KIND && Boolean(rec.actionId);
}

/**
 * The draft a card carries, as brand fields.
 * @param input - The card's action input.
 */
export function draftFieldsOf(input: Record<string, unknown>): OrgBrandFields {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const logos = (input.logos && typeof input.logos === 'object' ? input.logos : {}) as Record<string, unknown>;
  return {
    name: str(input.name) ?? '',
    accent: str(input.accent),
    headingFont: str(input.headingFont),
    senderName: str(input.senderName),
    logos: Object.fromEntries(Object.entries(logos).filter(([, v]) => typeof v === 'string' && v)) as OrgBrandFields['logos'],
    website: str(input.website),
  };
}

type Choice = 'use' | 'adjust' | 'skip';
const CHOICES: readonly Choice[] = ['use', 'adjust', 'skip'];

/**
 * The brand preview card.
 * @param props - The card.
 * @param props.rec - The card as the chat holds it.
 * @param props.previewTheme - Draw the preview in this theme (stories); the app's own otherwise.
 */
export function BrandPreviewCard({ rec, previewTheme }: { rec: RecommendedAction; previewTheme?: 'light' | 'dark' }) {
  const t = useTranslations('Brand');
  const { resolvedTheme } = useTheme();
  const theme = previewTheme ?? (resolvedTheme === 'dark' ? 'dark' : 'light');
  const fields = useMemo(() => draftFieldsOf(rec.input), [rec.input]);
  const view = useMemo(() => previewViewOf(fields), [fields]);
  const [runId, setRunId] = useState<number | undefined>(rec.runId);
  const [skipped, setSkipped] = useState(rec.decision?.action === 'reject' && rec.runId === undefined);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<'run' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const live = useActionRunStatus(runId, nonce);
  const once = useSingleFlight();
  const recordDecision = useRecordCardDecision();
  const radios = useRef<Array<HTMLElement | null>>([]);

  // A card reloaded with its run, or filed after it was drawn, follows that run.
  useEffect(() => {
    if (rec.runId !== undefined && runId === undefined) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- adopting a run id the server sent after the card
      setRunId(rec.runId);
    }
  }, [rec.runId, runId]);

  const status = live?.status;
  const done = status === 'done';
  const undone = status === 'undone';
  const failed = status === 'failed' || status === 'rejected';
  const working = busy === 'run' || status === 'pending' || status === 'executing';
  const open = runId === undefined && !skipped;

  // Applied or undone: the shell re-reads on this event (`AppSidebar`), so
  // the app wears the brand (or stops) at once, and the checklist counts
  // "Make it yours". A card reloaded on a run that already landed says nothing.
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if ((status === 'done' || status === 'undone') && seen.current !== status) {
      if (seen.current !== undefined || rec.runId === undefined) {
        window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
      }
      seen.current = status;
    }
  }, [status, rec.runId]);

  // Keyboard first: the preselected choice takes focus when the card lands,
  // unless the person is in the middle of typing something.
  useEffect(() => {
    if (!open) {
      return;
    }
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const typing = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable) && Boolean((active as HTMLInputElement).value);
    if (!typing) {
      radios.current[0]?.focus({ preventScroll: true });
    }
    // Only when the card first lands.
  }, []);

  const apply = () => once(async () => {
    setBusy('run');
    setError(null);
    try {
      let id = failed ? undefined : runId;
      let state = failed ? undefined : status;
      if (id === undefined) {
        // The press is the person's decision: proposed as them, it runs within
        // their authority, with Undo (`review.actAsPerson`).
        const res = await client.review.actAsPerson({
          actionId: rec.actionId,
          input: rec.input,
          agentSlug: rec.agentSlug,
          rationale: rec.body,
          dedupKey: cardDedupKey({ actionId: rec.actionId, label: rec.label, input: rec.input }),
        }) as { runId: number; status: string; error?: string };
        id = res.runId;
        state = res.status;
        setRunId(id);
        if (res.status === 'failed' && res.error) {
          setError(redactInternalIds(res.error));
        }
      }
      if (state === 'pending') {
        const decided = await client.review.decideAction({ id, decision: 'approve' }) as { status?: string; error?: string } | undefined;
        if (decided?.status === 'failed' && decided.error) {
          setError(redactInternalIds(decided.error));
        }
      }
      if (rec.id) {
        recordDecision({ cardId: rec.id, label: rec.label, action: 'approve', runId: id, turn: false });
      }
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (!alreadySettled(message, 'approve')) {
        setError(redactInternalIds(message) || t('failed'));
      }
    } finally {
      setBusy(null);
      setNonce(n => n + 1);
    }
  });

  const undo = () => once(async () => {
    if (runId === undefined) {
      return;
    }
    setBusy('undo');
    setError(null);
    try {
      await client.review.undoAction({ id: runId });
    } catch (err) {
      setError(redactInternalIds((err as Error)?.message ?? '') || t('failed'));
    } finally {
      setBusy(null);
      setNonce(n => n + 1);
    }
  });

  // "Adjust" is a link (Brand settings, with the draft): 2 follows it.
  const adjust = () => radios.current[1]?.click();

  const skip = () => {
    setSkipped(true);
    if (rec.id) {
      recordDecision({ cardId: rec.id, label: rec.label, action: 'reject', turn: false });
    }
  };

  const take = (choice: Choice) => {
    if (choice === 'use') {
      void apply();
    } else if (choice === 'adjust') {
      adjust();
    } else {
      skip();
    }
  };

  const move = (to: number) => {
    setSelected(to);
    radios.current[to]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open || working || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    const n = ['1', '2', '3'].indexOf(e.key);
    if (n >= 0) {
      e.preventDefault();
      setSelected(n);
      take(CHOICES[n]!);
    } else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : CHOICES.length - 1;
      move((selected + step) % CHOICES.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      take(CHOICES[selected]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSelected(2);
      skip();
    }
  };

  const notes = (rec.fields ?? []).map(f => f.value);
  const label = (c: Choice) => t(`choice_${c}`);
  const hint = (c: Choice) => t(`choice_${c}_hint`);

  return (
    <div
      role="group"
      aria-label={rec.label}
      data-testid="brand-card"
      data-state={done ? 'applied' : undone ? 'undone' : skipped ? 'skipped' : failed ? 'failed' : runId !== undefined ? 'running' : 'proposed'}
      className="mt-3 min-w-0 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{t('eyebrow')}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold break-words">
            {done && <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
            <span className={undone || skipped ? 'text-muted-foreground' : undefined}>{rec.label}</span>
          </div>
          {rec.body && <p className="mt-0.5 text-xs break-words text-muted-foreground">{rec.body}</p>}
        </div>
      </div>

      <BrandPreview brand={view} theme={theme} className="mt-2.5" />

      {notes.length > 0 && open && (
        <ul className="mt-2 space-y-0.5 px-0.5 text-[11px] text-muted-foreground" data-testid="brand-card-notes">
          {notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}

      {open && (
        <>
          {/* A radio group with a roving focus: arrows move, 1 / 2 / 3 and
              Enter take a choice, Esc skips. */}
          <div role="radiogroup" aria-label={t('choices_label')} tabIndex={-1} onKeyDown={onKeyDown} className="mt-3 grid gap-1.5 outline-none sm:grid-cols-3">
            {CHOICES.map((c, i) => {
              const props = {
                'ref': (el: HTMLElement | null) => {
                  radios.current[i] = el;
                },
                'role': 'radio' as const,
                'aria-checked': selected === i,
                'tabIndex': selected === i ? 0 : -1,
                'data-testid': `brand-card-${c}`,
                'onMouseEnter': () => setSelected(i),
                'className': cn(
                  'flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-60',
                  selected === i ? 'border-foreground/30 bg-surface-hover' : 'border-border hover:bg-surface-hover',
                ),
              };
              const body = (
                <>
                  <kbd className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded border border-border font-mono text-[10px] text-muted-foreground">{i + 1}</kbd>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                      {c === 'use' && working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                      {label(c)}
                    </span>
                    {c === 'use' && <span className="mt-0.5 inline-block rounded bg-surface-soft px-1 text-[10px] font-medium text-muted-foreground">{t('recommended')}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint(c)}</span>
                  </span>
                </>
              );
              // Adjust is where the draft is edited: a link, followed by a
              // click, by 2, or by Enter while it is the highlighted one.
              return c === 'adjust'
                ? <Link key={c} href={rec.href ?? '/dashboard/brand'} {...props} aria-disabled={working || undefined} onClick={() => setSelected(i)}>{body}</Link>
                : (
                    <button
                      key={c}
                      type="button"
                      {...props}
                      aria-disabled={working || undefined}
                      onClick={() => {
                        setSelected(i);
                        take(c);
                      }}
                    >
                      {body}
                    </button>
                  );
            })}
          </div>
          <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground/80">{t('keys_hint')}</p>
        </>
      )}

      {!open && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-xs">
          {done && <span className="font-medium text-emerald-700 dark:text-emerald-400" data-testid="brand-card-applied">{t('applied')}</span>}
          {undone && <span className="text-muted-foreground">{t('undone')}</span>}
          {skipped && <span className="text-muted-foreground">{t('skipped')}</span>}
          {working && !done && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('applying')}
            </span>
          )}
          {done && live?.undoable && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy !== null}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
              data-testid="brand-card-undo"
            >
              {busy === 'undo' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              {t('undo')}
            </button>
          )}
          {failed && (
            <button type="button" onClick={() => void apply()} className="font-medium text-foreground underline underline-offset-2" data-testid="brand-card-retry">{t('try_again')}</button>
          )}
          <Link href={rec.href ?? '/dashboard/brand'} className="font-medium text-primary hover:underline" data-testid="brand-card-settings">{t('open_settings')}</Link>
        </div>
      )}

      {(error || failed) && (
        <p className="mt-1.5 px-0.5 text-xs break-words text-brand-fail" role="alert">{error ?? t('failed')}</p>
      )}
    </div>
  );
}
