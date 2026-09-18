/**
 * The audit — turning what the renderer measured into a verdict and a
 * receipt. Pure: the renderer hands over numbers, this decides what they
 * mean, and the tests can drive every branch without a browser.
 *
 * The rules are the ones the hand-run loop learned (capability brief
 * D-1-002): footers audited numerically, not by eye — every sheet's rule sits
 * at the same y or one of them is overflowing; content that runs past the
 * sheet is clipped silently, so the number has to be printed; and the PDF's
 * page count has to equal the sheet count, or a sheet broke across pages.
 */

import type { DocumentSheetAudit, DocumentVerification } from '@/libs/cards/specs';

/** Footer rules within this many CSS px of each other count as aligned (the cover's `.fsplit` note shifts it ~2px). */
export const FOOTER_TOLERANCE_PX = 3;

export type MeasuredSheet = Omit<DocumentSheetAudit, 'image'> & { image?: string };

export type AuditInput = {
  sheets: MeasuredSheet[];
  pdfPages: number | null;
  pdf?: string;
  unresolvedAssets: string[];
  at?: string;
};

/**
 * The most common footer y across sheets that have one — the value the
 * others are measured against. Sheets vote so one broken page cannot move the
 * baseline.
 * @param sheets
 */
export function footerBaseline(sheets: ReadonlyArray<Pick<MeasuredSheet, 'footerY'>>): number | null {
  const votes = new Map<number, number>();
  for (const s of sheets) {
    if (s.footerY === null) {
      continue;
    }
    const key = Math.round(s.footerY);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [y, n] of votes) {
    if (n > bestN) {
      best = y;
      bestN = n;
    }
  }
  return best;
}

/**
 * Decide. Every finding is one plain sentence naming the sheet, so the model
 * can act on it and a person can check it against the screenshot.
 * @param input
 */
export function evaluateDocument(input: AuditInput): DocumentVerification {
  const issues: string[] = [];
  const baseline = footerBaseline(input.sheets);
  let footerAligned = true;
  for (const s of input.sheets) {
    const where = s.label ? `Sheet ${s.n} (${s.label})` : `Sheet ${s.n}`;
    if (s.footerY === null) {
      footerAligned = false;
      issues.push(`${where} has no footer.`);
    } else if (baseline !== null && Math.abs(s.footerY - baseline) > FOOTER_TOLERANCE_PX) {
      footerAligned = false;
      issues.push(`${where}: footer rule at ${Math.round(s.footerY)}px, the other sheets sit at ${baseline}px — the footer is not pinned or the sheet is a different size.`);
    }
    if (s.overflowPx > 0) {
      issues.push(`${where} overflows by ${Math.round(s.overflowPx)}px — content runs under the footer and is clipped. Trim the content, never the footer reserve.`);
    }
    if (s.clipped.length > 0) {
      // One line per sheet: the first few offenders, and how many more. Twelve
      // near-identical paragraphs is one fact — the sheet is too long.
      const shown = s.clipped.slice(0, 3).join('; ');
      const more = s.clipped.length > 3 ? ` and ${s.clipped.length - 3} more` : '';
      issues.push(`${where}: ${shown}${more} extend${s.clipped.length === 1 && !more ? 's' : ''} past the sheet edge.`);
    }
  }
  if (input.pdfPages !== null && input.pdfPages !== input.sheets.length) {
    issues.push(`The PDF has ${input.pdfPages} pages for ${input.sheets.length} sheets — a sheet is taller than one page or the @page size is off.`);
  }
  if (input.unresolvedAssets.length > 0) {
    issues.push(`${input.unresolvedAssets.length} asset${input.unresolvedAssets.length === 1 ? '' : 's'} did not load (${input.unresolvedAssets.slice(0, 4).join(', ')}${input.unresolvedAssets.length > 4 ? ', …' : ''}). Inline logos as data URIs; a relative path has nothing to resolve against.`);
  }
  if (input.sheets.length === 0) {
    issues.push('No `.sheet` elements were found — the document is not paginated.');
  }
  return {
    at: input.at ?? new Date().toISOString(),
    sheets: input.sheets.map(s => ({ ...s, clipped: s.clipped.slice(0, 12) })),
    footerAligned,
    pdfPages: input.pdfPages,
    ...(input.pdf ? { pdf: input.pdf } : {}),
    unresolvedAssets: input.unresolvedAssets.slice(0, 20),
    issues: issues.slice(0, 40),
    ok: issues.length === 0,
  };
}

/**
 * The receipt the agent reads back — the whole audit in a few lines, with the
 * screenshot URLs so a vision-capable step can look at any sheet it doubts.
 * @param v
 * @param opts
 * @param opts.images - Include one line per sheet with its image URL.
 */
export function verificationReceipt(v: DocumentVerification, opts: { images?: boolean } = {}): string {
  const baseline = footerBaseline(v.sheets);
  const head = [
    `${v.sheets.length} ${v.sheets.length === 1 ? 'sheet' : 'sheets'}`,
    v.footerAligned ? `footers aligned${baseline === null ? '' : ` at ${baseline}px`}` : 'footers NOT aligned',
    v.pdfPages === null ? (v.pdf ? 'PDF printed · page count unavailable' : 'PDF not printed') : `PDF ${v.pdfPages} ${v.pdfPages === 1 ? 'page' : 'pages'}`,
    v.ok ? 'no issues' : `${v.issues.length} ${v.issues.length === 1 ? 'issue' : 'issues'}`,
  ].join(' · ');
  const lines = [head];
  for (const issue of v.issues) {
    lines.push(`- ${issue}`);
  }
  if (opts.images) {
    for (const s of v.sheets) {
      if (s.image) {
        lines.push(`  sheet ${s.n}${s.label ? ` (${s.label})` : ''}: ${s.image}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * A one-line state for the pane header: "13 sheets · verified" / "13 sheets · 2 issues".
 * @param v
 * @param sheetCount
 */
export function verificationChip(v: DocumentVerification | undefined, sheetCount: number | undefined): string {
  const n = v?.sheets.length ?? sheetCount;
  const count = n === undefined ? '' : `${n} ${n === 1 ? 'sheet' : 'sheets'}`;
  if (!v) {
    return count ? `${count} · not verified` : 'not verified';
  }
  const state = v.ok ? 'verified' : `${v.issues.length} ${v.issues.length === 1 ? 'issue' : 'issues'}`;
  return count ? `${count} · ${state}` : state;
}
