/**
 * Card specs — the typed payloads behind the first-party chat/canvas cards.
 *
 * Kept free of React so the `render_*` agent tools (server, no DOM) can
 * validate a payload with the exact schema the card will render with. The
 * card modules in `firstParty/` import these; the tools import these; the
 * `artifact.spec` column stores what passes them. One schema, three readers.
 */

import { z } from 'zod';
import { artifactHref } from '@/libs/tools/artifacts/url';

/** A cell value. Dates arrive as ISO strings; the table formats by column type. */
export const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CellValue = z.infer<typeof cellValueSchema>;

export const dataTableSpecSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.object({
    key: z.string().min(1),
    label: z.string().optional(),
    /** Drives alignment + formatting. `href` renders the cell as a link to another column's URL. */
    type: z.enum(['text', 'number', 'currency', 'percent', 'date', 'badge', 'link']).optional(),
    /** For `link` columns: the key of the column that holds the URL. */
    hrefKey: z.string().optional(),
  })).min(1).max(24),
  rows: z.array(z.record(z.string(), cellValueSchema)).max(2000),
  caption: z.string().optional(),
  /** Column key to sort by initially. */
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
export type DataTableSpec = z.infer<typeof dataTableSpecSchema>;

export const markdownSpecSchema = z.object({
  title: z.string().optional(),
  md: z.string().min(1).max(60_000),
  /** One line the log and an index show under the title — a wiki page's summary. */
  summary: z.string().max(200).optional(),
});
export type MarkdownSpec = z.infer<typeof markdownSpecSchema>;

