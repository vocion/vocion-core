import type { ActivityRow } from './activityRows';
import { describe, expect, it } from 'vitest';
import { collapseActivity, previewActivity, repeatLabel } from './activityRows';

const at = (iso: string) => new Date(iso);
const row = (r: Partial<ActivityRow> & Pick<ActivityRow, 'kind' | 'id' | 'title' | 'at'>): ActivityRow => ({ status: null, detail: null, ...r });

describe('a feature\'s activity, in order (Chris, 2026-09-30, #269)', () => {
  const rows: ActivityRow[] = [
    row({ kind: 'conversation', id: 7, title: 'Requested in chat by Dana Okafor', at: at('2026-09-01T09:00:00Z'), origin: true }),
    row({ kind: 'mission_run', id: 21, title: 'Scheduled check: Every asker hears back', at: at('2026-09-02T08:00:00Z'), status: 'completed' }),
    row({ kind: 'worker_run', id: 435, title: 'Room PDF export', at: at('2026-09-02T09:00:00Z'), status: 'completed' }),
    row({ kind: 'mission_run', id: 22, title: 'Scheduled check: Every asker hears back', at: at('2026-09-02T10:00:00Z'), status: 'completed' }),
    row({ kind: 'mission_run', id: 30, title: 'Close the gap', at: at('2026-09-02T11:00:00Z'), status: 'completed' }),
    row({ kind: 'mission_run', id: 23, title: 'Scheduled check: Every asker hears back', at: at('2026-09-02T12:00:00Z'), status: 'failed' }),
  ];

  it('reads newest first, where it started closing the list, a repeated agent run as one row', () => {
    const out = collapseActivity(rows);

    expect(out.map(r => [r.kind, r.id, r.count ?? 1])).toEqual([
      ['mission_run', 23, 3],
      ['mission_run', 30, 1],
      ['worker_run', 435, 1],
      ['conversation', 7, 1],
    ]);
    // The newest run of the group is the row: its status, its time.
    expect(out[0]!.status).toBe('failed');
    expect(repeatLabel(out[0]!)).toBe('ran 3 times');
    expect(repeatLabel(out[1]!)).toBeNull();
    // The input is not changed.
    expect(rows.every(r => r.count === undefined)).toBe(true);
  });

  it('keeps the newest engineering run in the preview, in order, when newer agent runs would push it out', () => {
    const many = collapseActivity([
      ...rows,
      row({ kind: 'mission_run', id: 40, title: 'Show it first', at: at('2026-09-02T13:00:00Z') }),
    ]);
    const preview = previewActivity(many, 3);

    expect(preview.map(r => r.id)).toEqual([40, 23, 435]);
    expect(previewActivity(many.filter(r => r.kind !== 'worker_run'), 3).map(r => r.id)).toEqual([40, 23, 30]);
    expect(previewActivity(many.slice(0, 2), 3).map(r => r.id)).toEqual([40, 23]);
  });
});
