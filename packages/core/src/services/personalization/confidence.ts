/**
 * Research confidence, per dimension.
 *
 * > "`0.20 speculative` collapses several different questions. This lead could
 * > have: Identity **High** · Acquisition context **High** · Company
 * > understanding **Very low** · Engagement understanding **Unknown** ·
 * > Personalization fit **Low**. You do not need five meters in the UI, but
 * > the brief should calculate them separately internally, so the
 * > recommendation engine can reason: *identity is known, company context is
 * > insufficient, engagement is unavailable — use generic-curiosity nurture
 * > rather than personalized business-problem messaging.*"
 * > — `docs/specs/personalization-v2.md`
 *
 * Three things follow from that, and they are the whole design:
 *
 * 1. **The dimensions are computed from the evidence, not asked of the model.**
 *    A model asked "how confident are you overall" answers with one number and
 *    a paragraph. Identity confidence is a question about which identity
 *    fields resolved; it is arithmetic, and arithmetic belongs in code
 *    (`docs/design/reduction.md`, failure 2 — narrating instead of grading).
 *
 * 2. **UNAVAILABLE is not LOW.** `value: null` means the evidence for this
 *    dimension could not be read at all — the CRM returned no engagement
 *    fields, the site never rendered. Grading that as 0.1 is the exact error
 *    the chat made when it asserted the contact "hasn't engaged since" on a
 *    brief that said the engagement fields were unavailable. A null never
 *    becomes a number, and it never averages into one.
 *
 * 3. **The posture is derived, not chosen.** `recommendedPosture()` reads the
 *    dimensions and says which kind of outreach the evidence can carry. That
 *    is the sentence the CEO wanted the recommendation engine to be able to
 *    write, and it is one function so the brief, the recommendation and the
 *    page all say the same thing.
 *
 * Anything SHOWN goes through `ConfidenceBars` with its subject — never a bare
 * score without its class (`docs/design/patterns.md`, "Never a score without
 * its class").
 */

/** The five questions the old single score was collapsing. */
export const CONFIDENCE_DIMENSIONS = [
  'identity',
  'acquisition',
  'company',
  'engagement',
  'personalizationFit',
] as const;

export type ConfidenceDimension = (typeof CONFIDENCE_DIMENSIONS)[number];

/** How each dimension reads to a person. */
export const DIMENSION_LABEL: Record<ConfidenceDimension, string> = {
  identity: 'Identity',
  acquisition: 'Acquisition context',
  company: 'Company understanding',
  engagement: 'Engagement',
  personalizationFit: 'Personalization fit',
};

/**
 * One dimension's reading. `value: null` is UNAVAILABLE — the evidence could
 * not be read — and is never rendered as a percentage.
 */
export type DimensionScore = {
  value: number | null;
  /** One clause saying what the number rests on. Shown behind the reading. */
  basis: string;
};

export type ConfidenceDimensions = Record<ConfidenceDimension, DimensionScore>;

/** What the brief and the CRM actually produced, as the grader needs it. */
export type ConfidenceEvidence = {
  contactName?: string | null;
  contactTitle?: string | null;
  companyName?: string | null;
  entranceSource?: string | null;
  utmCampaign?: string | null;
  mqlAt?: string | Date | null;
  arrivedAt?: string | Date | null;
  /**
   * Whether the CRM returned engagement fields AT ALL. Null/undefined means
   * the fields were unavailable, which is not the same as zero — a zero is a
   * fact ("we have sent nothing"), an absence is not.
   */
  engagementSent?: number | null;
  engagementOpened?: number | null;
  claims?: ReadonlyArray<{ kind: string; source: string }>;
  /** What research could not retrieve, as the brief recorded it. */
  missing?: readonly string[];
};

const clamp = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

const present = (v: unknown): boolean => typeof v === 'string' ? v.trim().length > 0 : v != null;

/**
 * A claim sourced from the web, not from the CRM mirror.
 * @param source
 */
const isExternal = (source: string): boolean => /^https?:\/\//i.test(source);

/**
 * Grade each dimension from the evidence the brief holds.
 *
 * Deliberately arithmetic and deliberately boring: every branch is a count of
 * things that either resolved or did not. Nothing here asks a model anything.
 * @param ev - The identity, acquisition and research evidence on the lead row.
 */
