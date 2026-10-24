/**
 * chart Card — a chart from `render_chart`, drawn by the chart engine
 * (`libs/charts`): stacked, grouped and 100% bars, lines and areas with a
 * forecast segment, waterfalls, targets and a "today" marker, laid out at the
 * card's own width so it reads on a phone. The same spec draws inside a
 * document's chart block and on a deck slide. See docs/guides/charts.md.
 */

import type { ChartSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { ChartView } from '@/libs/charts/ChartView';
import { chartSpecSchema } from '../specs';

export const CHART_SLUG = 'chart';

export function ChartCardView({ data, surface }: { data: ChartSpec; surface: string }) {
  return <ChartView spec={data} dense={surface !== 'artifact'} />;
}

export const chartCard = defineCard({
  slug: CHART_SLUG,
  name: 'Chart',
  description: 'Renders a chart from the chart engine as inline SVG: bars (grouped, stacked, 100%), lines and areas with a forecast segment, or a waterfall, with up to eight series on one y axis, targets and a today marker. Use for change over time, composition over time, or magnitude across categories. Not for a single headline number (say it in text).',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: chartSpecSchema,
  Renderer: ({ data, surface }) => <ChartCardView data={data} surface={surface} />,
});
