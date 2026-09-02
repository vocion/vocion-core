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
 * rail (claims, missing, confidence). The rail takes optional `railTop` /
 * `railBottom` slots for surface-specific cards (reference articles, the
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
 * The written brief: rewrite note, sections or the failure, Regenerate.
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
              {row.sections.map(section => (
                <section key={section.heading}>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.heading}
                  </h3>
                  {/* The skill writes markdown, so render it. Raw `**Name:**`
                      on the page is the reviewer reading the syntax instead of
                      the brief. `pre-line` keeps the single newlines the brief
                      writes one field per line; markdown would otherwise run
                      them into one paragraph. */}
                  <div className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line">
                    <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
                  </div>
                </section>
              ))}
            </div>
          )}

    <div className="mt-4">
      <RegenerateBriefControl briefId={row.id} contactName={row.contactName} />
    </div>
  </div>
);

/**
 * Claims, missing, confidence — with slots above and below for surface-specific cards.
 * @param props
 * @param props.row
 * @param props.top
 * @param props.bottom
 */
const EvidenceRail = (props: { row: LeadDossier; top?: React.ReactNode; bottom?: React.ReactNode }) => {
  const { row } = props;
  const level = confidenceLevel(row.confidence);
  return (
    <div className="flex flex-col gap-4">
      {props.top}

      <div>
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

      {level && (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Confidence
          </h3>
          <p>
            {row.confidence?.toFixed(2)}
            {' · '}
            {level}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            How well the evidence supports this brief and its angle, not a prediction that the
            lead replies. The reason is in the brief's own confidence section.
          </p>
        </div>
      )}

      {props.bottom}
    </div>
  );
};

export const LeadContext = (props: {
  row: LeadDossier;
  railTop?: React.ReactNode;
  railBottom?: React.ReactNode;
}) => (
  <div className="grid gap-6 text-sm @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <BriefZone row={props.row} />
    <EvidenceRail row={props.row} top={props.railTop} bottom={props.railBottom} />
  </div>
);
