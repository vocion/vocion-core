'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { confidenceLevel } from './confidence';
import { RegenerateBriefControl } from './RegenerateBriefControl';

/**
 * The lead's research record — the brief and the evidence rail — as shared
 * components, so the lead page and any other surface render the SAME dossier
 * the same way. Extracted from the personalization queue's expanded row.
 *
 * `LeadContext` is the two-column grid: the written brief (with the rewrite
 * note, the failure state, and the Regenerate control) beside the evidence
 * rail (confidence, CRM context, missing). The rail takes optional
 * `railTimeline` / `railArticles` slots for surface-specific cards (the
 * timeline) so the shared parts stay one implementation.
 */

/** The dossier fields the record renders — a subset of the lead_brief row. */
export type LeadDossier = {
  id: number;
  contactName: string;
  confidence: number | null;
  sections: Array<{ heading: string; body: string }>;
  claims: Array<{ text: string; kind: string; source: string; date?: string }>;
  missing: string[];
  /** Set when the tries ran out. Rendered where the brief would be. */
  briefError: string | null;
  briefAttempts: number;
  /** The instruction behind the last rewrite, kept so the brief has a why. */
  regenerateNote: string | null;
};

/**
 * A source that opens is a source a reviewer can check.
 * @param source
 */
function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/**
 * The entrance path is a CRM enum (`PAID_SOCIAL`, `ORGANIC_SEARCH`). Shown
 * raw it reads as a database value rather than how someone found us.
 * @param value
 */
export function entranceLabel(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fixed locale + UTC so the server render and the client render agree. */
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : SHORT_DATE.format(d);
}

/** Queue lane → pill, shared by the queue rows and the lead page header. */
export const LANE_PILL: Record<string, { status: 'pending' | 'approved' | 'paused' | 'completed'; label: string }> = {
  queued: { status: 'paused', label: 'Queued' },
  ready_for_review: { status: 'pending', label: 'Review' },
  handed_off: { status: 'approved', label: 'Handed off' },
  held: { status: 'paused', label: 'Held' },
  sent: { status: 'completed', label: 'Sent' },
};

/**
 * The one section the rail renders by name instead of the prose column.
 *
 * The settled rail order (Valerie, 2026-09-02) reads Confidence, Timeline,
 * CRM context, Missing, Reference articles: everything structured, plus this
 * one prose section, because the CRM facts belong beside the other evidence
 * rather than inside the brief's argument. The spec names the seam and the
 * choice (guided-review-chat.md §7): hard-code this ONE section name in the
 * rail, or promote the CRM facts to structured fields. This is the first
 * option; if a second name ever appears here, take the second.
 * @param heading - A section heading from the skill's output.
 */
const isCrmContext = (heading: string): boolean => heading.trim().toLowerCase() === 'crm context';

/**
 * The written brief: rewrite note, sections or the failure, then the claims
 * as the sections' receipts, then Regenerate. Claims close the left column
 * (Valerie, 2026-09-02): the prose argues, the claims are what it rests on.
 * @param root0
 * @param root0.row
 */
