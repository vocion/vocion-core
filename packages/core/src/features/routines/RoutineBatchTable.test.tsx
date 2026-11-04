import type { RoutineBatchView as Batch, RoutineRunView } from '@/libs/routines/types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import '@/styles/global.css';

/**
 * The live table under the answer that started a batch: one line per row, its
 * status as the run stands, its read-back once done, re-read while the batch
 * runs, and each line opening its run in the preview pane.
 */

const reads = vi.hoisted(() => ({ calls: 0, next: [] as unknown[], advance: false }));
const opened = vi.hoisted(() => [] as Array<{ type: string; id: string }>);

vi.mock('@/hooks/useLive', () => ({ useLive: () => ({ live: false, state: 'idle' }) }));
vi.mock('@/features/preview/previewState', async importOriginal => ({ ...(await importOriginal<object>()), openPreview: (ref: { type: string; id: string }) => opened.push(ref) }));
vi.mock('@/libs/Orpc', () => ({
  client: {
    routines: {
      batch: async () => {
        reads.calls += 1;
        return { batch: reads.advance && reads.next.length > 1 ? reads.next.shift() : reads.next[0] };
      },
    },
  },
}));

const { RoutineBatchTable } = await import('./RoutineBatchTable');

function run(n: number, name: string, over: Partial<RoutineRunView>): RoutineRunView {
  const email = `${name.split(' ')[0]!.toLowerCase()}@northwind.example`;
  return { id: 10 + n, batchId: 4, n, label: name, status: 'queued', input: { email, full_name: name, team: 'Ops' }, browserRunId: null, browser: null, waiting: null, receipt: null, summary: null, error: null, humanMs: 0, cents: 0, startedAt: null, endedAt: null, ...over };
}

const browser = (step: string) => ({ status: 'running', step, why: null, steps: 3, live: true, frameSeq: 1, url: null, finalShotUrl: null });

function batch(status: 'running' | 'done', runs: RoutineRunView[]): Batch {
  const counts = runs.reduce<Batch['counts']>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
  return {
    id: 4,
    routine: { id: 7, name: 'Add a user', version: 2, trust: 'approved', expert: 'Dana Reyes' },
    requestedBy: 'Chris',
    conversationId: null,
    status,
    counts,
    total: runs.length,
    cents: 0,
    humanMs: 0,
    manualMinutes: null,
    fields: { inputs: [{ name: 'email', key: true }, { name: 'full_name', key: false }], outputs: [{ name: 'user_email', checks: 'email' }] },
    startedAt: '2026-11-04T10:00:00Z',
    endedAt: status === 'done' ? '2026-11-04T10:05:00Z' : null,
    runs,
    findings: [],
    followUp: null,
    report: null,
  };
}

const done = (email: string): NonNullable<RoutineRunView['receipt']> => ({ requested: { email }, before: null, after: { user_email: email }, checks: [{ name: 'email', expected: email, actual: email, ok: true }], verified: true, approvedBy: 'the approved spec', at: '2026-11-04T10:02:00Z' });

describe('the batch table in chat', () => {
  it('draws one line per row, updates while the batch runs, and stops reading once it ends', async () => {
    reads.calls = 0;
    reads.next = [
      batch('running', [
        run(1, 'Avery Lin', { status: 'running', browserRunId: 51, browser: browser('Typed the email into Add user') }),
        run(2, 'Jordan Pike', { status: 'waiting', browserRunId: 52, waiting: { kind: 'question', text: 'Reactivate the old account?', options: ['Yes'], askId: 9 } }),
        run(3, 'Sam Okafor', { status: 'queued' }),
      ]),
      batch('done', [
        run(1, 'Avery Lin', { status: 'done', browserRunId: 51, receipt: done('avery@northwind.example') }),
        run(2, 'Jordan Pike', { status: 'escalated', browserRunId: 52, waiting: { kind: 'escalation', text: 'Two accounts share this email.', options: [], askId: 9 } }),
        run(3, 'Sam Okafor', { status: 'failed', browserRunId: 53, error: 'The console signed out mid-save.' }),
      ]),
    ];
    const screen = await render(<RoutineBatchTable batchId={4} />);
    const headers = () => [...screen.container.querySelectorAll('th')].map(th => th.textContent);

    await expect.element(screen.getByText('Typed the email into Add user')).toBeVisible();
    await expect.element(screen.getByText('Reactivate the old account?')).toBeVisible();
    // The label already names the person; the email tells rows apart; the team is the same everywhere.
    expect(headers()).toEqual(['Row', 'Email', 'Status']);

    // The next read: the batch ended.
    reads.advance = true;

    await expect.element(screen.getByText('Done · verified')).toBeVisible();
    await expect.element(screen.getByText('Escalated to Dana')).toBeVisible();
    await expect.element(screen.getByText('The console signed out mid-save.')).toBeVisible();
    expect(headers()).toEqual(['Row', 'Email', 'Status', 'User email']);
    expect(screen.container.querySelector('[data-routine-batch-table="4"]')?.getAttribute('data-batch-status')).toBe('done');

    const after = reads.calls;
    await new Promise(r => setTimeout(r, 3500));

    expect(reads.calls).toBe(after);

    await screen.getByRole('button', { name: 'Sam Okafor' }).click();

    expect(opened.at(-1)).toEqual({ type: 'browser_run', id: '53' });
  });
});
