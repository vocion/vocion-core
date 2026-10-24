/**
 * The chart review — the model judges its own chart, as drawn on a phone.
 *
 * After `render_chart` (or a chart edit) draws a chart, the tool hands the
 * model what the layout did at a phone's width, 390px: the form it took,
 * what was wrapped, cut or skipped, what was folded into "Other", which
 * values ended up as slivers too small to read, and the analyst's signals
 * (`checks.ts`). With one short question: does it answer what you were asked,
 * do the numbers that matter read, is it the right form? The model revises
 * once if it judges it should, and only then (`revised` says so on the next
 * receipt, so a revision is not a loop).
 *
 * A summary of the drawing, not a picture of it: a tool result here is text,
 * on every provider and on the AgentCore path, and a trace keeps it. What a
 * picture would show the model — a bar it cannot see, a label it cannot read
 * — is measured in the layout, so it is said in px.
 */

import type { ChartIssue } from './checks';
import type { LayoutFacts } from './layout';
import type { ChartSpec } from './spec';
import { checkChart } from './checks';
import { layoutChart } from './layout';

/** A phone's width: where a chart has the least room. */
export const REVIEW_WIDTH = 390;

export type ChartReview = { facts: LayoutFacts; signals: ChartIssue[]; width: number; height: number; text: string };

function list(xs: readonly string[], n = 4): string {
  const quoted = xs.slice(0, n).map(x => `"${x}"`).join(', ');
  return xs.length > n ? `${quoted} and ${xs.length - n} more` : quoted;
}

/**
 * What the layout did, in short lines: the form, the bars, the labels, the
 * folding, and the values too small to read.
 * @param facts - The layout's facts.
 * @param opts - Options.
 * @param opts.brief - Only what changed the chart or hides a value (a document's notes), not the bar widths and wrapping.
 */
export function factNotes(facts: LayoutFacts, opts: { brief?: boolean } = {}): string[] {
  const notes: string[] = [];
  if (facts.split) {
    notes.push(`Drawn as the summary bridge, then its last ${facts.split.steps} steps rescaled (${facts.split.from} to ${facts.split.to}), because at one scale they were slivers.`);
  }
  if (facts.autoHorizontal) {
    notes.push('Turned horizontal: the category names did not fit under vertical bars.');
  }
  if (facts.minBar > 0 && !opts.brief) {
    notes.push(`Narrowest bar ${facts.minBar}px${facts.directLabels ? '; every value is labelled on its bar' : ''}.`);
  }
  if (facts.wrapped.length && !opts.brief) {
    notes.push(`${facts.wrapped.length} name${facts.wrapped.length === 1 ? '' : 's'} on two lines.`);
  }
  if (facts.shortened.length) {
    notes.push(`Cut short to fit: ${list(facts.shortened)}.`);
  }
  if (facts.skipped > 0 && !opts.brief) {
    notes.push(`${facts.skipped} period label${facts.skipped === 1 ? '' : 's'} left out to fit (the latest is always shown).`);
  }
  if (facts.folded.length) {
    notes.push(`Folded into "Other" (past eight series): ${list(facts.folded)}.`);
  }
  if (facts.illegible.length) {
    notes.push(`Too small to read, with no label: ${facts.illegible.slice(0, 5).map(v => `${v.label} (${v.value}, ${v.px}px)`).join(', ')}.`);
  }
  return notes;
}

/**
 * Review a chart as it draws on a phone.
 * @param spec - A spec that passed `chartSpecSchema` and has no refusals.
 * @param opts - Options.
 * @param opts.width - The width to review at (a phone's, by default).
 * @param opts.revised - This is the model's revision: say so, and that one is enough.
 * @param opts.withImage - The picture goes with this review (`toolResultImages.ts`).
 */
export function reviewChart(spec: ChartSpec, opts: { width?: number; revised?: boolean; withImage?: boolean } = {}): ChartReview {
  const width = opts.width ?? REVIEW_WIDTH;
  const scene = layoutChart(spec, { width });
  const { signals } = checkChart(spec);
  const lines = [
    opts.withImage
      ? `Review at a phone's width (${width}px): the image below is the chart as drawn there, ${scene.width}×${scene.height}px. Look at it.`
      : `Review at a phone's width (${width}px; a summary of the layout, not an image): ${scene.width}×${scene.height}px.`,
    ...factNotes(scene.facts).map(n => `- ${n}`),
    ...signals.map(s => `- [${s.rule}] ${s.message}`),
    opts.revised
      ? 'This is your revision. Do not revise it again unless the person asks; if a limit above remains, say it in one line.'
      : 'Judge it against what you were asked: does this chart answer it, do the numbers that matter read, is it the right form? If not, revise it once with update_artifact (the form, the series, the title). If it does, go on and do not mention this review.',
  ];
  return { facts: scene.facts, signals, width: scene.width, height: scene.height, text: lines.join('\n') };
}