export const chartSpecSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['line', 'bar', 'area']),
  /** Category / time labels along x, in order. */
  x: z.array(z.string()).min(1).max(400),
  /** One entry per series; `values` aligns with `x`. At most 8 (fixed categorical order). */
  series: z.array(z.object({
    name: z.string().min(1),
    values: z.array(z.number().nullable()),
  })).min(1).max(8),
  /** Unit rendered on the y axis and tooltips, e.g. "$", "%", "deals". */
  unit: z.string().optional(),
  /** Stack bars/areas instead of grouping. */
  stacked: z.boolean().optional(),
}).superRefine((spec, ctx) => {
  for (const [i, s] of spec.series.entries()) {
    if (s.values.length !== spec.x.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series', i, 'values'], message: `series "${s.name}" has ${s.values.length} values for ${spec.x.length} x labels` });
    }
  }
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const recordSpecSchema = z.object({
  /** Entity type label, e.g. "Deal", "Contact", "Agent", "Mission". */
  type: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1),
  /** In-app route (`/dashboard/...`) or an external URL. */
  href: z.string().optional(),
  fields: z.array(z.object({ k: z.string(), v: cellValueSchema })).max(24).default([]),
  /** One-line status shown as a pill. */
  status: z.string().optional(),
});
export type RecordSpec = z.infer<typeof recordSpecSchema>;

export const linkSpecSchema = z.object({
  href: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
export type LinkSpec = z.infer<typeof linkSpecSchema>;

/** File artifacts (the `create_artifact` path) — kept for completeness; rendered as a link card. */
export const fileSpecSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  url: z.string(),
});
export type FileSpec = z.infer<typeof fileSpecSchema>;

/**
 * A drafted outreach sequence — the sends, in order, with their cadence.
 *
 * TYPED, not markdown, and that is the point: the draft sequence is one of the
 * three artifacts the personalization lead page is built from
 * (`docs/specs/personalization-v2.md`), and its editor is the sequence editor
 * rather than a textarea. Adding it cost this descriptor plus one card —
 * design principle 7, "the next content type costs a descriptor, not a subsystem".
 */
export const sequenceSpecSchema = z.object({
  /** The CRM sequence the sends will be enrolled into, when one is chosen. */
  sequenceId: z.string().optional(),
  sequenceName: z.string().optional(),
  /** One sentence: why this sequence, given what the research found. */
  rationale: z.string().optional(),
  sends: z.array(z.object({
    step: z.number().int().positive(),
    /** Offset in days from enrollment, when the cadence is known. */
    day: z.number().int().nonnegative().optional(),
    subject: z.string(),
    body: z.string(),
  })).max(24),
});
export type SequenceSpec = z.infer<typeof sequenceSpecSchema>;

/**
 * One rendered sheet of a `document` artifact, as the render-verify loop
 * measured it. `footerY` is the footer rule's offset from the sheet top in CSS
 * px (null when the sheet has no `.foot`); every sheet in a healthy document
 * reports the same value, and one that reads higher or lower is overflowing.
 * `overflowPx` is how far the `.body` content runs past its box — the sheet
 * clips it silently, so this is the number a person cannot see.
 */
export const documentSheetAuditSchema = z.object({
  n: z.number().int().positive(),
  label: z.string().max(200).optional(),
  footerY: z.number().nullable(),
  overflowPx: z.number(),
  clipped: z.array(z.string().max(200)).max(12).default([]),
  /** Served URL of this sheet's PNG, when screenshots were taken. */
  image: z.string().optional(),
});
export type DocumentSheetAudit = z.infer<typeof documentSheetAuditSchema>;

/**
 * The verification a document carries with each version — what the loop
 * found, so the pane can say "13 sheets · footers aligned · PDF 13 pages"
 * and the agent can read the same facts back without re-rendering.
 */
export const documentVerificationSchema = z.object({
  at: z.string(),
  sheets: z.array(documentSheetAuditSchema).max(80),
  footerAligned: z.boolean(),
  pdfPages: z.number().int().nullable(),
  /** Served URL of the PDF the verification printed, when one was. */
  pdf: z.string().optional(),
  unresolvedAssets: z.array(z.string().max(300)).max(20).default([]),
  /**
   * Classes the markup uses that no rule in the document's own stylesheet
   * defines — the components that render as bare `<div>`s
   * (`libs/documents/classAudit.ts`).
   */
  undefinedClasses: z.array(z.string().max(80)).max(40).default([]),
  /**
   * Sheets carrying no component from the framework's declared vocabulary —
   * the walls of text (`libs/documents/componentAudit.ts`). A REPORT, never a
   * refusal: it is listed in the receipt and deliberately does not flip `ok`,
   * because the spine allows a sheet to be prose when prose is right.
   */
  proseSheets: z.array(z.object({ n: z.number().int(), label: z.string().max(120) })).max(40).default([]),
  issues: z.array(z.string().max(300)).max(40).default([]),
  ok: z.boolean(),
});
export type DocumentVerification = z.infer<typeof documentVerificationSchema>;

/** How hard a red-team finding pushes back: `block` is not sent. */
export const DOCUMENT_FINDING_SEVERITIES = ['block', 'fix', 'consider'] as const;
export type DocumentFindingSeverity = typeof DOCUMENT_FINDING_SEVERITIES[number];

/** One thing a sceptical buyer would stop on, with the sheet and the edit that answers it. */
export const documentRedTeamFindingSchema = z.object({
  sheet: z.number().int().min(0),
  severity: z.enum(DOCUMENT_FINDING_SEVERITIES),
  /** The rubric rule it breaks, in a few words: "outcome promised". */
  rule: z.string().min(1).max(80),
  /** What a buyer would read, quoting the sheet where it helps. */
  finding: z.string().min(1).max(400),
  /** The edit that answers it. */
  fix: z.string().min(1).max(300),
});
export type DocumentRedTeamFinding = z.infer<typeof documentRedTeamFindingSchema>;

/**
 * The red team a document carries, written the same way `verification` is:
 * onto the spec of the version that was read, so "has THIS version been read
 * as the buyer, and did it come back clean" is answerable from the row with
 * no model call — which is what the export gate asks
 * (`services/documents/exportGate.ts`).
 *
 * `version` is the artifact version whose HTML was read. Recording the read
 * is itself a version, like a render-verify, so the row that carries the
 * receipt is `version + 1`; the freshness test is therefore PRESENCE, not the
 * number. `documentSpec()` only carries the receipt forward when the HTML did
 * not change, so any edit drops it and the document is unread again.
 */
export const documentRedTeamSchema = z.object({
  at: z.string(),
  version: z.number().int().nonnegative(),
  /** The model that read it, so a receipt can say who said so. */
  model: z.string().max(120),
  /** How many sheets were read. */
  sheets: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  fixes: z.number().int().nonnegative(),
  considers: z.number().int().nonnegative(),
  /** The findings themselves, blocks first, capped so a spec stays a spec. */
  findings: z.array(documentRedTeamFindingSchema).max(20).default([]),
  /** What to keep, so the fixes do not erase it. */
  keeps: z.string().max(400).optional(),
});
export type DocumentRedTeam = z.infer<typeof documentRedTeamSchema>;

/**
 * A paginated, print-ready HTML document — US-Letter `.sheet`s that print to
 * the PDF a client reads. The HTML is self-contained (styles inline, assets as
 * data URIs); the engine (`libs/documents/`) renders, measures and prints it.
 * `sheets` is the count parsed at write time; `verification` is the last
 * render-verify pass over this exact version, and `redTeam` the last read of
 * it as the sceptical buyer.
 */
export const documentSpecSchema = z.object({
  title: z.string().optional(),
  html: z.string().min(1).max(1_500_000),
  sheets: z.number().int().nonnegative().optional(),
  /**
   * Which playbook shaped it — `proposal`, `scope`, `partnership-update`,
   * `email-copy`, `work-sample`… A tag the log filters on and a skill can
   * name; free text so a workspace's playbooks need no core change. It is
   * also what says whether the document is client-facing, and so whether the
   * export gate applies (`defaults.clientFacingPlaybooks`).
   */
  playbook: z.string().max(60).optional(),
  verification: documentVerificationSchema.optional(),
  redTeam: documentRedTeamSchema.optional(),
});
export type DocumentSpec = z.infer<typeof documentSpecSchema>;

export const ARTIFACT_KINDS = ['table', 'markdown', 'chart', 'record', 'link', 'file', 'sequence', 'document'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Card slug per artifact kind — the `__card` the canvas/chat resolve with. */
export const CARD_SLUG_FOR_KIND: Record<ArtifactKind, string> = {
  table: 'data-table',
  markdown: 'markdown',
  chart: 'chart',
  record: 'record',
  link: 'link',
  file: 'link',
  sequence: 'sequence',
  document: 'document',
};

export const SPEC_SCHEMA_FOR_KIND = {
  table: dataTableSpecSchema,
  markdown: markdownSpecSchema,
  chart: chartSpecSchema,
  record: recordSpecSchema,
  link: linkSpecSchema,
  file: fileSpecSchema,
  sequence: sequenceSpecSchema,
  document: documentSpecSchema,
} as const;

/**
 * Turn a stored artifact into the payload `resolveCard()` expects. File
 * artifacts render through the link card, so their spec is reshaped here.
 * @param kind
 * @param spec
 * @param artifactId - The row id, when the payload is for a stored artifact.
 */
export function cardPayloadFor(kind: ArtifactKind, spec: Record<string, unknown>, artifactId?: number): Record<string, unknown> {
  if (kind === 'document') {
    // The frame needs to know which artifact a selection is about; the row
    // id is not part of the spec, so it rides in under a reserved key.
    return { __card: CARD_SLUG_FOR_KIND[kind], ...spec, ...(artifactId ? { __artifactId: artifactId } : {}) };
  }
  if (kind === 'file') {
    const f = spec as Partial<FileSpec>;
    return { __card: 'link', href: artifactHref(f.url), title: f.filename ?? 'file', description: [f.contentType, f.bytes ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : null].filter(Boolean).join(' · ') };
  }
  return { __card: CARD_SLUG_FOR_KIND[kind], ...spec };
}
