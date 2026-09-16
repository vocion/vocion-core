'use client';

import type { LeadArtifactRef } from '@/services/personalization/artifacts';
import type { ConfidenceDimensions } from '@/services/personalization/confidence';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EvidenceList, FactList, Section } from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { EvidenceRef } from '@/features/preview/EvidenceRefs';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { reduceBrief } from '@/services/personalization/brief';
import { CONFIDENCE_DIMENSIONS, DIMENSION_LABEL } from '@/services/personalization/confidence';
import { ArtifactRegenerateControl } from './ArtifactRegenerateControl';
import { fullDate, HANDOFF_TRIGGER_LABEL, shortDate } from './leadFormat';

/**
 * The lead workspace's three tabs — **Brief · Sequence · Evidence**.
 *
 * What replaced what (`docs/specs/personalization-v2.md`):
 *
 * - The permanent metadata column is gone. Confidence, timeline and CRM
 *   context moved into the brief or into Evidence, which is where the review
 *   said they belong — and the Regenerate control that was stranded at the
 *   bottom of that column moved next to the artifact it regenerates.
 * - The brief is the five sections `reduceBrief` produces, and only those. The
 *   reduction runs HERE as well as when the brief artifact is written, from
 *   the same pure function, so the page and the artifact cannot drift.
 * - Everything that used to be a section of its own and is not one of the five
 *   is under Evidence. Nothing was deleted; it is one click away.
 *
 * `Section` carries `data-comment-field` from its eyebrow, so *Select → talk*
 * works on every tab without any tab knowing about it.
 */

