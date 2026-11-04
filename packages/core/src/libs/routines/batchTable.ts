/**
 * A BATCH AS A TABLE — one line per row, for the live table under the answer
 * that started it (`features/routines/RoutineBatchTable`). Pure and
 * client-safe, so what a row says is tested from fixtures.
 *
 * Its columns come from the automation's own spec (`RoutineBatchView.fields`),
 * never from a list in core: the row's label, the inputs that tell rows apart,
 * where the run stands, and what it read back once done. Less evidence makes a
 * smaller table: an input every row shares, or one the label already says, is
 * not a column; an output is a column once some row has read it back.
 */

import type { RoutineTone } from './display';
import type { RoutineBatchView, RoutineRunView } from './types';
import { RUN_STATUS } from './display';

/** The most input columns a line carries beside its label. */
const MAX_INPUTS = 3;

/** Where one row stands: its dot, its word, and the line under it (the step, the question, the error). */
export type RowStatus = { tone: RoutineTone; word: string; pulse: boolean; detail: string | null };

/** One cell of what a row read back: its text, and whether its read-back check failed. */
export type ResultCell = { text: string; off: boolean };

export type BatchTable = {
  /** Input names shown beside the label, key inputs first. */
  inputs: string[];
  /** Output names shown as result columns; empty when no row has read one back yet. */
  outputs: string[];
  /** A single "Result" column of each settled row's summary, when no output column has a value. */
  summary: boolean;
  rows: Array<{ run: RoutineRunView; inputs: string[]; status: RowStatus; results: ResultCell[]; result: string | null }>;
};

const firstLine = (s: string | null | undefined): string | null => (s ? s.split('\n')[0]!.trim() || null : null);

/**
 * Where one run stands, in the words its line shows.
 * @param run - The run.
 * @param expert - The automation's expert, for "Escalated to Dana".
 */
export function rowStatus(run: RoutineRunView, expert: string | null): RowStatus {
  const s = RUN_STATUS[run.status];
  const base = { tone: s.tone, word: s.word, pulse: s.pulse };
  switch (run.status) {
    case 'running':
      return { ...base, word: 'Working', detail: run.browser?.step ?? 'Opening the browser' };
    case 'waiting':
      return { ...base, detail: firstLine(run.waiting?.text) };
    case 'escalated':
      return { ...base, word: expert ? `Escalated to ${expert.split(' ')[0]}` : s.word, detail: firstLine(run.waiting?.text) };
    case 'done':
      if (run.receipt && !run.receipt.verified) {
        return { tone: 'fail', word: 'Done · did not read back', pulse: false, detail: null };
      }
      return { ...base, word: run.receipt ? 'Done · verified' : s.word, detail: null };
    case 'failed':
    case 'unknown_outcome':
      return { ...base, detail: firstLine(run.error ?? run.summary) };
    case 'skipped':
      return { ...base, detail: firstLine(run.summary) };
    default:
      return { ...base, detail: null };
  }
}

/**
 * A read-back value as a cell shows it.
 * @param v - The value.
 */
function cellText(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return JSON.stringify(v);
}

/**
 * The batch as its table draws it.
 * @param batch - The batch, as `routineReads.getBatch` reads it.
 */
export function batchTable(batch: Pick<RoutineBatchView, 'runs' | 'fields' | 'routine'>): BatchTable {
  const runs = batch.runs;
  const value = (r: RoutineRunView, name: string) => (r.input[name] ?? '').trim();
  const inputs = [...batch.fields.inputs]
    .sort((a, b) => Number(b.key) - Number(a.key))
    .map(i => i.name)
    .filter((name) => {
      const values = runs.map(r => value(r, name));
      if (values.every(v => v === '')) {
        return false;
      }
      // The same for every row: it says nothing about the row.
      if (runs.length > 1 && values.every(v => v === values[0])) {
        return false;
      }
      // Already in the label of every row that has it.
      return !runs.every((r, i) => values[i] === '' || r.label.toLowerCase().includes(values[i]!.toLowerCase()));
    })
    .slice(0, MAX_INPUTS);

  const outputs = batch.fields.outputs.filter(o => runs.some(r => cellText(r.receipt?.after[o.name]) !== ''));
  const summary = outputs.length === 0 && runs.some(r => r.status === 'done' && r.summary);

  return {
    inputs,
    outputs: outputs.map(o => o.name),
    summary,
    rows: runs.map(r => ({
      run: r,
      inputs: inputs.map(name => value(r, name)),
      status: rowStatus(r, batch.routine.expert),
      results: outputs.map((o) => {
        const check = o.checks ? r.receipt?.checks.find(c => c.name === o.checks) : undefined;
        return { text: cellText(r.receipt?.after[o.name]), off: Boolean(check && !check.ok && !check.waived) };
      }),
      result: summary && r.status === 'done' ? r.summary : null,
    })),
  };
}

/**
 * A column name as a header reads it: "full_name" → "Full name".
 * @param name - The input or output name.
 */
export function columnLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