export function computeConfidenceDimensions(ev: ConfidenceEvidence): ConfidenceDimensions {
  const claims = ev.claims ?? [];
  const companyClaims = claims.filter(c => c.kind === 'company' || c.kind === 'signal');
  const externalCompanyClaims = companyClaims.filter(c => isExternal(c.source));

  // Identity — who is this person. Name, title, company name, and whether
  // anything outside the CRM confirmed the role.
  const identityFields = [ev.contactName, ev.contactTitle, ev.companyName].filter(present).length;
  const identityConfirmed = claims.some(c => isExternal(c.source));
  const identity: DimensionScore = {
    value: clamp(identityFields / 3 * (identityConfirmed ? 1 : 0.85)),
    basis: `${identityFields} of 3 identity fields on the CRM record${identityConfirmed ? ', confirmed outside it' : ', none confirmed outside it'}`,
  };

  // Acquisition — how they arrived. This is first-party and usually complete,
  // which is exactly why collapsing it into one number was misleading: it was
  // dragging a genuinely high reading down to meet a genuinely absent one.
  const acquisitionFields = [ev.entranceSource, ev.utmCampaign, ev.mqlAt ?? ev.arrivedAt].filter(present).length;
  const acquisition: DimensionScore = {
    value: clamp(acquisitionFields / 3),
    basis: `${acquisitionFields} of 3 acquisition facts recorded (source, campaign, date)`,
  };

  // Company understanding — do we know what they do. External corroboration
  // is what counts; the CRM's own company NAME is identity, not understanding.
  const company: DimensionScore = externalCompanyClaims.length === 0
    ? {
        value: companyClaims.length > 0 ? 0.2 : 0.05,
        basis: companyClaims.length > 0
          ? 'nothing about the company was retrieved outside the CRM record'
          : 'no verified statement of what the company does',
      }
    : {
        value: clamp(0.4 + Math.min(externalCompanyClaims.length, 3) * 0.2),
        basis: `${externalCompanyClaims.length} verified ${externalCompanyClaims.length === 1 ? 'statement' : 'statements'} about the company`,
      };

  // Engagement — UNAVAILABLE when the mirror returned nothing. A brief that
  // grades absent fields is a brief that will be quoted back as a fact.
  const engagementAvailable = ev.engagementSent != null || ev.engagementOpened != null;
  const engagement: DimensionScore = engagementAvailable
    ? {
        value: clamp((ev.engagementSent ?? 0) > 0 ? ((ev.engagementOpened ?? 0) > 0 ? 0.9 : 0.6) : 0.5),
        basis: `${ev.engagementSent ?? 0} sent, ${ev.engagementOpened ?? 0} opened on the CRM record`,
      }
    : {
        value: null,
        basis: 'the CRM returned no engagement fields — nothing can be inferred from their absence',
      };

  // Personalization fit — can we say something true and specific to THEM.
  // It is the floor of what identity and company understanding can carry,
  // because a confident identity with no company understanding still leaves
  // nothing specific to say. Engagement, being unavailable, is not in it.
  const fitValue = clamp(Math.min(identity.value ?? 0, company.value ?? 0) * 0.9 + (externalCompanyClaims.length > 0 ? 0.1 : 0));
  const personalizationFit: DimensionScore = {
    value: fitValue,
    basis: externalCompanyClaims.length > 0
      ? 'there is verified company detail an opening line can rest on'
      : 'no verified company detail — an opening line would have to be invented',
  };

  return { identity, acquisition, company, engagement, personalizationFit };
}

/** What kind of outreach the evidence can actually carry. */
export type OutreachPosture = 'personalized' | 'company-context' | 'curiosity';

export type PostureCall = {
  posture: OutreachPosture;
  /** One sentence, in the recommendation's own voice. */
  reason: string;
};

/** The cut point above which a dimension counts as established. */
export const ESTABLISHED = 0.55;

/**
 * Read the dimensions and say which kind of outreach the evidence supports.
 *
 * This is the reasoning the CEO asked for, made mechanical: *identity known,
 * company context insufficient, engagement unavailable → curiosity nurture,
 * not fabricated personalization.*
 * @param d - The computed dimensions.
 */
export function recommendedPosture(d: ConfidenceDimensions): PostureCall {
  const identityKnown = (d.identity.value ?? 0) >= ESTABLISHED;
  const companyKnown = (d.company.value ?? 0) >= ESTABLISHED;
  const fit = d.personalizationFit.value ?? 0;
  const engagementUnavailable = d.engagement.value === null;

  if (identityKnown && companyKnown && fit >= ESTABLISHED) {
    return {
      posture: 'personalized',
      reason: 'Identity and company context are both established, so the opening line can name something true about them.',
    };
  }
  if (identityKnown && companyKnown) {
    return {
      posture: 'company-context',
      reason: 'We know who they are and roughly what the company does, but nothing specific enough to open on — lead with the category, not with them.',
    };
  }
  return {
    posture: 'curiosity',
    reason: `Identity is ${identityKnown ? 'known' : 'thin'}, company context is insufficient${engagementUnavailable ? ', and engagement is unavailable' : ''} — ask an honest question rather than fabricate personalization.`,
  };
}

/**
 * The headline reading, derived from the dimensions rather than self-reported.
 *
 * Unavailable dimensions are LEFT OUT of the mean instead of counted as zero:
 * averaging in an absence is how one missing CRM field turned a brief that
 * knew four solid facts into "0.20 speculative".
 * @param d - The computed dimensions.
 */
export function headlineConfidence(d: ConfidenceDimensions): number {
  const graded = CONFIDENCE_DIMENSIONS.map(k => d[k].value).filter((v): v is number => v !== null);
  if (graded.length === 0) {
    return 0;
  }
  return clamp(graded.reduce((a, b) => a + b, 0) / graded.length);
}

/**
 * Dimensions the evidence could not grade at all — named once, for the brief.
 * @param d
 */
export function unavailableDimensions(d: ConfidenceDimensions): ConfidenceDimension[] {
  return CONFIDENCE_DIMENSIONS.filter(k => d[k].value === null);
}
