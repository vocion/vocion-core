'use client';

import { BookOpen, Check, CheckCircle2, Circle, Loader2, MessageSquareWarning, ScanSearch, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useVisionModel } from '@/features/dashboard/VisionEngineControl';

/**
 * The photo-backed object view, side by side: the picture (pinned) on the
 * left with the model's finding regions drawn on it; on the right the
 * engines, the explanation and the findings — hover or click a finding ↔ its
 * region lights up. Per-finding Agree / Disagree with a note; a disagree opens
 * a learning candidate (see /api/v1/objects/[id]/finding-feedback).
 *
 * Analyze streams the run as NDJSON phases (references picked → Claude Vision
 * comparing → parsed → saved → classifier) and shows them as they happen,
 * including the reference photos being compared against. The Claude Vision
 * cell opens a drawer with the exact prompt, references, token usage and the
 * learning history (adopted rules applied, candidates raised).
 *
 * Boxes are `[x, y, w, h]` normalised 0–1 of the image.
 */

export type Finding = {
  region?: string;
  issue?: string;
  expected?: string;
  observed?: string;
  severity?: string;
  confidence?: number;
  box?: number[];
  feedback?: { signal: 'agree' | 'disagree'; note?: string | null; by?: string | null; at?: string };
};

type Engines = {
  claude?: { verdict: string; confidence: number | null; model?: string | null; at?: string | null } | null;
  rekognition?: { label: string; verdict: string | null; confidence: number; good: number | null; bad: number | null; at?: string | null } | null;
  agreement?: 'agree' | 'disagree' | 'one-engine' | 'none';
  hybrid_verdict?: string | null;
  hybrid_confidence?: number | null;
  hybrid_reason?: string;
} | null;

type Props = {
  objectId: number;
  title: string;
  imageUrl: string;
  verdict?: string | null;
  confidence?: number | null;
  explanation?: string | null;
  findings: Finding[];
  regionsChecked?: number | null;
  checks?: {
    reference?: { model?: string; verdict?: string; confidence?: number; at?: string; usage?: Record<string, unknown>; prompt?: { system?: string; user?: string }; learnings_applied?: Array<{ id: number; step: string; text: string }> };
    classifier?: { model_arn?: string; top?: { name: string; confidence: number } | null; at?: string };
  } | null;
  engines?: Engines;
  /** Reference photos the last check compared against (in-app URLs). */
  referenceUrls?: string[];
  /** The supplier's own label for this photo, when it is a labelled sample. Shown only after a verdict exists. */
  knownLabel?: string | null;
};

type Phase = { key: string; label: string; state: 'todo' | 'doing' | 'done' | 'fail'; detail?: string };
type History = {
  lastCheck: { at: string; model: string | null; usage: Record<string, unknown> | null } | null;
  prompt: { system?: string; user?: string } | null;
  applied: Array<{ id: number; step: string; text: string }>;
  adopted: Array<{ id: number; step: string; text: string }>;
  candidates: Array<{ id: number; status: string; ruleText: string; fromThisRecord: boolean; createdAt: string; decidedBy: string | null; decidedAt: string | null }>;
};

const pct = (n: number | undefined | null) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : null);

