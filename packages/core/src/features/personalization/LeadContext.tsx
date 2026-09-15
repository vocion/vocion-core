'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DetailColumns, EvidenceList, RightColumn, Section } from '@/components/patterns';
import { confidenceLevel } from './confidence';
import { RegenerateBriefControl } from './RegenerateBriefControl';

/**
 * The lead's research record — the brief and the evidence column — as shared
 * components, so the lead page and any other surface render the SAME dossier
 * the same way. Built on the Detail archetype (`components/patterns`):
 * hairline `Section`s, an `EvidenceList` for the claims, a `RightColumn`
 * that drops under the content on a phone.
 *
 * `LeadContext` is the two-column layout: the written brief (with the
 * rewrite note, the failure state, and the Regenerate control) beside the
 * evidence column (confidence, CRM context, missing). The column takes
 * optional `railTimeline` / `railArticles` slots for surface-specific
 * sections (the timeline) so the shared parts stay one implementation; the
 * content column takes `lead` (above the brief: the decision) and `tail`
 * (below it: the handoff brief).
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
  /** An instruction that has NOT been addressed yet — the next pass will act on it. */
  regenerateNote: string | null;
  /** Instructions already answered, newest last, each with when the answering brief was written. */
  regenerateHistory?: Array<{ note: string; addressedAt: string }>;
};

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
 * The one section the column renders by name instead of the prose column.
 *
 * The settled column order (Valerie, 2026-09-02) reads Confidence, Timeline,
 * CRM context, Missing, Reference articles: everything structured, plus this
 * one prose section, because the CRM facts belong beside the other evidence
 * rather than inside the brief's argument. The spec names the seam and the
 * choice (guided-review-chat.md §7): hard-code this ONE section name in the
 * column, or promote the CRM facts to structured fields. This is the first
 * option; if a second name ever appears here, take the second.
 * @param heading - A section heading from the skill's output.
 */
const isCrmContext = (heading: string): boolean => heading.trim().toLowerCase() === 'crm context';

/**
 * The skill writes markdown, so render it; `pre-line` keeps its one-fact-per-line sections.
 * @param root0
 * @param root0.body
 * @param root0.field
 */
const Prose = ({ body, field }: { body: string; field?: string }) => (
  <div
    data-comment-field={field}
    className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line"
  >
    <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
  </div>
);

/**
 * The written brief: rewrite note, sections or the failure, then the claims
 * as the sections' receipts, then Regenerate. Claims close the content column
 * (Valerie, 2026-09-02): the prose argues, the claims are what it rests on.
 * @param root0
 * @param root0.row
 */
const BriefZone = ({ row }: { row: LeadDossier }) => (
  <div data-testid="brief-zone">
    {/* Outstanding vs answered, never the same block. An instruction that has
        been addressed used to keep rendering exactly like a fresh one, which
        is what made four re-briefed leads look stuck. */}
    {row.regenerateNote && (
      <Section eyebrow={<span className="text-brand-borderline">Rewrite requested — the next pass will act on this</span>}>
        <p className="border-l-2 border-brand-borderline pl-3 whitespace-pre-line">{row.regenerateNote}</p>
      </Section>
    )}

    {!row.regenerateNote && row.regenerateHistory?.length
      ? (
          <Section eyebrow={`Rewritten on your instruction · ${shortDate(row.regenerateHistory.at(-1)!.addressedAt)}`}>
            <p className="whitespace-pre-line text-muted-foreground">{row.regenerateHistory.at(-1)!.note}</p>
          </Section>
        )
      : null}

    {/* The error stands where the brief would be, so a lead that ran out of
        tries reads as a failure rather than a thin brief. */}
    {row.sections.length === 0 && row.briefError
      ? (
          <Section eyebrow={<span className="text-destructive">{`No brief. Briefing failed ${row.briefAttempts} ${row.briefAttempts === 1 ? 'time' : 'times'}`}</span>}>
            <p className="whitespace-pre-line">{row.briefError}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              The retries have stopped. Regenerate to put this lead back in line for another pass.
            </p>
          </Section>
        )
      : row.sections.length === 0
        ? <Section eyebrow="Brief"><p className="text-muted-foreground">No brief recorded.</p></Section>
        : row.sections.filter(section => !isCrmContext(section.heading)).map(section => (
            // Commentable region: the comment layer anchors into the prose,
            // keyed by the section heading (043).
            <Section key={section.heading} eyebrow={section.heading}>
              <Prose body={section.body} field={section.heading} />
            </Section>
          ))}

    {/* Every claim carries its kind and where it came from — an unsourced
        claim is not a claim, and a fact and an inference are not the same
        thing. */}
    <Section eyebrow="Claims">
      <EvidenceList
        items={row.claims.map(c => ({ text: c.text, kind: c.kind, source: c.source, date: c.date, key: `${c.kind}-${c.source}-${c.text}` }))}
        empty="No claims recorded."
      />
    </Section>

    {/* A ghost verb, not the page's primary: sending the brief back is rare. */}
    <div className="py-4">
      <RegenerateBriefControl briefId={row.id} contactName={row.contactName} />
    </div>
  </div>
);

