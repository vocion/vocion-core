'use client';

/**
 * The compact chips under a turn — what it produced, and what it set moving.
 *
 * An artifact the turn made or changed: "📄 Release readiness · v3 updated".
 * They exist because the pane shows only the CURRENT artifact: without a mark
 * in the transcript there is nothing to say which turn made which thing, and
 * scrolling back through a long conversation stops answering "where did this
 * come from". Clicking one opens it: in the artifact PANE where a surface has
 * one, and in the preview panel everywhere else.
 *
 * That fallback is the point. The pane only exists on the expanded
 * conversation route, so on the plain chat page the chip had no handler, came
 * up disabled, and an artifact the turn had genuinely produced was
 * unreachable — Chris, 2026-09-17: *"it's still not triggering the artifact
 * sidebar."* The preview panel resolves an artifact ref on any surface, so it
 * is the honest default rather than a dead control.
 *
 * And, in the same row and the same shape, everything else the turn started
 * or made that keeps going — a run, a request, a task, a plan, an ask
 * (`libs/chat/turnFollowups`) — each with a live status dot (Chris,
 * 2026-09-29: "End chat should give me something to click on to watch and
 * follow up … we already get this when an artifact is generated. Use that
 * pattern and extend the implementation."). One chip, two sources.
 */

import type { ChatMessageArtifact } from './types';
import type { DotTone } from '@/components/patterns';
import type { TurnFollowup } from '@/libs/chat/turnFollowups';
import type { FollowState } from '@/services/preview/followStatus';
import { CircleDot, Inbox, Play } from 'lucide-react';
import { StatusDot } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ARTIFACT_KIND_ICON, ARTIFACT_KIND_LABEL } from '@/features/dashboard/artifacts/kinds';
import { openPreview } from '@/features/preview/previewState';
import { Link } from '@/libs/I18nNavigation';
import { useFollowStatus } from './useFollowStatus';

const CHIP = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-medium text-foreground/85 transition hover:border-brand-amber/40 hover:text-foreground';

/** A follow state as the dot's tone and its word. */
export const FOLLOW_TONE: Record<FollowState, { tone: DotTone; word: string }> = {
  queued: { tone: 'neutral', word: 'queued' },
  running: { tone: 'amber', word: 'running' },
  waiting: { tone: 'amber', word: 'waiting on you' },
  done: { tone: 'pass', word: 'done' },
  failed: { tone: 'fail', word: 'failed' },
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Refs the preview pane can open; anything else opens its page. */
const PREVIEWABLE = new Set(['worker_run', 'object', 'artifact', 'mission_run']);

export function ArtifactChips({ artifacts, follow = [], onOpen }: {
  artifacts: ChatMessageArtifact[];
  /** What the turn set moving, each followed live. */
  follow?: TurnFollowup[];
  onOpen?: (id: number) => void;
}) {
  const statuses = useFollowStatus(follow);
  if (artifacts.length === 0 && follow.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" data-artifact-chips>
      {artifacts.map((a) => {
        const Icon = ARTIFACT_KIND_ICON[a.kind];
        const label = `v${a.version} ${a.version > 1 ? 'updated' : 'created'}`;
        return (
          // `min-w-0` twice, and both are load-bearing: the chip's `truncate`
          // span is `white-space: nowrap`, so its min-content is the whole
          // title — which the `li` then reported to the wrapping row and the
          // row reported to the transcript. A document title is long by
          // nature, so the chip has to be the thing that gives.
          <li key={`${a.id}-${a.version}`} className="max-w-full min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={ev => (onOpen
                    ? onOpen(a.id)
                    : openPreview({ type: 'artifact', id: String(a.id) }, ev.currentTarget))}
                  data-artifact-chip={a.id}
                  // The page this chip stands for, for a tour that opens it straight there (WorkspaceTour follows data-href).
                  data-href={`/dashboard/artifacts/${a.id}`}
                  className={CHIP}
                >
                  <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{a.title}</span>
                  <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                    ·
                    {' '}
                    {label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${ARTIFACT_KIND_LABEL[a.kind]} · ${label}`}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
      {follow.map((f) => {
        const key = `${f.ref.type}:${f.ref.id}`;
        const status = statuses[key];
        const shown = status ? FOLLOW_TONE[status.state] : null;
        const Icon = f.ref.type === 'worker_run' ? Play : f.ref.type === 'ask' ? Inbox : CircleDot;
        const body = (
          <>
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">{capital(status?.name ?? f.label)}</span>
            {shown && (
              <StatusDot tone={shown.tone} label={<span className="text-[11px] font-normal text-muted-foreground">{status!.label === status!.state ? shown.word : status!.label}</span>} className="shrink-0" />
            )}
          </>
        );
        return (
          <li key={key} className="max-w-full min-w-0" data-follow-chip={key} data-follow-state={status?.state}>
            <Tooltip>
              <TooltipTrigger asChild>
                {PREVIEWABLE.has(f.ref.type)
                  ? (
                      <button type="button" onClick={ev => openPreview({ type: f.ref.type as 'worker_run', id: f.ref.id }, ev.currentTarget)} className={CHIP}>
                        {body}
                      </button>
                    )
                  : <Link href={f.href} className={CHIP}>{body}</Link>}
              </TooltipTrigger>
              <TooltipContent>{shown ? `${capital(status!.name ?? f.label)} · ${status!.label}` : capital(f.label)}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
