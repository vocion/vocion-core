'use client';

import type { HitlGatePayload } from './types';
import { CircleCheck, CircleX, Clock, ShieldQuestion, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Human-in-the-loop approval gate (Phase C).
 *
 * Emitted by the agent as a `hitl_gate` SSE event. Shows the question +
 * optional payload preview + two actions. Approve/reject sends a follow-up
 * turn carrying the decision (no checkpointer; matches v0.2 design).
 *
 * IT RENDERS IN THE TRANSCRIPT, as a block after the turn that raised it —
 * not pinned above the composer, which is where it used to sit. Chris,
 * 2026-09-24: *"refactor those to show inline instead of sticky to the
 * compose bar"*. A decision anchored to the bottom of the pane is detached
 * from the turn that asked for it: scroll up to read why you are being asked
 * and the question follows you down the page, still saying "approve" about
 * something no longer on screen. As a block it sits where it happened, scrolls
 * with the conversation, and stays in the record once decided.
 *
 * So this component owns NO layout of its own — no centring, no measure, no
 * page padding. The transcript supplies all three (`mx-auto w-full max-w-3xl`
 * on the message column), the same as for a message.
 *
 * The parent shell decides what "approve" / "reject" actually puts
 * in the next user message (e.g. `"approve"` / `"reject: bad scope"`).
 */

export type HitlGateProps = {
  gate: HitlGatePayload;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
  /** When the gate appeared. Drives the live "Waiting Nm" clock. Defaults to now. */
  pausedAt?: number;
  /** Who's allowed to approve. e.g. "org:admin". Falls back to a generic line. */
  approverRole?: string;
};

function useElapsed(since: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!since) {
    return null;
  }
  const ms = Math.max(0, now - since);
  const m = Math.floor(ms / 60_000);
  if (m < 1) {
    return 'just now';
  }
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ${m % 60}m`;
  }
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function HitlGate({ gate, onApprove, onReject, disabled = false, pausedAt, approverRole = 'org:admin' }: HitlGateProps) {
  const elapsed = useElapsed(pausedAt);
  return (
    <div data-testid="hitl-gate">
      <div className="rounded-2xl border-2 border-brand-amber/40 bg-brand-amber-tint p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber/15 text-brand-amber-deep">
            <ShieldQuestion className="size-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-brand-amber-deep uppercase">
              Approval required ·
              {' '}
              {gate.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brand-amber-deep/80">
              {elapsed && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  Waiting
                  {' '}
                  {elapsed}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                Anyone with
                {' '}
                {approverRole}
                {' '}
                can approve
              </span>
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{gate.question}</div>
            {gate.payload && Object.keys(gate.payload).length > 0 && (
              <pre className="mt-3 overflow-x-auto rounded-lg border border-brand-amber/30 bg-background p-3 font-mono text-xs">
                {JSON.stringify(gate.payload, null, 2)}
              </pre>
            )}
            {gate.resumeUrl && (
              <a
                href={gate.resumeUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-brand-amber-deep underline"
              >
                Open in detail view →
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-md bg-brand-amber px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-amber-deep disabled:opacity-50"
          >
            <CircleCheck className="size-4" aria-hidden="true" />
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-md border border-red-300 bg-background px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
          >
            <CircleX className="size-4" aria-hidden="true" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
