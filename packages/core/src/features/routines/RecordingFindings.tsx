'use client';

import type { RecordingLane } from '@/components/patterns';
import type { FindingKind, RecordingFinding } from '@/libs/routines/findings';
import type { RoutineSource } from '@/libs/routines/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingTimeline } from '@/components/patterns';
import { FINDING_KINDS, FINDING_LABEL, findingMarks } from '@/libs/routines/findings';
import { momentUrl } from '@/libs/routines/types';
import { cn } from '@/utils/Helpers';
import { MomentLink } from './RoutineChips';
import { SubHead } from './RoutineParts';

/**
 * WHAT VOCION FOUND IN THE RECORDING — the recording an automation was taught
 * from, playing, with its moments on a track under it, and what the analyst
 * found at each: the steps in order, the systems the work moved into, the
 * rules, the judgment calls, the questions one recording cannot answer. Drawn
 * while the analyst is still writing (`live`: findings arrive as they are
 * found) and afterwards as the evidence behind the version it drafted.
 *
 * A mark on the track or a moment beside a finding moves the player there and
 * points at the finding. Without a player (Slate would not give one) a moment
 * opens Slate at that second instead. A kind with no findings has no row and
 * no heading.
 *
 * Tour anchors: `data-tour="recording-player"`, `"recording-timeline"`,
 * `"recording-findings"`, and one per group, `"findings-<kind>"`.
 */

const LANE_CLASS: Record<FindingKind, string> = {
  step: 'bg-foreground',
  system: 'rounded-sm bg-brand-teal',
  rule: 'rounded-[2px] bg-ink-secondary',
  judgment: 'rotate-45 rounded-[2px] bg-brand-teal-deep',
  question: 'bg-background ring-2 ring-waiting ring-inset',
};

const LANES: RecordingLane[] = FINDING_KINDS.map(kind => ({ kind, label: FINDING_LABEL[kind].group, className: LANE_CLASS[kind] }));

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function RecordingFindings({ routineId, source, findings, live = false, compact = false }: { routineId: number; source: RoutineSource; findings: RecordingFinding[]; live?: boolean; compact?: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const src = `/api/automations/${routineId}/recording`;
  // Whether Vocion can hand the player the recording (Slate connected, a file to play): asked once,
  // without following the redirect to the file. Until it says so there is no player, and a moment
  // opens Slate at that second instead.
  const [playable, setPlayable] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch(src, { method: 'GET', redirect: 'manual', cache: 'no-store' })
      .then(res => live && setPlayable(res.type === 'opaqueredirect' || res.ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [src]);
  const [duration, setDuration] = useState<number | null>(source.durationSec ?? null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const seek = useCallback((at: number) => {
    const v = player.current;
    if (playable && v) {
      v.currentTime = at;
      void v.play().catch(() => {});
      setPlayhead(at);
    } else {
      window.open(momentUrl(source.url, at), '_blank', 'noopener');
    }
  }, [playable, source.url]);

  const point = useCallback((f: { id: string; at: number }) => {
    setActive(f.id);
    seek(f.at);
    document.querySelector(`[data-finding="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [seek]);

  const marks = findingMarks(findings, duration);
  const groups = FINDING_KINDS.map(kind => ({ kind, items: findings.filter(f => f.kind === kind) })).filter(g => g.items.length > 0);

  return (
    <div className="text-sm" data-recording-findings={live ? 'live' : 'kept'}>
      {playable && (
        <div className="overflow-hidden rounded-lg bg-black" data-tour="recording-player">
          {/* The specialist's own narration is the sound; the transcript stays on Slate. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={player}
            src={src}
            controls
            playsInline
            preload="metadata"
            aria-label={source.title ?? 'The recording'}
            className={cn('block w-full object-contain', compact ? 'max-h-[240px]' : 'max-h-[420px]')}
            onLoadedMetadata={e => Number.isFinite(e.currentTarget.duration) && setDuration(d => d ?? e.currentTarget.duration)}
            onTimeUpdate={e => setPlayhead(e.currentTarget.currentTime)}
            data-recording-player
          />
        </div>
      )}

      {marks.length > 0 && (
        <div className="mt-3" data-tour="recording-timeline">
          <RecordingTimeline marks={marks} lanes={LANES} durationSec={duration} activeId={active} playhead={playhead} onPick={point} />
        </div>
      )}

      {(groups.length > 0 || live) && (
        <div className="mt-2" data-tour="recording-findings">
          {groups.map(g => (
            <div key={g.kind} data-tour={`findings-${g.kind}`} data-findings={g.kind}>
              <SubHead count={g.items.length}>{FINDING_LABEL[g.kind].group}</SubHead>
              <ol className={cn(g.kind === 'step' ? 'divide-y divide-border/60' : 'space-y-1')}>
                {g.items.map(f => (
                  <FindingRow key={f.id} finding={f} active={f.id === active} sourceUrl={source.url} onSeek={f.at === null ? null : at => point({ id: f.id, at })} />
                ))}
              </ol>
            </div>
          ))}
          {live && (
            <p className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground" data-findings-live>
              <span className="size-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse" aria-hidden />
              {groups.length > 0 ? 'Still reading the recording…' : 'Reading the recording; what it finds appears here as it finds it.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding: f, active, sourceUrl, onSeek }: { finding: RecordingFinding; active: boolean; sourceUrl: string; onSeek: ((at: number) => void) | null }) {
  const detail = f.kind === 'system' && f.detail ? host(f.detail) : f.detail;
  return (
    <li
      className={cn('flex items-start gap-3 rounded-md px-1.5 py-1.5 transition-colors motion-safe:animate-in motion-safe:fade-in', active && 'bg-surface-soft')}
      data-finding={f.id}
      data-finding-kind={f.kind}
      data-active={active ? 'true' : undefined}
    >
      {f.kind === 'step' && <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[11px] font-medium text-muted-foreground tabular-nums">{f.n}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-foreground">{f.text}</span>
        {detail && <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{detail}</span>}
      </span>
      <MomentLink url={sourceUrl} at={f.at} onSeek={onSeek} />
    </li>
  );
}
