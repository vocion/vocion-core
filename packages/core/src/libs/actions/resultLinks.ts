/**
 * WHAT A RUN MADE, AS LINKS.
 *
 * Chris, 2026-09-29, after approving a re-dispatch: "I also expected a path
 * to open #205, but didn't get that link in the action card, chat, or on the
 * review detail page after completed." An executed action's result already
 * names what it made — the request it planned, the task it created, the
 * engineering run it started, the ask it filed, the PR it opened — and every
 * surface that says "done" should let a person open it in one move
 * (principle 10: show your work).
 *
 * One reader for every action, over the result's top-level keys, so the next
 * action that returns a `taskId` or a `url` is linked with no code of its own
 * (principle 7: the next kind costs nothing). Nested keys (`previousTask`,
 * `supersededPlan`…) are what the run replaced, never what it made, so they
 * are not read. The chat card's settled state and the review receipt both
 * draw these (`review.actionStatus`, the inbox detail page).
 *
 * Pure and client-safe; the caller hands in the workspace's record linker so
 * a request opens on its feature page, not the generic record.
 */

import type { TypeCodes } from '@/libs/codes';
import type { RecordLinker } from '@/libs/workspace/recordHref';
import { nounCode, recordCode } from '@/libs/codes';
import { inboxHref } from '@/services/inbox/inboxRef';

export type ResultLink = {
  /** "FE-201", "RUN-355", "Pull request" — what a person reads each by (`libs/codes.ts`). */
  label: string;
  /** Relative for an in-app page; absolute for an external one. */
  href: string;
  /** Opens outside the app (a PR, a deploy URL). */
  external?: boolean;
  /**
   * What it is, as a preview ref — so a surface can open it in the preview
   * pane and follow its status (`preview.status`). Absent on an external link.
   */
  ref?: { type: 'worker_run' | 'object' | 'ask' | 'artifact'; id: string };
};

type Meta = Record<string, unknown>;

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function words(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').trim();
}

/**
 * A record as a preview ref — the business-object preview, whatever its type.
 * @param _type - The object type slug (the preview reads it off the row).
 * @param id - Its id.
 */
function recordRef(_type: string, id: number): NonNullable<ResultLink['ref']> {
  return { type: 'object', id: String(id) };
}

/** Result key → the object type its id names. First key present wins per type. */
const RECORD_KEYS: ReadonlyArray<{ key: string; type: string; noun: string }> = [
  { key: 'requestId', type: 'request', noun: 'request' },
  { key: 'createdTaskId', type: 'engineering_task', noun: 'task' },
  { key: 'taskId', type: 'engineering_task', noun: 'task' },
  { key: 'planId', type: 'architecture_plan', noun: 'plan' },
];

/**
 * A record's name in words: the page the workspace opens it on names it
 * ("feature" for a request on `/p/feature/…`), else the plain noun. So the
 * words follow the workspace, and one thing has one name everywhere.
 * @param href - Where it opens.
 * @param fallback - The noun when no page names it.
 */
function nounFor(href: string, fallback: string): string {
  const page = /\/p\/([^/]+)\/[^/]+$/.exec(href)?.[1];
  return page ? decodeURIComponent(page).replace(/[-_]+/g, ' ') : fallback;
}

/** Result keys that carry an external URL, in the order they are preferred. */
const URL_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'prUrl', label: 'Pull request' },
  { key: 'resultUrl', label: 'Result' },
  { key: 'url', label: 'Open' },
];

/**
 * The links for one done run, most specific first, each target once.
 * @param run - The run.
 * @param run.actionId - Its action; a type equal to it is not a record type.
 * @param run.input - What it was asked to do (names the object type for `objectId`).
 * @param run.result - What it returned.
 * @param link - Where a record opens in this workspace.
 * @param codes - The workspace's type codes, so a record reads FE-201; absent, it reads by its page's noun.
 */
export function resultLinks(run: { actionId: string; input: Meta | null; result: Meta | null }, link: RecordLinker, codes?: TypeCodes): ResultLink[] {
  const result = run.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return [];
  }
  const input = run.input ?? {};
  const out: ResultLink[] = [];
  const seen = new Set<string>();
  const named = (href: string, type: string, noun: string, id: number) => (codes ? recordCode(codes, type, id) : `${nounFor(href, noun)} #${id}`);
  const push = (l: ResultLink) => {
    if (!seen.has(l.href)) {
      seen.add(l.href);
      out.push(l);
    }
  };

  // The engineering run it started is what moves next: first.
  const workerRunId = positiveInt(result.workerRunId);
  if (workerRunId !== null) {
    push({ label: nounCode('run', workerRunId), href: `/dashboard/p/runs/${workerRunId}`, ref: { type: 'worker_run', id: String(workerRunId) } });
  }

  // The record it made or changed (`objects.*` return `objectId` / `id`).
  const objectId = positiveInt(result.objectId) ?? positiveInt(result.id);
  const objectType = typeof result.objectType === 'string' ? result.objectType : typeof input.objectType === 'string' ? input.objectType : null;
  if (objectId !== null && objectType && objectType !== run.actionId) {
    const href = link({ objectType, id: objectId });
    push({ label: named(href, objectType, words(objectType), objectId), href, ref: recordRef(objectType, objectId) });
  }

  const types = new Set<string>();
  for (const { key, type, noun } of RECORD_KEYS) {
    const id = positiveInt(result[key]);
    if (id !== null && !types.has(type)) {
      types.add(type);
      const href = link({ objectType: type, id });
      push({ label: named(href, type, noun, id), href, ref: recordRef(type, id) });
    }
  }

  const askId = positiveInt(result.askId);
  if (askId !== null) {
    push({ label: nounCode('ask', askId), href: inboxHref('ask', askId), ref: { type: 'ask', id: String(askId) } });
  }

  const artifactId = positiveInt(result.artifactId);
  if (artifactId !== null) {
    push({ label: nounCode('artifact', artifactId), href: `/dashboard/artifacts/${artifactId}`, ref: { type: 'artifact', id: String(artifactId) } });
  }

  for (const { key, label } of URL_KEYS) {
    const url = result[key];
    if (typeof url === 'string' && /^https?:\/\//.test(url.trim())) {
      push({ label, href: url.trim(), external: true });
      break;
    }
  }
  return out;
}
