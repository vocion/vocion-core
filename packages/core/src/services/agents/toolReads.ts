/**
 * What a tool reads, declared beside it — so the access log covers every
 * record-reading tool without the recorder naming any of them.
 *
 * A tool states it once, the way it states its argument repair
 * (`withArgumentRepair`):
 *
 *   declareReads(tool(...), { kind: 'hubspot_company', idArg: 'company_id' });
 *
 * and the tool-call recorder (`withToolCallRecord`) writes the row after any
 * call that returned: one `view` of the record the arguments name, or one
 * `search` when the declaration names no id argument. A tool that knows more
 * than its arguments do — the id it resolved, the hits it found, that it found
 * nothing at all — calls `noteRead` itself and declares `'noted'`; the
 * recorder then writes nothing of its own. Either way the read is attributed
 * to the acting agent, the run and whom it was for, by the scope the recorder
 * opened.
 *
 * `registry.reads.test.ts` walks the whole registry and fails on any tool that
 * declares nothing and is not on its short list of tools that read no record,
 * so a new tool is unaudited only if someone says so in review.
 */

import type { AccessAction, AccessRead } from '@/services/access/accessLog';

export type ToolReads
  /** The tool calls `noteRead` itself with what it found. */
  = | 'noted'
    | {
      /**
       * What one call reads: the record vocabulary (`object`, `artifact`,
       * `document`) where the tool reads one of ours, else the connector's own
       * noun (`hubspot_company`, `tracker_issue`) — never content.
       */
      kind: string;
      /**
       * The argument(s) naming the one record read; several are joined with
       * `:` (a repository and a pull request number). Absent for a search or a
       * listing.
       */
      idArg?: string | readonly string[];
      /** Defaults to `view` with an id argument, `search` without. */
      action?: AccessAction;
    };

const READS = Symbol.for('vocion.toolReads');

/**
 * Declare what a tool reads. Returns the tool, so it wraps a constructor call.
 * @param toolObj - The tool.
 * @param reads - What a call reads.
 */
export function declareReads<T extends object>(toolObj: T, reads: ToolReads): T {
  (toolObj as Record<symbol, unknown>)[READS] = reads;
  return toolObj;
}

/**
 * What a tool declared it reads; undefined when it declared nothing.
 * @param toolObj - The tool.
 */
export function readsOf(toolObj: object): ToolReads | undefined {
  return (toolObj as Record<symbol, ToolReads | undefined>)[READS];
}

/**
 * The read a declaration makes of one call's arguments, or null for a tool
 * that notes its own reads.
 * @param reads - The declaration.
 * @param args - The call's arguments, as the model sent them (repaired).
 */
export function declaredRead(reads: ToolReads, args: Record<string, unknown>): AccessRead | null {
  if (reads === 'noted') {
    return null;
  }
  const idArgs: readonly string[] = typeof reads.idArg === 'string' ? [reads.idArg] : (reads.idArg ?? []);
  const parts = idArgs
    .map(name => args[name])
    .filter((v): v is string | number => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v)))
    .map(v => String(v).trim());
  return {
    action: reads.action ?? (idArgs.length > 0 ? 'view' : 'search'),
    record: { kind: reads.kind, id: parts.length > 0 ? parts.join(':') : null },
  };
}
