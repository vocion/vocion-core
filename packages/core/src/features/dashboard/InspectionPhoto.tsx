'use client';

import { Check, MessageSquareWarning, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * The photo-backed object view: the picture with the model's finding regions
 * drawn on it, the findings list wired to those regions (hover or click a
 * finding → its box lights up, and back), and per-finding agree / disagree
 * that a person records with a note.
 *
 * Feedback POSTs to `/api/v1/objects/[id]/finding-feedback`, which stamps the
 * finding and — on disagree — opens a learning candidate for the workspace's
 * learning step, so the correction shows up in /dashboard/learnings for a
 * person to adopt as a rule. That is the loop: model finding → human signal →
 * proposed rule → adopted standard.
 *
 * Boxes are `[x, y, w, h]` normalised 0–1 of the image; a finding without a
 * box still lists, it just has nothing to point at.
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

type Props = {
  objectId: number;
  title: string;
  imageUrl: string;
  verdict?: string | null;
  confidence?: number | null;
  explanation?: string | null;
  findings: Finding[];
  regionsChecked?: number | null;
};

const pct = (n: number | undefined | null) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : null);

export function InspectionPhoto(props: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[]>(props.findings);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const highlight = pinned ?? active;

  async function send(index: number, signal: 'agree' | 'disagree', text?: string) {
    setBusy(index);
    setError(null);
    try {
      const res = await fetch(`/api/v1/objects/${props.objectId}/finding-feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ index, signal, note: text || undefined }),
      });
      const body = (await res.json()) as { findings?: Finding[]; error?: { message?: string }; learningCandidateId?: number | null };
      if (!res.ok) {
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      if (body.findings) {
        setFindings(body.findings);
      }
      setNoteFor(null);
      setNote('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const verdictTone = props.verdict === 'pass' ? 'text-emerald-600 border-emerald-600/40' : 'text-amber-600 border-amber-600/40';

  return (
    <div className="rounded-lg border border-border p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
        Photo
        {props.verdict && (
          <span className={`ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${verdictTone}`}>
            {props.verdict === 'pass' ? 'Pass' : 'Hold'}
            {pct(props.confidence) && (
              <span className="font-normal text-muted-foreground">
                {pct(props.confidence)}
                {' '}
                verdict confidence
              </span>
            )}
          </span>
        )}
      </div>

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
                <rect
                  x={x * 1000}
                  y={y * 1000}
                  width={w * 1000}
                  height={h * 1000}
                  fill={on ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.06)'}
                  stroke={on ? '#f59e0b' : 'rgba(245,158,11,0.85)'}
                  strokeWidth={on ? 6 : 3}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={x * 1000 + 8} y={Math.max(y * 1000 - 10, 22)} fill="#f59e0b" fontSize="26" fontWeight="700" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: 6 }}>
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
        {/* hit areas — separate layer so the image stays draggable-free and boxes are hoverable */}
        {findings.map((f, i) => {
          if (!f.box || f.box.length !== 4) {
            return null;
          }
          const [x, y, w, h] = f.box as [number, number, number, number];
          return (
            <button
              key={`hit-${f.region}-${i}`}
              type="button"
              aria-label={`Finding ${i + 1}: ${f.region ?? ''}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setPinned(p => (p === i ? null : i))}
              className="absolute cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Hover or click a finding to see where to look. Numbers match the list. Regions are the model's estimate, not measured.
        {typeof props.regionsChecked === 'number' && ` ${props.regionsChecked} regions checked against the sheet.`}
      </p>

      {props.explanation && <p className="mt-3 text-sm leading-relaxed">{props.explanation}</p>}

      {findings.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {findings.map((f, i) => {
            const on = highlight === i;
            const fb = f.feedback;
            return (
              <li
                key={`${f.region}-${i}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`px-3 py-2.5 text-sm transition ${on ? 'bg-amber-500/10' : ''}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <button type="button" onClick={() => setPinned(p => (p === i ? null : i))} className="flex items-baseline gap-2 text-left">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">{i + 1}</span>
                    <span className="font-medium">{f.region ?? 'region'}</span>
                  </button>
                  <Badge variant="outline" className={`text-[11px] ${f.severity === 'blocking' ? 'text-red-600' : f.severity === 'info' ? 'text-muted-foreground' : 'text-amber-600'}`}>{f.issue ?? ''}</Badge>
                  {!f.box && <span className="text-[11px] text-muted-foreground">no region marked</span>}
                  {pct(f.confidence) && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground" title="How sure the model is about this specific finding">
                      {pct(f.confidence)}
                      {' '}
                      sure
                    </span>
                  )}
                </div>
                <div className="mt-1 grid gap-x-6 gap-y-0.5 text-[13px] text-muted-foreground sm:grid-cols-2">
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
                          {fb.signal === 'disagree' && (
                            <a href="/dashboard/learnings" className="ml-1 underline">proposed as a learning</a>
                          )}
                        </span>
                      )
                    : (
                        <>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => send(i, 'agree')}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-emerald-500/10 hover:text-emerald-700 disabled:opacity-50"
                          >
                            <ThumbsUp className="size-3" aria-hidden />
                            Agree
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setNoteFor(n => (n === i ? null : i))}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                          >
                            <ThumbsDown className="size-3" aria-hidden />
                            Disagree
                          </button>
                        </>
                      )}
                </div>
                {noteFor === i && !fb && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="What did the model get wrong? (e.g. that's the Rev B bracket — two extra holes, correct part)"
                      className="min-h-16 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      disabled={busy !== null || !note.trim()}
                      onClick={() => send(i, 'disagree', note.trim())}
                      className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                    >
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
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {findings.some(f => f.feedback) && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3" aria-hidden />
          Feedback is stored on this inspection; disagreements are queued in Learnings for a person to adopt as a rule, and the Quality Analyst reads both.
        </p>
      )}
    </div>
  );
}