const BriefZone = ({ row }: { row: LeadDossier }) => (
  <div>
    {row.regenerateNote && (
      <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Rewritten on your instruction
        </div>
        <p className="whitespace-pre-line">{row.regenerateNote}</p>
      </div>
    )}

    {/* The error stands where the brief would be, so a lead that ran out of
        tries reads as a failure rather than a thin brief. */}
    {row.sections.length === 0 && row.briefError
      ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-destructive uppercase">
              No brief. Briefing failed
              {' '}
              {row.briefAttempts}
              {row.briefAttempts === 1 ? ' time' : ' times'}
            </h3>
            <p className="whitespace-pre-line">{row.briefError}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              The retries have stopped. Regenerate to put this lead back in line for another pass.
            </p>
          </div>
        )
      : row.sections.length === 0
        ? <p className="text-muted-foreground">No brief recorded.</p>
        : (
            <div className="flex flex-col gap-4">
              {row.sections.filter(section => !isCrmContext(section.heading)).map(section => (
                <section key={section.heading}>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.heading}
                  </h3>
                  {/* Commentable region: the comment layer anchors into this
                      element's text, keyed by the section heading (043). */}
                  {/* The skill writes markdown, so render it. Raw `**Name:**`
                      on the page is the reviewer reading the syntax instead of
                      the brief. `pre-line` keeps the single newlines the brief
                      writes one field per line; markdown would otherwise run
                      them into one paragraph. */}
                  <div
                    data-comment-field={section.heading}
                    className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line"
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
                  </div>
                </section>
              ))}
            </div>
          )}

    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Claims
      </h3>
      {row.claims.length === 0
        ? <p className="text-muted-foreground">No claims recorded.</p>
        : (
            <ul className="flex flex-col gap-2">
              {row.claims.map(claim => (
                <li key={`${claim.kind}-${claim.source}-${claim.text}`}>
                  <div>{claim.text}</div>
                  {/* Every claim carries its kind and where it came from —
                      an unsourced claim is not a claim, and a fact and an
                      inference are not the same thing. */}
                  <div className="text-[11px] text-muted-foreground">
                    {claim.kind}
                    {' · '}
                    {isUrl(claim.source)
                      ? (
                          <a
                            href={claim.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {claim.source}
                          </a>
                        )
                      : claim.source}
                    {claim.date ? ` · ${claim.date}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
    </div>

    <div className="mt-4">
      <RegenerateBriefControl briefId={row.id} contactName={row.contactName} />
    </div>
  </div>
);

/**
 * The evidence rail: Confidence, the timeline slot, CRM context, Missing,
 * and the reference-articles slot, in the settled order.
 * @param props
 * @param props.row - The dossier fields.
 * @param props.timeline - The Arrived/MQL/Briefed/Decided card.
 * @param props.articles - The reference-articles card.
 */
const EvidenceRail = (props: { row: LeadDossier; timeline?: React.ReactNode; articles?: React.ReactNode }) => {
  const { row } = props;
  const level = confidenceLevel(row.confidence);
  const crmContext = row.sections.find(section => isCrmContext(section.heading));
  return (
    <div className="flex flex-col gap-4">
      {/* The settled order (Valerie, 2026-09-02): the verdict first, then when,
          then the CRM record, then what research could not reach, then what it
          read. Claims left this rail for the bottom of the prose column. */}
      {level && (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Confidence
            {' '}
            <button
              type="button"
              aria-label="How well the evidence supports this brief and its angle"
              title="How well the evidence supports this brief and its angle"
              className="cursor-default font-normal tracking-normal normal-case"
            >
              &#9432;
            </button>
          </h3>
          <p>
            {row.confidence?.toFixed(2)}
            {' · '}
            {level}
          </p>
        </div>
      )}

      {props.timeline}

      {crmContext && (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {crmContext.heading}
          </h3>
          <div
            data-comment-field={crmContext.heading}
            className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line"
          >
            <Markdown remarkPlugins={[remarkGfm]}>{crmContext.body}</Markdown>
          </div>
        </div>
      )}

      {row.missing.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Missing
          </h3>
          <ul className="list-inside list-disc text-muted-foreground">
            {row.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}

      {props.articles}
    </div>
  );
};

export const LeadContext = (props: {
  row: LeadDossier;
  /** The Arrived/MQL/Briefed/Decided card, second in the rail after Confidence. */
  railTimeline?: React.ReactNode;
  /** The reference-articles card, closing the rail. */
  railArticles?: React.ReactNode;
}) => (
  <div className="grid gap-6 text-sm @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <BriefZone row={props.row} />
    <EvidenceRail row={props.row} timeline={props.railTimeline} articles={props.railArticles} />
  </div>
);
