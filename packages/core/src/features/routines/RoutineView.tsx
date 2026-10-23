'use client';

/**
 * A ROUTINE — on its own page, and in the preview pane beside the
 * conversation that taught it (`compact`). Top to bottom, in the order its
 * expert works through it:
 *
 *   header     name, trust, where it stands, its expert, the version, the recording
 *   teaching   while Vocion waits for or reads the recording: where it is, and the
 *              way back to the site and the recorder (in place of the spec)
 *   questions  what one example could not settle, each with an answer box
 *   run it     rows pasted as CSV, TSV or JSON → a batch, one browser run per row
 *   spec       the steps, rules, escalations, never-dos, inputs, outputs and writes,
 *              each linked to its moment on the recording
 *   trust      the ladder, Drafted → Approved → Autonomous
 *   batches    the recent ones, each a door to its queue
 *   versions   and the workflow.yaml runs compile to
 *
 * Re-read every 3s while teaching, and whenever the live stream says the
 * routine changed (`routine:<id>`).
 */

import type { RoutineBatchSummary } from '@/libs/routines/display';
import type { RoutineView as Routine, RoutineInputSpec, RoutineQuestion, RoutineTrust, RoutineVersionView } from '@/libs/routines/types';
import { Check, CircleDot, ExternalLink, FileCode2, KeyRound, LayoutGrid, Lock, Play, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailMeta, DetailPage, StatusDot } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SparkOrb } from '@/components/ui/spark-orb';
import { openPreview } from '@/features/preview/previewState';
import { useLive } from '@/hooks/useLive';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { ago, batchProgress, exampleRows, needsYou, parseRows, routineStatusWord, TEACHING_WORD, TRUST_HINT } from '@/libs/routines/display';
import { batchLabel, ROUTINE_TRUST, TRUST_LABEL } from '@/libs/routines/types';
import { cn } from '@/utils/Helpers';
import { isPracticeRoutine, PracticeRoutineButton } from './PracticeRoutineButton';
import { MomentLink, ToneChip, TrustChip } from './RoutineChips';
import { Part } from './RoutineParts';
import { RoutineSpecView } from './RoutineSpecView';

const DOT = { pass: 'pass', amber: 'amber', fail: 'fail', neutral: 'neutral', teal: 'neutral' } as const;

type Act = { action: 'approve' | 'trust' | 'answer_question' | 'retire' | 'attach_recording'; trust?: RoutineTrust; questionId?: string; answer?: string };

/**
 * The version waiting on its expert: a draft beside the approved one, or the first version while it is a draft.
 * @param r
 */
function pendingVersion(r: Routine): RoutineVersionView | null {
  return r.draft ?? (r.version?.status === 'draft' ? r.version : null);
}

function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