/** The dossier fields the tabs render — a subset of the lead_brief row. */
export type LeadDossier = {
  id: number;
  contactName: string;
  confidence: number | null;
  confidenceDimensions: ConfidenceDimensions | null;
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
 * The skill writes markdown, so render it; `pre-line` keeps its one-fact-per-line sections.
 * @param props - The body and the comment-field name.
 * @param props.body - Markdown.
 * @param props.field - The comment region's name, when it needs one of its own.
 */
export const Prose = ({ body, field }: { body: string; field?: string }) => (
  <div
    data-comment-field={field}
    className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line"
  >
    <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
  </div>
);

/**
 * The reduction, run once per render and shared by both tabs that read it.
 * @param row
 */
export function useReducedBrief(row: LeadDossier) {
  return reduceBrief({
    sections: row.sections,
    missing: row.missing,
    claims: row.claims,
    dimensions: row.confidenceDimensions,
    confidence: row.confidence,
  });
}

/**
 * **Brief** — what we know, what we couldn't verify, the angle, the sources,
 * the confidence. Five sections at most, and fewer when there is less to say.
 * @param props - The dossier and its artifact.
 * @param props.row - The dossier.
 * @param props.artifact - The brief artifact, when one has been written.
 */
export const BriefTab = ({ row, artifact }: { row: LeadDossier; artifact?: LeadArtifactRef }) => {
  const reduced = useReducedBrief(row);
  const dimensions = row.confidenceDimensions;

  return (
    <div data-testid="brief-tab">
      {/* Outstanding vs answered, never the same block. An instruction that has
          been addressed used to keep rendering exactly like a fresh one. */}
      {row.regenerateNote && (
        <Section eyebrow={<span className="text-brand-borderline">Rewrite requested — the next pass will act on this</span>} commentField="Rewrite requested">
          <p className="border-l-2 border-brand-borderline pl-3 whitespace-pre-line">{row.regenerateNote}</p>
        </Section>
      )}

      {!row.regenerateNote && row.regenerateHistory?.length
        ? (
            <Section eyebrow={`Rewritten on your instruction · ${shortDate(row.regenerateHistory.at(-1)!.addressedAt)}`} commentField="Rewritten on your instruction">
              <p className="whitespace-pre-line text-muted-foreground">{row.regenerateHistory.at(-1)!.note}</p>
            </Section>
          )
        : null}

      {/* The error stands where the brief would be, so a lead that ran out of
          tries reads as a failure rather than a thin brief. */}
      {reduced.brief.length === 0 && row.briefError
        ? (
            <Section eyebrow={<span className="text-destructive">{`No brief. Briefing failed ${row.briefAttempts} ${row.briefAttempts === 1 ? 'time' : 'times'}`}</span>} commentField="Briefing failed">
              <p className="whitespace-pre-line">{row.briefError}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                The retries have stopped. Regenerate to put this lead back in line for another pass.
              </p>
            </Section>
          )
        : reduced.brief.length === 0
          ? <Section eyebrow="Brief"><p className="text-muted-foreground">No brief recorded.</p></Section>
          : reduced.brief.map(section => (
              <Section key={section.heading} eyebrow={section.heading}>
                {section.heading === 'Sources'
                  ? (
                      <ul className="flex flex-col gap-1">
                        {reduced.brief.length > 0 && row.claims.length === 0 && <li className="text-muted-foreground">No sources recorded.</li>}
                        {[...new Set(row.claims.map(c => c.source))].map(source => (
                          <li key={source}><EvidenceRef source={source} className="w-auto py-0" /></li>
                        ))}
                      </ul>
                    )
                  : section.heading === 'Research confidence'
                    ? (
                        // The headline reading is already in the page's meta
                        // row; saying it twice is the repetition the reduction
                        // pass exists to remove. What this section adds is the
                        // five dimensions the one number was collapsing —
                        // each drawn by `ConfidenceBars`, which carries its
                        // own subject, so there is no label column repeating
                        // the word beside it.
                        <ul className="flex flex-col gap-1.5">
                          {dimensions
                            ? CONFIDENCE_DIMENSIONS.map(k => (
                                <li key={k}>
                                  {dimensions[k].value === null
                                    ? (
                                        <span className="text-muted-foreground" title={dimensions[k].basis}>
                                          {`${DIMENSION_LABEL[k]} unavailable — nothing can be inferred`}
                                        </span>
                                      )
                                    : <ConfidenceBars value={dimensions[k].value} subject={DIMENSION_LABEL[k]} note={dimensions[k].basis} />}
                                </li>
                              ))
                            : <li><ConfidenceBars value={row.confidence} subject="Research" /></li>}
                        </ul>
                      )
                    : <Prose body={section.body} field={section.heading} />}
              </Section>
            ))}

      <div className="py-4">
        <ArtifactRegenerateControl
          leadId={row.id}
          target="brief"
          artifactTitle={artifact?.title ?? `${row.contactName} — research brief`}
          requireNote
          placeholder="e.g. The angle leans on an industry pattern rather than anything about this company. Find something specific to them or say there is nothing."
          consequence="This clears the brief and puts the lead back in line, so it leaves Review until the next sweep writes a new one."
        />
      </div>
    </div>
  );
};

/**
 * **Evidence** — everything the brief no longer has to carry: the sections the
 * reduction moved here, the claims with their sources, the timeline, and the
 * run details.
 *
 * Deliberately the last tab and deliberately complete: §12 says hide
 * complexity, never hide truth. The brief is the simplest useful reading; this
 * is the evidence underneath it.
 * @param props - The dossier, the timeline facts and the run details.
 * @param props.row - The dossier.
 * @param props.timeline - Arrived / MQL / Briefed / Decided.
 * @param props.provenance - Model, prompt version, artifact versions, what a decision pinned.
 */
export const EvidenceTab = (props: {
  row: LeadDossier;
  timeline: Array<{ label: string; value: string }>;
  provenance: Array<{ label: string; value: string }>;
}) => {
  const reduced = useReducedBrief(props.row);
  return (
    <div data-testid="evidence-tab">
      {reduced.evidence.map(section => (
        <Section key={section.heading} eyebrow={section.heading}>
          <Prose body={section.body} field={section.heading} />
        </Section>
      ))}

      {/* Every claim carries its kind and where it came from — an unsourced
          claim is not a claim, and a fact and an inference are not the same
          thing. */}
      <Section eyebrow="Claims">
        <EvidenceList
          items={props.row.claims.map(c => ({ text: c.text, kind: c.kind, source: c.source, date: c.date, key: `${c.kind}-${c.source}-${c.text}` }))}
          empty="No claims recorded."
          renderSource={source => <EvidenceRef source={source} className="w-auto py-0" />}
        />
        <PreviewPanel />
      </Section>

      {props.timeline.length > 0 && (
        <Section eyebrow="Timeline">
          <FactList facts={props.timeline} />
        </Section>
      )}

      {props.provenance.length > 0 && (
        <Section eyebrow="Run details">
          <FactList facts={props.provenance} />
        </Section>
      )}
    </div>
  );
};

/**
 * The call prep written when the lead left the agent (ticket 055). Read-only,
 * beneath the sequence: the brief is already saved and already on the contact
 * in HubSpot; this is the platform's own copy.
 * @param props - The sections and what triggered the handoff.
 * @param props.sections - The prep sections.
 * @param props.trigger - Why the lead left.
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
    props.at ? fullDate(props.at) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Section aria-label="Handoff brief" eyebrow={`Handoff brief${meta ? ` · ${meta}` : ''}`} commentField="Handoff brief" className="mt-2 border-t border-rule">
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
