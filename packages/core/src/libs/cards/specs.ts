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
 * MANIFESTO §7, "the next content type costs a descriptor, not a subsystem".
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

export const ARTIFACT_KINDS = ['table', 'markdown', 'chart', 'record', 'link', 'file', 'sequence'] as const;
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
};

export const SPEC_SCHEMA_FOR_KIND = {
  table: dataTableSpecSchema,
  markdown: markdownSpecSchema,
  chart: chartSpecSchema,
  record: recordSpecSchema,
  link: linkSpecSchema,
  file: fileSpecSchema,
  sequence: sequenceSpecSchema,
} as const;

/**
 * Turn a stored artifact into the payload `resolveCard()` expects. File
 * artifacts render through the link card, so their spec is reshaped here.
 * @param kind
 * @param spec
 */
export function cardPayloadFor(kind: ArtifactKind, spec: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'file') {
    const f = spec as Partial<FileSpec>;
    return { __card: 'link', href: artifactHref(f.url), title: f.filename ?? 'file', description: [f.contentType, f.bytes ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : null].filter(Boolean).join(' · ') };
  }
  return { __card: CARD_SLUG_FOR_KIND[kind], ...spec };
}