function engineName(model?: string | null): string {
  if (!model) {
    return 'Claude Vision';
  }
  const m = model.match(/claude-([a-z]+)-(\d)-(\d)/);
  return m ? `Claude Vision · ${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : `Claude Vision · ${model}`;
}

function initialPhases(hybrid: boolean): Phase[] {
  return [
    { key: 'references', label: 'Find verified-good references for this kit', state: 'todo' },
    { key: 'model', label: 'Claude Vision compares candidate to references', state: 'todo' },
    { key: 'parsed', label: 'Verdict and findings parsed', state: 'todo' },
    { key: 'saved', label: 'Inspection record updated', state: 'todo' },
    ...(hybrid ? [{ key: 'classifier', label: 'Rekognition classifier second opinion', state: 'todo' as const }] : []),
  ];
}

function EngineCell({ name, sub, verdict, confidence, detail, action }: { name: string; sub: string; verdict: string | null; confidence: number | null; detail: string; action?: React.ReactNode }) {
  const tone = verdict === 'pass' ? 'text-emerald-600' : verdict === 'hold' ? 'text-amber-600' : 'text-muted-foreground';
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold">{name}</div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
      <div className={`mt-1.5 text-lg font-semibold tabular-nums ${tone}`}>
        {verdict ? verdict.toUpperCase() : '—'}
        {pct(confidence) && <span className="ml-2 text-sm font-normal text-muted-foreground">{pct(confidence)}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

export function InspectionPhoto(props: Props) {
  const router = useRouter();
  const { state: model } = useVisionModel(30_000);
  const hybrid = model?.status === 'RUNNING';

  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[]>(props.findings);
  useEffect(() => {
    setFindings(props.findings);
  }, [props.findings]);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [phases, setPhases] = useState<Phase[] | null>(null);
  const [liveRefs, setLiveRefs] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<{ ms: number; verdict?: string } | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!analyzing) {
      return;
    }
    setElapsed(0);
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [analyzing]);

  useEffect(() => {
    if (!detailsOpen || history) {
      return;
    }
    fetch(`/api/v1/objects/${props.objectId}/learning-history`, { cache: 'no-store' })
      .then(async (r) => {
        const b = (await r.json()) as History & { error?: { message?: string } };
        if (!r.ok) {
          throw new Error(b.error?.message ?? `HTTP ${r.status}`);
        }
        setHistory(b);
      })
      .catch(err => setHistoryError((err as Error).message));
  }, [detailsOpen, history, props.objectId]);

  function setPhase(key: string, state: Phase['state'], detail?: string) {
    setPhases(ps => (ps ?? []).map(p => (p.key === key ? { ...p, state, detail: detail ?? p.detail } : p)));
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    setLastRun(null);
    setLiveRefs([]);
    setPhases(initialPhases(hybrid));
    setPhase('references', 'doing');
    try {
      const res = await fetch(`/api/v1/objects/${props.objectId}/analyze?classifier=1`, { method: 'POST' });
      if (!res.ok || !res.body) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(b.error?.message ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        buf += dec.decode(value ?? new Uint8Array(), { stream: !d });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          const ev = JSON.parse(line) as Record<string, unknown> & { phase: string };
          switch (ev.phase) {
            case 'references':
              setLiveRefs((ev.reference_urls as string[]) ?? []);
              setPhase('references', 'done', `${((ev.reference_keys as string[]) ?? []).length} reference photo(s) for ${String(ev.template)}`);
              setPhase('model', 'doing', `${String(ev.template)} · loading images`);
              break;
            case 'model':
              setPhase('model', 'doing', `${String(ev.model)} · ${String(ev.images)} images · ${String(ev.learnings)} learning${ev.learnings === 1 ? '' : 's'} in the prompt`);
              break;
            case 'parsed':
              setPhase('model', 'done');
              setPhase('parsed', 'done', `${String(ev.verdict).toUpperCase()} · ${pct(ev.confidence as number)} · ${String(ev.findings)} finding(s)`);
              setPhase('saved', 'doing');
              break;
            case 'saved':
              setPhase('saved', 'done', ev.inspection_id ? `record #${String(ev.inspection_id)}` : undefined);
              setPhase('classifier', 'doing');
              break;
            case 'classifier':
              if (ev.status === 'running') {
                setPhase('classifier', 'doing');
              } else if (ev.top_label) {
                const t = ev.top_label as { name: string; confidence: number };
                setPhase('classifier', 'done', `${t.name} · ${pct(t.confidence)}`);
              } else {
                setPhase('classifier', 'done', String(ev.message ?? ev.status));
              }
              break;
            case 'done':
              if (ev.ok) {
                const r = ev.reference as { verdict?: string } | undefined;
                setLastRun({ ms: Number(ev.ms), verdict: r?.verdict });
              } else {
                setPhases(ps => (ps ?? []).map(p => (p.state === 'doing' ? { ...p, state: 'fail', detail: String(ev.error) } : p)));
                setError(String(ev.error));
              }
              break;
            default:
              break;
          }
        }
      }
      setHistory(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function send(index: number, signal: 'agree' | 'disagree', text?: string) {
    setBusy(index);
    setError(null);
    try {
      const res = await fetch(`/api/v1/objects/${props.objectId}/finding-feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ index, signal, note: text || undefined }),
      });
      const body = (await res.json()) as { findings?: Finding[]; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      if (body.findings) {
        setFindings(body.findings);
      }
      setNoteFor(null);
      setNote('');
      setHistory(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const highlight = pinned ?? active;
  const analyzed = !!props.checks?.reference;
  const verdictTone = props.verdict === 'pass' ? 'text-emerald-600 border-emerald-600/40' : 'text-amber-600 border-amber-600/40';
  const refs = liveRefs.length ? liveRefs : (props.referenceUrls ?? []);
  const usage = props.checks?.reference?.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  return (
    <div className="rounded-lg border border-border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
        Photo
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition hover:bg-foreground/90 disabled:opacity-60"
        >
          {analyzing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />}
          {analyzing ? `Analyzing… ${elapsed}s` : `${analyzed ? 'Re-analyze' : 'Analyze'} · ${hybrid ? 'Claude Vision + Rekognition' : 'Claude Vision'}`}
        </button>
        {analyzed && props.verdict
          ? (
              <span className={`ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${verdictTone}`}>
                {props.verdict === 'pass' ? 'Pass' : 'Hold'}
                {pct(props.confidence) && <span className="font-normal text-muted-foreground">{`${pct(props.confidence)} verdict confidence`}</span>}
              </span>
            )
          : (
              <span className="ml-auto inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Not analyzed yet</span>
            )}
      </div>

      {phases && (
        <div className="mb-4 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            {analyzing ? <Loader2 className="size-3.5 animate-spin text-amber-600" aria-hidden /> : lastRun ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden /> : <XCircle className="size-3.5 text-red-600" aria-hidden />}
            {analyzing ? `Analysis running · ${elapsed}s` : lastRun ? `Done in ${Math.round(lastRun.ms / 1000)}s · ${String(lastRun.verdict ?? '').toUpperCase()}` : 'Analysis failed'}
          </div>
          <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {phases.map(p => (
              <li key={p.key} className="flex items-start gap-2 text-xs">
                {p.state === 'done' ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden /> : p.state === 'doing' ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-amber-600" aria-hidden /> : p.state === 'fail' ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" aria-hidden /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" aria-hidden />}
                <span className={p.state === 'todo' ? 'text-muted-foreground' : ''}>
                  {p.label}
                  {p.detail && <span className="block font-mono text-[11px] text-muted-foreground">{p.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="relative overflow-hidden rounded-md border border-border bg-muted/30" onMouseLeave={() => setActive(null)}>
            <img src={props.imageUrl} alt={props.title} className="block w-full select-none" draggable={false} />
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
              {findings.map((f, i) => {
                if (!f.box || f.box.length !== 4) {
                  return null;
                }
                const [x, y, w, h] = f.box.map(v => Math.max(0, Math.min(1, v))) as [number, number, number, number];
                const on = highlight === i;
                const dim = highlight !== null && !on;
                return (
                  <g key={`${f.region}-${i}`} opacity={dim ? 0.25 : 1}>
                    <rect x={x * 1000} y={y * 1000} width={w * 1000} height={h * 1000} fill={on ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.06)'} stroke={on ? '#f59e0b' : 'rgba(245,158,11,0.85)'} strokeWidth={on ? 6 : 3} vectorEffect="non-scaling-stroke" />
                    <text x={x * 1000 + 8} y={Math.max(y * 1000 - 10, 22)} fill="#f59e0b" fontSize="26" fontWeight="700" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: 6 }}>{i + 1}</text>
                  </g>
                );
              })}
            </svg>
            {findings.map((f, i) => {
              if (!f.box || f.box.length !== 4) {
                return null;
              }
              const [x, y, w, h] = f.box as [number, number, number, number];
              return (
                <button key={`hit-${f.region}-${i}`} type="button" aria-label={`Finding ${i + 1}: ${f.region ?? ''}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setPinned(p => (p === i ? null : i))} className="absolute cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-500" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
              );
            })}
            {analyzing && (
              <div className="pointer-events-none absolute inset-0 bg-background/40 backdrop-blur-[1px]">
                <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-amber-500" />
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {findings.some(f => f.box) ? 'Hover or click a finding to see where to look. Numbers match the list. Regions are the model\'s estimate.' : analyzed ? 'No regions to mark.' : 'Run Analyze to check this photo against verified-good references.'}
            {typeof props.regionsChecked === 'number' && ` ${props.regionsChecked} regions checked.`}
          </p>
          {refs.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Compared against · verified good</div>
              <div className="flex gap-2">
                {refs.map(u => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-border">
                    <img src={u} alt="reference" className="h-16 w-28 object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Engine:</span>
            {' '}
            {props.checks?.reference
              ? `${engineName(props.checks.reference.model)} — reference comparison${props.checks.reference.at ? ` · ${new Date(props.checks.reference.at).toLocaleString()}` : ''}`
              : 'not analyzed yet — this row is a labelled sample; no verdict until a model has looked'}
          </div>

          {props.engines && (props.engines.claude || props.engines.rekognition) && (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <EngineCell
                  name="Claude Vision"
                  sub={props.engines.claude?.model ? `reference comparison · ${props.engines.claude.model}` : 'reference comparison'}
                  verdict={props.engines.claude?.verdict ?? null}
                  confidence={props.engines.claude?.confidence ?? null}
                  detail={props.engines.claude ? `${findings.length} region finding${findings.length === 1 ? '' : 's'} — names what is wrong and where` : 'not run'}
                  action={props.engines.claude && (
                    <button type="button" onClick={() => setDetailsOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] transition hover:bg-muted">
                      <BookOpen className="size-3" aria-hidden />
                      Prompt & learning
                    </button>
                  )}
                />
                <EngineCell
                  name="Amazon Rekognition Custom Labels"
                  sub="whole-image classifier · trained on this workspace's good/bad sets"
                  verdict={props.engines.rekognition?.verdict ?? null}
                  confidence={props.engines.rekognition ? props.engines.rekognition.confidence : null}
                  detail={props.engines.rekognition
                    ? `label ${props.engines.rekognition.label}${props.engines.rekognition.good != null && props.engines.rekognition.bad != null ? ` · good ${Math.round(props.engines.rekognition.good * 100)}% / bad ${Math.round(props.engines.rekognition.bad * 100)}%` : ''} — cannot name a part`
                    : 'not run (classifier off)'}
                />
              </div>
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs ${props.engines.agreement === 'disagree' ? 'bg-amber-500/10' : 'bg-muted/30'}`}>
                <span className="font-semibold">
                  Hybrid:
                  {' '}
                  {props.engines.hybrid_verdict ? props.engines.hybrid_verdict.toUpperCase() : '—'}
                  {pct(props.engines.hybrid_confidence) ? ` · ${pct(props.engines.hybrid_confidence)}` : ''}
                </span>
                <span className="text-muted-foreground">{props.engines.hybrid_reason}</span>
                <span className={`ml-auto rounded-full border px-2 py-0.5 ${props.engines.agreement === 'agree' ? 'border-emerald-600/40 text-emerald-700' : props.engines.agreement === 'disagree' ? 'border-amber-600/50 text-amber-700' : 'border-border text-muted-foreground'}`}>
                  {props.engines.agreement === 'agree' ? 'engines agree' : props.engines.agreement === 'disagree' ? 'engines disagree' : 'one engine'}
                </span>
              </div>
            </div>
          )}

          {analyzed && props.knownLabel && (
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Supplier's label for this photo:</span>
              {' '}
              {props.knownLabel.toUpperCase()}
              {props.verdict && ((props.knownLabel === 'good') === (props.verdict === 'pass') ? ' — matches the verdict' : ' — differs from the verdict')}
            </div>
          )}

          {props.explanation && <p className="text-sm leading-relaxed">{props.explanation}</p>}

          {findings.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {findings.map((f, i) => {
                const on = highlight === i;
                const fb = f.feedback;
                return (
                  <li key={`${f.region}-${i}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} className={`px-3 py-2.5 text-sm transition ${on ? 'bg-amber-500/10' : ''}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <button type="button" onClick={() => setPinned(p => (p === i ? null : i))} className="flex items-baseline gap-2 text-left">
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="font-medium">{f.region ?? 'region'}</span>
                      </button>
                      <Badge variant="outline" className={`text-[11px] ${f.severity === 'blocking' ? 'text-red-600' : f.severity === 'info' ? 'text-muted-foreground' : 'text-amber-600'}`}>{f.issue ?? ''}</Badge>
                      {!f.box && <span className="text-[11px] text-muted-foreground">no region marked</span>}
                      {pct(f.confidence) && <span className="ml-auto font-mono text-xs text-muted-foreground" title="How sure the model is about this specific finding">{`${pct(f.confidence)} sure`}</span>}
                    </div>
                    <div className="mt-1 grid gap-x-6 gap-y-0.5 text-[13px] text-muted-foreground">
                      {f.expected && (
                        <div>
                          <span className="text-[10px] tracking-wide uppercase">expected</span>
                          {' '}
                          {f.expected}
                        </div>
                      )}
                      {f.observed && (
                        <div>
                          <span className="text-[10px] tracking-wide uppercase">saw</span>
                          {' '}
                          {f.observed}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {fb
                        ? (
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${fb.signal === 'agree' ? 'border-emerald-600/40 text-emerald-700' : 'border-red-500/40 text-red-600'}`}>
                              {fb.signal === 'agree' ? <ThumbsUp className="size-3" aria-hidden /> : <ThumbsDown className="size-3" aria-hidden />}
                              {fb.signal === 'agree' ? 'Agreed' : 'Disagreed'}
                              {fb.note ? ` — “${fb.note}”` : ''}
                              {fb.signal === 'disagree' && <a href="/dashboard/learnings" className="ml-1 underline">proposed as a learning</a>}
                            </span>
                          )
                        : (
                            <>
                              <button type="button" disabled={busy !== null} onClick={() => send(i, 'agree')} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-emerald-500/10 hover:text-emerald-700 disabled:opacity-50">
                                <ThumbsUp className="size-3" aria-hidden />
                                Agree
                              </button>
                              <button type="button" disabled={busy !== null} onClick={() => setNoteFor(n => (n === i ? null : i))} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50">
                                <ThumbsDown className="size-3" aria-hidden />
                                Disagree
                              </button>
                            </>
                          )}
                    </div>
                    {noteFor === i && !fb && (
                      <div className="mt-2 flex flex-col gap-2">
                        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What did the model get wrong? (e.g. that's the Rev B bracket — two extra holes, correct part)" className="min-h-16 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
                        <button type="button" disabled={busy !== null || !note.trim()} onClick={() => send(i, 'disagree', note.trim())} className="inline-flex items-center gap-1 self-start rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50">
                          <MessageSquareWarning className="size-3" aria-hidden />
                          Record &amp; propose learning
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {analyzed && findings.length === 0 && <p className="text-sm text-muted-foreground">No findings — every region matched the references.</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {findings.some(f => f.feedback) && (
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Check className="size-3" aria-hidden />
              Feedback is stored on this inspection; disagreements are queued in Learnings for a person to adopt as a rule.
            </p>
          )}
        </div>
      </div>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{engineName(props.checks?.reference?.model)}</SheetTitle>
            <SheetDescription>Exactly what the engine was given on the last check, and what people have taught it since.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-5 px-4 pb-6 text-sm">
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last check</h3>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono">{props.checks?.reference?.model ?? '—'}</dd>
                <dt className="text-muted-foreground">When</dt>
                <dd>{props.checks?.reference?.at ? new Date(props.checks.reference.at).toLocaleString() : '—'}</dd>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd className="font-mono">{usage ? `${String(usage.input_tokens ?? '?')} in · ${String(usage.output_tokens ?? '?')} out` : '—'}</dd>
                <dt className="text-muted-foreground">Temperature</dt>
                <dd className="font-mono">0</dd>
              </dl>
            </section>
            {refs.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Images sent</h3>
                <div className="mt-1 flex flex-wrap gap-2">
                  <a href={props.imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border-2 border-amber-500"><img src={props.imageUrl} alt="candidate" className="h-20 w-32 object-cover" /></a>
                  {refs.map(u => <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-border"><img src={u} alt="reference" className="h-20 w-32 object-cover" /></a>)}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Candidate (amber) then the verified-good references, in the order the model saw them.</p>
              </section>
            )}
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">System prompt</h3>
              <pre className="mt-1 max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11.5px] leading-relaxed break-words whitespace-pre-wrap">{props.checks?.reference?.prompt?.system ?? history?.prompt?.system ?? 'Not recorded for this check — re-analyze to capture the prompt.'}</pre>
              {(props.checks?.reference?.prompt?.user ?? history?.prompt?.user) && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{`User turn: ${props.checks?.reference?.prompt?.user ?? history?.prompt?.user}`}</p>
              )}
            </section>
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Learnings applied on this check</h3>
              {(props.checks?.reference?.learnings_applied ?? history?.applied ?? []).length === 0
                ? <p className="mt-1 text-[13px] text-muted-foreground">None were in the prompt for this check.</p>
                : (
                    <ul className="mt-1 space-y-1.5">
                      {(props.checks?.reference?.learnings_applied ?? history?.applied ?? []).map(l => (
                        <li key={l.id} className="rounded-md border border-border px-2.5 py-1.5 text-[13px]">
                          <span className="font-mono text-[10px] text-muted-foreground">{`${l.step} #${l.id}`}</span>
                          <div>{l.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
            </section>
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Learning history for this kit</h3>
              {historyError && <p className="mt-1 text-xs text-red-600">{historyError}</p>}
              {!history && !historyError && <p className="mt-1 text-[13px] text-muted-foreground">Loading…</p>}
              {history && (
                <>
                  <p className="mt-1 text-[13px] text-muted-foreground">{`${history.adopted.length} adopted rule(s) in the workspace · ${history.candidates.length} candidate(s) raised from this kit`}</p>
                  {history.candidates.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {history.candidates.map(c => (
                        <li key={c.id} className="rounded-md border border-border px-2.5 py-1.5 text-[13px]">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className={`rounded-full border px-1.5 py-0.5 ${c.status === 'approved' ? 'border-emerald-600/40 text-emerald-700' : c.status === 'rejected' ? 'border-red-500/40 text-red-600' : 'border-amber-600/40 text-amber-700'}`}>{c.status}</span>
                            <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                            {c.fromThisRecord && <span className="text-muted-foreground">· from this record</span>}
                            {c.decidedBy && <span className="text-muted-foreground">{`· decided by ${c.decidedBy}`}</span>}
                          </div>
                          <div className="mt-1">{c.ruleText}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Adopted rules are injected into the system prompt on every check. Pending candidates are decided at
                    {' '}
                    <a href="/dashboard/learnings" className="underline">Learnings</a>
                    .
                  </p>
                </>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
