/**
 * The Engines page as the server renders it: the side-by-side table with a
 * column per engine, the controls, the runs with their links and reasons, and
 * a clear empty state when there are no runs yet.
 */
import type { EngineRunRow } from '@/services/factory/engineRun';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readEnginesQuery } from './engineBoard';
import { EnginesView } from './EnginesView';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, scroll: _s, ...rest }: { href: string; children: unknown; scroll?: boolean }) => createElement('a', { href, ...rest }, children as never),
  useRouter: () => ({ push: () => undefined }),
}));

const since = new Date('2026-09-23T00:00:00Z');
const row = (over: Partial<EngineRunRow> = {}): EngineRunRow => ({
  id: 1,
  orgId: 'org_k',
  source: 'factory',
  workerRunId: 41,
  evalKey: null,
  engine: 'openhands',
  model: 'model-large',
  seat: 'task-engineer',
  routePolicy: 'static',
  routeReason: 'the task-engineer seat\'s harness.engine',
  taskId: 9,
  requestId: 7,
  repo: 'kestrel/app',
  baseBranch: 'dev',
  riskClass: 'ui',
  status: 'completed',
  startedAt: new Date('2026-10-22T17:00:00Z'),
  endedAt: new Date('2026-10-22T17:04:05Z'),
  durationS: 245,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cents: 123,
  prUrl: 'https://github.example/kestrel/app/pull/3',
  checksPassed: 2,
  checksTotal: 2,
  qaVerdict: 'approve',
  accepted: true,
  merged: true,
  reverted: false,
  outcome: 'merged',
  attempt: 1,
  retries: 0,
  guardViolations: 0,
  filesTouched: 2,
  linesAdded: 10,
  linesRemoved: 1,
  complexity: 'small',
  createdAt: new Date('2026-10-22T17:00:00Z'),
  updatedAt: new Date('2026-10-22T17:05:00Z'),
  ...over,
});

const render = (params: Record<string, string>, rows: EngineRunRow[]) => renderToStaticMarkup(createElement(EnginesView, {
  slug: 'engines',
  query: readEnginesQuery(params),
  engines: rows.length ? [{ engine: 'openhands', source: 'factory', runs: 1, running: 0, prs: 1, qaPassed: 1, qaFailed: 0, accepted: 0, merged: 1, reverted: 0, failed: 0, prRate: 1, qaPassRate: 1, acceptRate: 1, medianDurationS: 245, totalCents: 123, centsPerLanded: 123, guardViolations: 0, retries: 0, models: ['model-large'], byComplexity: { small: 1 } }] : [],
  rows,
  since,
  timezone: 'America/Los_Angeles',
}));

describe('the Engines page', () => {
  it('puts the engines side by side, claude-cli beside openhands even with no runs', () => {
    const html = render({}, [row()]);

    expect(html).toContain('Side by side');
    expect(html.indexOf('>claude-cli<')).toBeLessThan(html.indexOf('>openhands<'));
    expect(html).toContain('No claude-cli runs yet in this window.');
    expect(html).toContain('Cost per landed change');
    expect(html).toContain('$1.23');
  });

  it('offers the window and source, with the one in force pressed', () => {
    const html = render({ days: '7' }, [row()]);

    expect(html).toMatch(/aria-pressed="true"[^>]*>7 days/);
    expect(html).toContain('Real work');
    expect(html).toContain('Eval');
  });

  it('lists each run with its seat, repo, outcome, time, cost, reason and links', () => {
    const html = render({}, [row()]);

    expect(html).toContain('task-engineer');
    expect(html).toContain('kestrel/app');
    expect(html).toContain('Merged');
    expect(html).toContain('4m 05s');
    expect(html).toContain('the task-engineer seat&#x27;s harness.engine');
    expect(html).toContain('href="https://github.example/kestrel/app/pull/3"');
    expect(html).toContain('href="/dashboard/objects/9"');
    expect(html).toContain('href="/dashboard/p/runs/41"');
    expect(html).toContain('Oct 22, 10:00');
  });

  it('says plainly when there is nothing yet', () => {
    const html = render({ engine: 'openhands' }, []);

    expect(html).toContain('data-testid="engines-empty"');
    expect(html).toContain('No openhands runs in the last 30 days');
  });
});
