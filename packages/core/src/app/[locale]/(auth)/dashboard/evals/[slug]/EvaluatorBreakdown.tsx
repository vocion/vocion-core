import type { EvaluatorSummary } from './evalTrend';
import { ChevronRight } from 'lucide-react';
import { formatPassRate } from '@/libs/evals/formatPassRate';

/**
 * Per-evaluator scores for the period, as a table under the pass-rate chart.
 *
 * These used to be a dashed line each on the chart itself, which with four
 * AgentCore evaluators and a Vocion judge put seven overlapping lines and a
 * three-row legend on one axis. A table answers the same question — which
 * part of the score moved — with every name readable, and stays closed until
 * someone asks for it.
 */

const DIRECTION_COPY: Record<EvaluatorSummary['direction'], { arrow: string; words: string }> = {
  up: { arrow: '▲', words: 'above its average' },
  down: { arrow: '▼', words: 'below its average' },
  flat: { arrow: '–', words: 'about its average' },
};

/**
 * @param props - Props.
 * @param props.rows - One per evaluator, from `summariseEvaluators`.
 * @param props.showGrader - Whether more than one grader ran evaluators, so the column earns its place.
 */
export function EvaluatorBreakdown(props: { rows: EvaluatorSummary[]; showGrader: boolean }) {
  if (props.rows.length === 0) {
    return null;
  }
  return (
    <details className="group rounded-xl border border-border bg-background" data-testid="evaluator-breakdown">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
        <span>
          <span className="font-display text-sm font-semibold">Evaluator breakdown</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {`Which part of the score moved · ${props.rows.length} evaluator${props.rows.length === 1 ? '' : 's'}`}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Evaluator</th>
              {props.showGrader && <th scope="col" className="px-4 py-2 font-medium">Grader</th>}
              <th scope="col" className="px-4 py-2 text-right font-medium">Latest</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Average</th>
              <th scope="col" className="px-4 py-2 font-medium" title="The latest score against this evaluator's average for the period">Latest vs average</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {props.rows.map(row => (
              <tr key={`${row.provider}:${row.evaluatorSlug}`}>
                <td className="px-4 py-2 font-mono text-foreground">{row.evaluatorSlug}</td>
                {props.showGrader && <td className="px-4 py-2 text-muted-foreground">{row.providerLabel}</td>}
                <td className="px-4 py-2 text-right font-mono text-foreground">{formatPassRate(row.latest)}</td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">{formatPassRate(row.average)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  <span aria-hidden className="mr-1">{DIRECTION_COPY[row.direction].arrow}</span>
                  {`${DIRECTION_COPY[row.direction].words} (${row.runs} run${row.runs === 1 ? '' : 's'})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
