'use client';

import type { RecordingLane, RecordingMark } from './recordingTrack';
import { cn } from '@/utils/Helpers';
import { placeMarks, trackWindow } from './recordingTrack';

/**
 * A RECORDING'S MOMENTS, ON ITS LENGTH — a horizontal track under a player,
 * one lane per kind of moment (only the kinds it has), each moment a mark at
 * its place in the recording (in the part of it the marks are in, when they
 * sit in one part of a longer recording). Choosing a mark hands it back (`onPick`): the
 * page seeks its player there and points at what the mark is. Any recording with moments:
 * a taught automation's findings, a call's chapters, a run's steps.
 * @param props
 * @param props.marks - The moments.
 * @param props.lanes - Every kind of lane, in the order drawn.
 * @param props.durationSec - The recording's length, when known.
 * @param props.activeId - The mark being pointed at.
 * @param props.playhead - Where the player is, in seconds.
 * @param props.onPick - A mark was chosen.
 * @param props.className
 */
export function RecordingTimeline(props: {
  marks: RecordingMark[];
  lanes: RecordingLane[];
  durationSec?: number | null;
  activeId?: string | null;
  playhead?: number | null;
  onPick: (mark: RecordingMark) => void;
  className?: string;
}) {
  const placed = placeMarks(props.marks, props.lanes, props.durationSec);
  if (placed.length === 0) {
    return null;
  }
  // The track shows the part of the recording its marks are in; the playhead is drawn while it is in that part.
  const { from, to } = trackWindow(props.marks, props.durationSec);
  const head = props.playhead !== null && props.playhead !== undefined && Number.isFinite(props.playhead) && props.playhead >= from && props.playhead <= to ? ((props.playhead - from) / (to - from)) * 100 : null;
  return (
    <div className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[11px]', props.className)} data-recording-timeline>
      <div className="flex flex-col">
        {placed.map(lane => (
          <span key={lane.kind} className="flex h-6 items-center whitespace-nowrap text-muted-foreground">{lane.label}</span>
        ))}
      </div>
      <div>
        <div className="relative">
          {placed.map(lane => (
            <div key={lane.kind} className="relative h-6" data-recording-lane={lane.kind}>
              <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-rule" aria-hidden />
              {lane.marks.map((m) => {
                const active = m.id === props.activeId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={`${clockOf(m.at)} · ${m.label}`}
                    aria-label={`${clockOf(m.at)}: ${m.label}`}
                    aria-pressed={active}
                    onClick={() => props.onPick(m)}
                    style={{ left: `${m.left}%` }}
                    className={cn(
                      'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70 transition-transform hover:scale-150 focus-visible:scale-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      lane.className,
                      active && 'z-10 scale-150 ring-2 ring-background',
                    )}
                    data-recording-mark={m.id}
                    data-active={active ? 'true' : undefined}
                  />
                );
              })}
            </div>
          ))}
          {head !== null && <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${head}%` }} aria-hidden data-recording-playhead />}
        </div>
        <div className="mt-1 flex justify-between font-mono text-muted-foreground tabular-nums">
          <span>{clockOf(from)}</span>
          <span>{clockOf(to)}</span>
        </div>
      </div>
    </div>
  );
}

function clockOf(at: number): string {
  const s = Math.max(0, Math.round(at));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