export function RoutineView({ initial, batches: initialBatches = [], compact = false }: { initial: Routine; batches?: RoutineBatchSummary[]; compact?: boolean }) {
  const [routine, setRoutine] = useState<Routine>(initial);
  const [batches, setBatches] = useState<RoutineBatchSummary[]>(initialBatches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teaching = Boolean(routine.teaching) || routine.status === 'teaching';
  const now = useNow(teaching, 5000);

  const reload = useCallback(async () => {
    const res = await client.routines.get({ id: routine.id }).catch(() => null);
    if (res?.routine) {
      setRoutine(res.routine);
      setBatches(res.batches);
    }
  }, [routine.id]);

  // Teaching: Vocion is waiting for the recording or reading it; look again every 3s.
  useEffect(() => {
    if (!teaching) {
      return;
    }
    const t = setInterval(() => {
      if (!document.hidden) {
        void reload();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [teaching, reload]);

  // Anything else that moves it — an answer in chat, an approval elsewhere — arrives on the stream.
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive([`routine:${routine.id}`], () => {
    if (soon.current) {
      return;
    }
    soon.current = setTimeout(() => {
      soon.current = null;
      void reload();
    }, 250);
  });

  const act = useCallback(async (body: Act): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.routines.act({ id: routine.id, ...body });
      if (res.routine) {
        setRoutine(res.routine);
      }
      if (res.error) {
        setError(res.error);
        return false;
      }
      return true;
    } catch {
      setError('That did not go through.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [routine.id]);

  const pending = pendingVersion(routine);
  const shown = pending ?? routine.version;
  const word = routineStatusWord(routine);
  const source = routine.source;
  const expert = routine.expert?.name ?? null;
  const questions = shown?.spec.questions ?? [];
  const open = questions.filter(q => !q.answer).length;

  const approve = pending && routine.status !== 'retired' && !teaching && (
    <Button size="sm" disabled={busy} onClick={() => void act({ action: 'approve' })} data-routine-approve>
      <Check className="size-3.5" aria-hidden />
      {`Approve version ${pending.n}`}
    </Button>
  );

  const meta = (
    <DetailMeta
      items={[
        <TrustChip key="trust" trust={routine.trust} />,
        <StatusDot key="status" tone={DOT[word.tone]} pulse={word.pulse} label={<span className="text-foreground">{word.word}</span>} />,
        expert ? `Expert: ${expert}` : 'No expert yet',
        routine.version ? `Version ${routine.version.n}${pending && pending.n !== routine.version.n ? ` · v${pending.n} in review` : ''}` : null,
        source && (
          <a key="source" href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground" data-routine-source>
            <Video className="size-3" aria-hidden />
            {`Taught from ${source.title ?? 'the recording'}`}
          </a>
        ),
      ]}
    />
  );

  const main = (
    <>
      {error && <p className="mt-3 rounded-lg border border-brand-fail/30 bg-brand-fail-bg px-3 py-2 text-[13px] text-brand-fail" role="alert">{error}</p>}
      {teaching
        ? <TeachingPanel routine={routine} now={now} compact={compact} busy={busy} onAttach={link => act({ action: 'attach_recording', answer: link })} />
        : routine.error && <p className="mt-4 text-[13px] text-brand-fail">{routine.error}</p>}
      {!teaching && pending && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-waiting-soft px-3 py-2.5" data-routine-review>
          <p className="min-w-0 flex-1 text-[13px] text-foreground">
            {`Version ${pending.n} is drafted and waits for ${expert ?? 'its expert'}.`}
            {open > 0 && <span className="text-muted-foreground">{` ${open} open question${open === 1 ? '' : 's'} below.`}</span>}
          </p>
          {compact && approve}
        </div>
      )}
      {!teaching && open > 0 && (
        <Part compact={compact} eyebrow={`Open questions · ${open} of ${questions.length}`} testId="routine-questions">
          <Questions questions={questions} sourceUrl={source?.url ?? null} busy={busy} onAnswer={(questionId, answer) => act({ action: 'answer_question', questionId, answer })} />
        </Part>
      )}
      {!teaching && routine.version && routine.status === 'live' && (
        <Part compact={compact} eyebrow="Run it" testId="routine-run">
          {isPracticeRoutine(routine.name) && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-surface-soft px-3 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">The practice console has a 20-person roster ready to run.</p>
              <PracticeRoutineButton run compact={compact} variant="default" />
            </div>
          )}
          <RunForm routine={routine} compact={compact} />
        </Part>
      )}
      {!teaching && shown && (
        <Part compact={compact} eyebrow={`What it does · version ${shown.n}${shown.status === 'draft' ? ' · draft' : ''}`} testId="routine-spec">
          <RoutineSpecView spec={shown.spec} sourceUrl={source?.url ?? null} expert={expert} />
        </Part>
      )}
      {!teaching && open === 0 && questions.length > 0 && (
        <Part compact={compact} eyebrow={`Questions · ${questions.length} answered`} testId="routine-questions">
          <Questions questions={questions} sourceUrl={source?.url ?? null} busy={busy} onAnswer={(questionId, answer) => act({ action: 'answer_question', questionId, answer })} />
        </Part>
      )}
      {!teaching && routine.version && routine.status !== 'live' && routine.status !== 'retired' && (
        <Part compact={compact} eyebrow="Run it" testId="routine-run">
          {isPracticeRoutine(routine.name) && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-surface-soft px-3 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">The practice console has a 20-person roster ready to run.</p>
              <PracticeRoutineButton run compact={compact} variant="default" />
            </div>
          )}
          <RunForm routine={routine} compact={compact} />
        </Part>
      )}
    </>
  );

  const side = (
    <>
      {!teaching && routine.status !== 'retired' && (
        <Part compact={compact} eyebrow="Trust" testId="routine-trust">
          <TrustControl trust={routine.trust} busy={busy} onPick={t => void act({ action: 'trust', trust: t })} />
        </Part>
      )}
      {batches.length > 0 && (
        <Part compact={compact} eyebrow={`Batches · ${batches.length}`} testId="routine-batches">
          <BatchList batches={batches} compact={compact} now={now} />
        </Part>
      )}
      {!teaching && routine.versions.length > 0 && (
        <Part compact={compact} eyebrow="Versions" testId="routine-versions">
          <ul className="space-y-2">
            {routine.versions.map(v => (
              <li key={v.n} className="flex items-start gap-2 text-[13px]">
                <span className="w-7 shrink-0 font-medium text-foreground tabular-nums">{`v${v.n}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{v.change ?? 'First version, drafted from the recording.'}</span>
                  <span className="block text-[11px] text-muted-foreground">{new Date(v.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </span>
                <ToneChip tone={v.status === 'approved' ? 'pass' : v.status === 'draft' ? 'amber' : 'neutral'}>{v.status === 'superseded' ? 'Replaced' : v.status === 'approved' ? 'Approved' : 'Draft'}</ToneChip>
              </li>
            ))}
          </ul>
          {shown?.workflowYaml && (
            <details className="mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                <FileCode2 className="size-3.5" aria-hidden />
                workflow.yaml
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-surface-soft p-3 font-mono text-[11px] leading-relaxed text-foreground" data-routine-yaml>{shown.workflowYaml}</pre>
            </details>
          )}
        </Part>
      )}
      {!teaching && routine.status !== 'retired' && (
        <Part compact={compact} eyebrow="Retire" testId="routine-retire">
          <Retire busy={busy} onRetire={() => void act({ action: 'retire' })} />
        </Part>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="text-sm" data-routine={routine.id} data-routine-status={routine.status}>
        {/* The pane's header already names it. */}
        {routine.description && <p className="text-[13px] leading-relaxed text-muted-foreground">{routine.description}</p>}
        {meta}
        {main}
        {side}
      </div>
    );
  }
  return (
    <div data-routine={routine.id} data-routine-status={routine.status}>
      <DetailPage
        crumbs={[{ label: 'Routines', href: '/dashboard/routines' }, { label: routine.name }]}
        title={routine.name}
        subtitle={routine.description ?? undefined}
        meta={meta}
        actions={approve || undefined}
        aside={teaching ? undefined : <aside aria-label="How it runs" className="min-w-0 @3xl:border-l @3xl:border-rule @3xl:pl-8">{side}</aside>}
      >
        {main}
      </DetailPage>
    </div>
  );
}

/* ── Teaching ──────────────────────────────────────────────────────────── */

const TEACH_STEPS = [
  { state: 'waiting_for_recording', label: 'Record' },
  { state: 'reading', label: 'Read' },
  { state: 'drafting', label: 'Draft' },
] as const;

const TEACH_LINE: Record<string, string> = {
  waiting_for_recording: 'Record the task in Slate on the site you opened, saying what you are doing and why at each step, then stop. Vocion picks the recording up on its own.',
  reading: 'Vocion is watching the recording and reading what you said at each step.',
  drafting: 'Writing the steps, rules, escalation points and open questions, each linked to its moment on the recording.',
};

function TeachingPanel({ routine, now, compact, busy, onAttach }: { routine: Routine; now: number; compact: boolean; busy: boolean; onAttach: (link: string) => Promise<boolean> }) {
  const t = routine.teaching;
  const state = t?.state ?? 'reading';
  const failed = state === 'failed';
  const [link, setLink] = useState('');
  const at = TEACH_STEPS.findIndex(s => s.state === state);
  return (
    <section className={cn('mt-5 rounded-xl border p-4 sm:p-5', failed ? 'border-brand-fail/30 bg-brand-fail-bg/40' : state === 'waiting_for_recording' ? 'border-transparent bg-waiting-soft' : 'border-transparent bg-surface-soft')} data-routine-teaching={state}>
      <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Teaching</p>
      <div className="mt-2 flex items-center gap-2">
        {/* Design sweep, 2026-10-23: the agent working is the spark; a wait on a person is amber. */}
        {!failed && (state === 'waiting_for_recording'
          ? <span className="size-2 shrink-0 rounded-full bg-waiting" aria-hidden />
          : <SparkOrb working className="shrink-0" />)}
        <h2 className={cn('text-[17px] leading-snug font-semibold', failed ? 'text-brand-fail' : 'text-foreground')}>
          {TEACHING_WORD[state]}
          {!failed && state !== 'waiting_for_recording' && '…'}
        </h2>
      </div>
      <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{failed ? (routine.error ?? 'Teaching stopped before a spec was drafted.') : TEACH_LINE[state]}</p>
      {state === 'waiting_for_recording' && t?.instruction && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5" data-routine-teaching-instruction>
          <Video className="mt-0.5 size-4 shrink-0 text-waiting" aria-hidden />
          <p className="text-[13px] leading-relaxed text-foreground">{t.instruction}</p>
        </div>
      )}

      {!failed && (
        <ol className="mt-4 flex items-center gap-2" aria-label="Teaching steps">
          {TEACH_STEPS.map((s, i) => (
            <li key={s.state} className="flex items-center gap-2">
              {i > 0 && <span className={cn('h-px w-6 sm:w-10', i <= at ? 'bg-foreground/40' : 'bg-border')} aria-hidden />}
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px]', i < at ? 'text-foreground' : i === at ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground')}>
                {i < at ? <Check className="size-3 text-brand-pass" aria-hidden /> : <CircleDot className={cn('size-3', i === at ? 'text-foreground' : 'text-muted-foreground/60')} aria-hidden />}
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}

      {t && (
        <p className="mt-3 text-[12px] text-muted-foreground" data-routine-teaching-checks={t.checks}>
          {`Started ${ago(t.startedAt, now)}`}
          {state === 'waiting_for_recording' && t.checks > 0 && ` · looked for it ${t.checks} time${t.checks === 1 ? '' : 's'}${t.lastCheckedAt ? `, last ${ago(t.lastCheckedAt, now)}` : ''}`}
        </p>
      )}

      {state === 'waiting_for_recording' && (t?.targetUrl || t?.recordUrl) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {t?.targetUrl && (
            <Button size="sm" variant="outline" onClick={() => window.open(t.targetUrl!, '_blank', 'noopener')} data-routine-open-site>
              <ExternalLink className="size-3.5" aria-hidden />
              Open the site again
            </Button>
          )}
          {t?.recordUrl && (
            <a href={t.recordUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground" data-routine-open-recorder>
              Record in the browser instead
            </a>
          )}
        </div>
      )}

      {(state === 'waiting_for_recording' || failed) && (
        <form
          className={cn('mt-4 flex gap-2 border-t border-rule pt-4', compact ? 'flex-col' : 'flex-col sm:flex-row sm:items-center')}
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) {
              void onAttach(link.trim()).then(ok => ok && setLink(''));
            }
          }}
          data-routine-attach
        >
          <label htmlFor={`slate-link-${routine.id}`} className="shrink-0 text-[13px] text-muted-foreground">Or paste a Slate link</label>
          <Input id={`slate-link-${routine.id}`} value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" inputMode="url" className="min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !link.trim()}>Use this recording</Button>
        </form>
      )}
    </section>
  );
}

/* ── Open questions ────────────────────────────────────────────────────── */

/**
 * A user id rather than a name: never shown as who answered.
 * @param s
 */
function looksLikeId(s: string): boolean {
  return /^(?:usr|user)[-_]|^[\da-f-]{20,}$/i.test(s);
}

function Questions({ questions, sourceUrl, busy, onAnswer }: { questions: RoutineQuestion[]; sourceUrl: string | null; busy: boolean; onAnswer: (id: string, answer: string) => Promise<boolean> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Unanswered first; each keeps its place within its group.
  const ordered = useMemo(() => [...questions.filter(q => !q.answer), ...questions.filter(q => q.answer)], [questions]);
  return (
    <ul className="space-y-3">
      {ordered.map(q => (
        <li key={q.id} className={cn('rounded-lg border px-3 py-2.5', q.answer ? 'border-border/60' : 'border-transparent bg-waiting-soft')} data-routine-question={q.id} data-answered={q.answer ? 'true' : undefined}>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">{q.question}</p>
            <MomentLink url={sourceUrl} at={q.at} />
          </div>
          {q.why && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{q.why}</p>}
          {q.answer
            ? (
                <p className="mt-2 flex items-start gap-1.5 text-[13px] text-foreground">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-brand-pass" aria-hidden />
                  <span>
                    {q.answer}
                    {q.answeredBy && !looksLikeId(q.answeredBy) && <span className="text-muted-foreground">{` — ${q.answeredBy}`}</span>}
                  </span>
                </p>
              )
            : (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = drafts[q.id]?.trim();
                    if (text) {
                      void onAnswer(q.id, text).then(ok => ok && setDrafts(d => ({ ...d, [q.id]: '' })));
                    }
                  }}
                >
                  <Input value={drafts[q.id] ?? ''} onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))} placeholder="Your answer" aria-label={`Answer: ${q.question}`} className="h-8 min-w-0 flex-1 bg-background" />
                  <Button type="submit" size="sm" disabled={busy || !drafts[q.id]?.trim()}>Answer</Button>
                </form>
              )}
        </li>
      ))}
    </ul>
  );
}

/* ── Run it ────────────────────────────────────────────────────────────── */

function RunForm({ routine, compact }: { routine: Routine; compact: boolean }) {
  const router = useRouter();
  const inputs: RoutineInputSpec[] = routine.version?.spec.inputs ?? [];
  const plain = inputs.filter(i => !i.secret);
  const secrets = inputs.filter(i => i.secret);
  const example = exampleRows(inputs);
  const [text, setText] = useState('');
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the expert saved on the routine (the sign-in, the campaign) needs no typing again.
  const saved = new Set(routine.savedInputs);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseRows(text, inputs);
  // Inputs the rows do not carry are the same for every row: asked once, beside the secrets.
  const sharedInputs = [...(parsed.rows.length > 0 ? plain.filter(i => !parsed.columns.includes(i.name)) : []), ...secrets];
  const missingShared = sharedInputs.filter(s => !secretValues[s.name]?.trim() && !saved.has(s.name));
  const ready = parsed.rows.length > 0 && !parsed.error && missingShared.length === 0;

  const run = async () => {
    if (!ready) {
      return;
    }
    setBusy(true);
    setError(null);
    const shared = Object.fromEntries(sharedInputs.filter(s => secretValues[s.name]?.trim()).map(s => [s.name, secretValues[s.name]!.trim()]));
    const res = await client.routines.run({ id: routine.id, rows: parsed.rows, ...(Object.keys(shared).length > 0 ? { shared, remember } : {}) }).catch(() => ({ batch: null, error: 'That did not go through.' }));
    setBusy(false);
    if (!res.batch) {
      setError(res.error ?? 'It did not start.');
      return;
    }
    if (compact) {
      openPreview({ type: 'routine_batch', id: String(res.batch.id) }, null);
    } else {
      router.push(`/dashboard/routines/batches/${res.batch.id}`);
    }
  };

  return (
    <div className="space-y-3" data-routine-run-form>
      <p className="text-[13px] text-muted-foreground">
        Paste one row per run — CSV or TSV with a header line, or a JSON array. Each row runs in its own browser, at once.
        {routine.trust === 'drafted' && ' At Drafted trust every consequential click waits for you.'}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-muted-foreground">Columns</span>
        {plain.map(i => (
          <code key={i.name} className="inline-flex items-center gap-1 rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[11px] text-foreground" title={i.description}>
            {i.name}
            {i.key && <KeyRound className="size-2.5 text-muted-foreground" aria-label="part of the dedupe key" />}
          </code>
        ))}
        {example.includes('\n') && (
          <button type="button" onClick={() => setText(example)} className="ml-1 text-[12px] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">Use the example</button>
        )}
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={compact ? 5 : 6}
        spellCheck={false}
        placeholder={example}
        aria-label="Rows to run"
        className="w-full resize-y rounded-lg bg-surface-soft px-3 py-2 font-mono text-[12px] leading-relaxed outline-hidden placeholder:text-muted-foreground/60 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-foreground/10"
        data-routine-rows
      />
      {sharedInputs.length > 0 && (
        <div className="space-y-2" data-routine-shared>
          {sharedInputs.some(i => !i.secret) && <p className="text-[12px] text-muted-foreground">Not in the rows, so the same for every row:</p>}
          {sharedInputs.map(s => (
            <div key={s.name} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor={`shared-${routine.id}-${s.name}`} className="flex w-40 shrink-0 items-center gap-1.5 text-[13px] text-foreground" title={s.description}>
                {s.secret && <Lock className="size-3.5 text-muted-foreground" aria-hidden />}
                <span className="truncate font-mono text-[12px]">{s.name}</span>
              </label>
              <Input
                id={`shared-${routine.id}-${s.name}`}
                type={s.secret ? 'password' : 'text'}
                autoComplete="off"
                value={secretValues[s.name] ?? ''}
                onChange={e => setSecretValues(v => ({ ...v, [s.name]: e.target.value }))}
                placeholder={saved.has(s.name) ? 'Saved for this routine' : s.secret ? 'Used for every row; never shown to the model' : (s.example ?? s.description)}
                className="h-8 min-w-0 flex-1"
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="size-3.5" data-routine-remember />
            Remember these for this routine, sealed, so a batch asked for in chat needs no password
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!ready || busy} onClick={() => void run()} data-routine-run>
          <Play className="size-3.5" aria-hidden />
          {busy ? 'Starting…' : parsed.rows.length > 0 ? `Run for ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}` : 'Run'}
        </Button>
        <span className={cn('text-[12px]', parsed.error || error ? 'text-brand-fail' : 'text-muted-foreground')} role={parsed.error || error ? 'alert' : undefined}>
          {error ?? parsed.error ?? (parsed.rows.length > 0 ? (missingShared.length > 0 ? `${parsed.rows.length} ready · add ${missingShared.map(s => s.name).join(', ')}` : `${parsed.rows.length} ready`) : '')}
        </span>
      </div>
    </div>
  );
}

/* ── Trust ─────────────────────────────────────────────────────────────── */

function TrustControl({ trust, busy, onPick }: { trust: RoutineTrust; busy: boolean; onPick: (t: RoutineTrust) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div>
      <div role="radiogroup" aria-label="Trust level" className="flex rounded-lg bg-surface-soft p-0.5" data-routine-trust-control>
        {ROUTINE_TRUST.map((t, i) => {
          const checked = t === trust;
          return (
            <button
              key={t}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={busy}
              onClick={() => !checked && onPick(t)}
              onKeyDown={(e) => {
                const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % 3 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + 2) % 3 : null;
                if (next !== null) {
                  e.preventDefault();
                  refs.current[next]?.focus();
                }
              }}
              className={cn('h-7 flex-1 rounded-md px-2 text-[12px] font-medium transition-colors disabled:opacity-60', checked ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              data-trust={t}
            >
              {TRUST_LABEL[t]}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{TRUST_HINT[trust]}</p>
    </div>
  );
}

/* ── Batches ───────────────────────────────────────────────────────────── */

function BatchList({ batches, compact, now }: { batches: RoutineBatchSummary[]; compact: boolean; now: number }) {
  return (
    <ul className="-mx-2">
      {batches.slice(0, 8).map((b) => {
        const wants = needsYou(b.counts);
        const body = (
          <>
            <LayoutGrid className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                {batchLabel(b.id)}
                <span className="text-[11px] font-normal text-muted-foreground">{ago(b.startedAt, now)}</span>
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{batchProgress(b.counts, b.total)}</span>
            </span>
            <StatusDot tone={wants > 0 ? 'amber' : b.status === 'running' ? 'amber' : (b.counts.failed ?? 0) > 0 ? 'fail' : 'pass'} pulse={b.status === 'running'} label={<span className="sr-only">{b.status}</span>} className="mt-1.5" />
          </>
        );
        const cls = 'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover';
        return (
          <li key={b.id} data-routine-batch={b.id}>
            {compact
              ? <button type="button" className={cls} onClick={ev => openPreview({ type: 'routine_batch', id: String(b.id) }, ev.currentTarget)}>{body}</button>
              : <Link href={`/dashboard/routines/batches/${b.id}`} className={cls}>{body}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Retire ────────────────────────────────────────────────────────────── */

function Retire({ busy, onRetire }: { busy: boolean; onRetire: () => void }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <div>
        <p className="text-[12px] text-muted-foreground">Kept with its history and receipts; never run again.</p>
        <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => setSure(true)} data-routine-retire>Retire this routine</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-foreground">Retire it?</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={onRetire} data-routine-retire-confirm>Retire</Button>
      <Button size="sm" variant="ghost" onClick={() => setSure(false)}>Keep it</Button>
    </div>
  );
}
