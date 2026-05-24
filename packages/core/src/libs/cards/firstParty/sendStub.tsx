/**
 * `send-stub` first-party Card.
 *
 * Renders the output of a workflow `action` step whose action type is the v1
 * stub (`stub.log_only` / similar) as a "would-be-sent" email envelope —
 * subject, to, body, sent_at + an "action" chip explaining what type of
 * send was intended. The Cards system replaces the prior hardcoded
 * email-card path; producers (the temporal stub activity + the in-process
 * WorkflowService action handler) emit `{ __card: 'send-stub', envelope: {...} }`.
 *
 * When real Gmail/Sendgrid send integrations land, the same Card can render
 * a genuinely-sent envelope — the "Status" chip just flips from "Stub" to
 * "Sent." That's why the schema models it as an envelope rather than a
 * stub-specific output.
 */

import { defineCard } from '@vocion/sdk';
import { z } from 'zod';

export const SEND_STUB_SLUG = 'send-stub';

const sendStubSchema = z.object({
  envelope: z.object({
    to: z.string().optional(),
    subject: z.string().optional(),
    body: z.string(),
    sent_at: z.string().optional(),
    action: z.string().optional(),
  }),
  /**
   * When true, the renderer shows a "Stub" badge to make clear nothing was
   * actually sent. Defaults to `true` for v0.4 — the stub action is the
   * only producer today.
   */
  stubbed: z.boolean().default(true),
});

export const sendStubCard = defineCard({
  slug: SEND_STUB_SLUG,
  name: 'Send (stub)',
  description: 'Renders a workflow action\'s would-be-sent envelope (subject, to, body) as an email-shaped card with a status chip. The Stage-1 placeholder for real send integrations; once Gmail/Sendgrid land, the same card renders genuinely-sent envelopes.',
  surfaces: ['workflow-run', 'chat', 'review-queue'],
  dataSchema: sendStubSchema,
  Renderer: ({ data, surface }) => {
    const dense = surface === 'chat';
    const sentAt = data.envelope.sent_at ? formatDate(data.envelope.sent_at) : null;
    return (
      <div className={dense
        ? 'rounded border border-border bg-background'
        : 'overflow-hidden rounded-lg border border-border bg-background'}
      >
        <header className={dense
          ? 'flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2'
          : 'flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3'}
        >
          <div className="flex items-center gap-2">
            <svg
              className={dense ? 'size-3.5 text-muted-foreground' : 'size-4 text-muted-foreground'}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <span className={dense ? 'text-xs font-medium' : 'text-sm font-medium'}>
              {data.envelope.subject || '(no subject)'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {data.envelope.action && (
              <span className={dense
                ? 'rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'
                : 'rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground'}
              >
                {data.envelope.action}
              </span>
            )}
            <span className={dense
              ? 'rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300'
              : 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300'}
            >
              {data.stubbed ? 'Stub' : 'Sent'}
            </span>
          </div>
        </header>
        <div className={dense ? 'space-y-2 px-3 py-2 text-xs' : 'space-y-3 px-4 py-4 text-sm'}>
          {data.envelope.to && (
            <div className="flex items-baseline gap-2 text-muted-foreground">
              <span className={dense ? 'font-mono text-[10px] uppercase' : 'font-mono text-xs uppercase'}>To</span>
              <span className="text-foreground">{data.envelope.to}</span>
            </div>
          )}
          {sentAt && (
            <div className="flex items-baseline gap-2 text-muted-foreground">
              <span className={dense ? 'font-mono text-[10px] uppercase' : 'font-mono text-xs uppercase'}>
                {data.stubbed ? 'Would have sent' : 'Sent'}
              </span>
              <span>{sentAt}</span>
            </div>
          )}
          <div className="break-words whitespace-pre-wrap text-foreground">
            {data.envelope.body}
          </div>
        </div>
        {data.stubbed && !dense && (
          <footer className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            v1 stub — no actual delivery. Real send integrations (Gmail, Sendgrid, Zendesk) wire here without changing the card.
          </footer>
        )}
      </div>
    );
  },
});

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
