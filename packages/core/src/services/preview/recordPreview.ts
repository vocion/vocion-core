import type { PreviewFact } from '@/libs/preview/types';
import type { PageRow } from '@/libs/workspace/pageFields';
import { declaredRecordFields, recordSections } from '@/libs/workspace/records';

/**
 * A BUSINESS OBJECT, PREVIEWED AS ITSELF.
 *
 * Journey 4 (2026-09-28): the chat filed request #214 and linked it; the
 * link opened the preview pane, which read "approved · No text was synced
 * for this reference". The object descriptor showed a record's `status`
 * column and its `summary`, and a request has no summary — its words live in
 * `outcome`, `story` and `acceptance`. So the pane was empty over a full
 * record.
 *
 * The type already says what its record carries and how to read it
 * (`x-display` on `type.yaml`, read by `libs/workspace/records.ts` for the
 * record page). The preview reads the same declaration: the prose fields, in
 * the type's own order, are the body — a list field as a list — and the
 * short facts, badges first, are the header. One reading of a record, two
 * surfaces; any object type that declares its fields previews with them.
 */

/** Facts past this many are the record page's job. */
const MAX_FACTS = 6;
/** A fact longer than this is not a glance. */
const MAX_FACT_CHARS = 80;

function itemText(item: unknown): string {
  if (item === null || item === undefined) {
    return '';
  }
  if (typeof item !== 'object') {
    return String(item).trim();
  }
  const o = item as Record<string, unknown>;
  for (const key of ['statement', 'text', 'title', 'label', 'name', 'summary']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) {
      const met = o.met === true ? ' — met' : o.met === false ? ' — not met' : '';
      return `${v.trim()}${met}`;
    }
  }
  return JSON.stringify(item);
}

function scalarText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(itemText).filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (typeof value === 'object') {
    return null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * The preview's facts and body for one record, read from its type's schema.
 * @param row - The record, in the page-row shape (`meta` is its metadata).
 * @param schema - Its type's JSON Schema (`business_object_type.schema`), or null.
 */
export function recordPreviewParts(row: PageRow, schema: unknown): { facts: PreviewFact[]; body: string } {
  const fields = declaredRecordFields(schema);
  const sections = recordSections(row, fields);
  const blocks: string[] = [];
  for (const f of sections.prose) {
    const value = row.meta[f.key];
    if (Array.isArray(value)) {
      const items = value.map(itemText).filter(Boolean);
      if (items.length > 0) {
        blocks.push(`**${f.label ?? f.key}**\n\n${items.map(i => `- ${i}`).join('\n')}`);
      }
      continue;
    }
    const text = scalarText(value);
    if (text) {
      blocks.push(`**${f.label ?? f.key}**\n\n${text}`);
    }
  }
  // A type that declares no prose still reads: its long strings are its words.
  if (blocks.length === 0) {
    for (const f of fields) {
      const v = row.meta[f.key];
      if (typeof v === 'string' && v.trim().length > MAX_FACT_CHARS) {
        blocks.push(`**${f.label ?? f.key}**\n\n${v.trim()}`);
      }
    }
  }
  const factFields = sections.facts.flatMap(g => g.fields);
  const ordered = [...factFields.filter(f => f.format === 'badge'), ...factFields.filter(f => f.format !== 'badge')];
  const facts: PreviewFact[] = [];
  for (const f of ordered) {
    const v = scalarText(row.meta[f.key]);
    if (v && v.length <= MAX_FACT_CHARS && f.format !== 'money' && f.format !== 'mono') {
      facts.push({ label: f.label ?? f.key, value: v });
    }
    if (facts.length >= MAX_FACTS) {
      break;
    }
  }
  return { facts, body: blocks.join('\n\n') };
}

/**
 * What the link to a record's page says: the page it opens ("Open feature"
 * for `/dashboard/p/feature/214`), else the record.
 * @param href - The record's page, from `recordHref`.
 */
export function openRecordLabel(href: string): string {
  const page = /\/dashboard\/p\/([\w-]+)\/\d+/.exec(href);
  return page ? `Open ${page[1]!.replace(/[-_]+/g, ' ')}` : 'Open record';
}