/** The handoff trigger, as the page says it. */
export const HANDOFF_TRIGGER_LABEL: Record<string, string> = {
  reply: 'Replied',
  meeting: 'Meeting booked',
  intent: 'Intent',
  routed: 'Routed by a reviewer',
};

/**
 * The call prep written when the lead left the agent (ticket 055). Rendered
 * beneath the review brief, read-only, through the same section markup, and
 * headed by what triggered it and when. Nothing here is decided: the brief is
 * already saved and already on the contact in HubSpot (056); this is the
 * platform's own copy.
 * @param props
 * @param props.sections
 * @param props.trigger
 * @param props.at - ISO timestamp the handoff brief was saved.
 */
export const HandoffBriefZone = (props: {
  sections: Array<{ heading: string; body: string }>;
  trigger: string | null;
  at: string | null;
}) => {
  if (props.sections.length === 0) {
    return null;
  }
  const meta = [
    props.trigger ? HANDOFF_TRIGGER_LABEL[props.trigger] ?? props.trigger : null,
    props.at ? shortDate(props.at) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Section aria-label="Handoff brief" eyebrow={`Handoff brief${meta ? ` · ${meta}` : ''}`} className="mt-2 border-t border-rule">
      <div className="flex flex-col gap-4">
        {props.sections.map(section => (
          <section key={section.heading}>
            <h4 className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {section.heading}
            </h4>
            <Prose body={section.body} />
          </section>
        ))}
      </div>
    </Section>
  );
};

/**
 * The evidence column: Confidence, the timeline slot, CRM context, Missing,
 * and the reference-articles slot, in the settled order.
 * @param props
 * @param props.row - The dossier fields.
 * @param props.timeline - The Arrived/MQL/Briefed/Decided section.
 * @param props.articles - The reference-articles section.
 */
const EvidenceRail = (props: { row: LeadDossier; timeline?: React.ReactNode; articles?: React.ReactNode }) => {
  const { row } = props;
  const level = confidenceLevel(row.confidence);
  const crmContext = row.sections.find(section => isCrmContext(section.heading));
  return (
    <RightColumn label="Evidence">
      {/* The settled order (Valerie, 2026-09-02): the verdict first, then when,
          then the CRM record, then what research could not reach, then what it
          read. Claims left this column for the bottom of the prose column. */}
      {level && (
        <Section
          tone="quiet"
          eyebrow={(
            <>
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
            </>
          )}
        >
          <p className="tabular-nums">{`${row.confidence?.toFixed(2)} · ${level}`}</p>
        </Section>
      )}

      {props.timeline}

      {crmContext && (
        <Section tone="quiet" eyebrow={crmContext.heading}>
          <Prose body={crmContext.body} field={crmContext.heading} />
        </Section>
      )}

      {row.missing.length > 0 && (
        <Section tone="quiet" eyebrow="Missing">
          <ul className="list-inside list-disc text-muted-foreground">
            {row.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
        </Section>
      )}

      {props.articles}
    </RightColumn>
  );
};

export const LeadContext = (props: {
  row: LeadDossier;
  /** Above the brief in the content column: the decision, or its record. */
  lead?: React.ReactNode;
  /** Below the brief in the content column: the handoff brief. */
  tail?: React.ReactNode;
  /** The Arrived/MQL/Briefed/Decided section, second in the column after Confidence. */
  railTimeline?: React.ReactNode;
  /** The reference-articles section, closing the column. */
  railArticles?: React.ReactNode;
}) => (
  <DetailColumns aside={<EvidenceRail row={props.row} timeline={props.railTimeline} articles={props.railArticles} />}>
    {props.lead}
    <BriefZone row={props.row} />
    {props.tail}
  </DetailColumns>
);
