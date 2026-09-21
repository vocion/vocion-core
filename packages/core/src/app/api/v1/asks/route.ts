import { NextResponse } from 'next/server';
import { isAskKind, isAskRisk, isAskStatusFilter, listAsks, normaliseObjectRefs, normaliseOptions, upsertAsk } from '@/services/AskService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination } from '../_shared';
import { askErrorResponse, optDate, optStr, withAskUrl, withAskUrls } from './_lib';

/**
 * GET /api/v1/asks?status=open|decided|all&source=<prefix>&agentSlug=&kind=&groupKey=&limit=&offset=
 *
 * What is waiting on a person. `status` defaults to `open`; `decided` is every
 * answered status, or name one exactly (`approved`, `rejected`, `done`,
 * `superseded`). `source` is a prefix match on `sourceRef`, so a filer reads
 * back only its own asks (`source=workforce:`). Newest first, with the real
 * total for the filters.
 * Auth: tenant API token or dashboard session.
 *
 * Query parameters:
 * - `status` — `open` (the default), `decided` for every answered status, or
 *   one exactly: `approved`, `rejected`, `done`, `superseded`.
 * - `source` — a prefix match on `sourceRef`, so a filer reads back only its
 *   own asks (`source=workforce:`).
 * - `agentSlug` — only the asks a given agent raised.
 * - `kind` — only the asks of one kind.
 * - `groupKey` — only the asks sharing one grouping key.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  const status = url.searchParams.get('status') ?? undefined;
  if (status !== undefined && !isAskStatusFilter(status)) {
    return jsonError('VALIDATION_FAILED', 'status must be open, decided, all, or one exact status', 400);
  }
  const kind = url.searchParams.get('kind') ?? undefined;
  if (kind !== undefined && !isAskKind(kind)) {
    return jsonError('VALIDATION_FAILED', 'kind must be one of approval|input|ruling|credential|merge|recommendation|gate', 400);
  }
  const page = await listAsks(caller.orgId, {
    status,
    kind,
    source: url.searchParams.get('source') ?? undefined,
    agentSlug: url.searchParams.get('agentSlug') ?? undefined,
    groupKey: url.searchParams.get('groupKey') ?? undefined,
    limit,
    offset,
  });
  return NextResponse.json({ ...page, items: await withAskUrls(caller.orgId, page.items) });
}

/**
 * POST /api/v1/asks
 *   { kind, title, body?, sourceRef?, agentSlug?, teamSlug?, risk?,
 *     options?: (string | { id, label, description?, recommended? })[],
 *     objectRefs?: { type, id }[], decisionCost?,
 *     groupKey?, groupTitle?, contextUrl?, contextMd?, dueAt?, notifyAt?, projectId? }
 *
 * File a question for a person. `options` may be bare strings (id = slug of
 * the label) or objects; at most one may be `recommended`. `objectRefs` names
 * the records the question is about (an object type slug and the object's
 * id); they ride the `ask.decided` event so the answer can be written back
 * onto them. `decisionCost` is the minutes of attention the decision is
 * estimated to take. `url` is accepted
 * as an alias of `contextUrl`. The reply's `ask.url` is the workspace-aware
 * link to decide it (`/w/<workspace>/dashboard/inbox/<id>`) — paste that, not a
 * bare `/dashboard/inbox` path. With a `sourceRef` this org has already filed,
 * the row is updated in place and the reply is 200 — only the fields present
 * in the request change (send `null` to clear one); status and decision are
 * never touched by a re-file. A new ask is 201.
 * Auth: tenant API token or dashboard session.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  if (!isAskKind(body.kind)) {
    return jsonError('VALIDATION_FAILED', 'kind must be one of approval|input|ruling|credential|merge|recommendation|gate', 400);
  }
  const title = optStr(body, 'title');
  if (!title) {
    return jsonError('VALIDATION_FAILED', 'title is required', 400);
  }
  const rawRisk = optStr(body, 'risk');
  if (rawRisk && !isAskRisk(rawRisk)) {
    return jsonError('VALIDATION_FAILED', 'risk must be low, medium or high', 400);
  }
  const dueAt = optDate(body, 'dueAt');
  if (isErrorResponse(dueAt)) {
    return dueAt;
  }
  const notifyAt = optDate(body, 'notifyAt');
  if (isErrorResponse(notifyAt)) {
    return notifyAt;
  }
  const decisionCost = 'decisionCost' in body ? body.decisionCost : undefined;
  if (decisionCost !== undefined && decisionCost !== null && (typeof decisionCost !== 'number' || !Number.isInteger(decisionCost) || decisionCost < 0)) {
    return jsonError('VALIDATION_FAILED', 'decisionCost must be a whole number of minutes, 0 or more', 400);
  }
  try {
    const { ask, created } = await upsertAsk({
      orgId: caller.orgId,
      createdBy: caller.actorId,
      ask: {
        kind: body.kind,
        title,
        // Absent keys stay `undefined` so a re-file touches only what it names.
        body: optStr(body, 'body'),
        sourceRef: optStr(body, 'sourceRef') ?? null,
        agentSlug: optStr(body, 'agentSlug'),
        teamSlug: optStr(body, 'teamSlug'),
        risk: rawRisk === undefined ? undefined : isAskRisk(rawRisk) ? rawRisk : null,
        options: 'options' in body ? normaliseOptions(body.options) : undefined,
        objectRefs: 'objectRefs' in body ? normaliseObjectRefs(body.objectRefs) : undefined,
        decisionCost: decisionCost === undefined ? undefined : (decisionCost as number | null),
        groupKey: optStr(body, 'groupKey'),
        groupTitle: optStr(body, 'groupTitle'),
        contextUrl: 'contextUrl' in body ? optStr(body, 'contextUrl') : optStr(body, 'url'),
        contextMd: optStr(body, 'contextMd'),
        dueAt,
        notifyAt,
        projectId: optStr(body, 'projectId'),
      },
    });
    return NextResponse.json({ ask: await withAskUrl(caller.orgId, ask), created }, { status: created ? 201 : 200 });
  } catch (error) {
    return askErrorResponse(error);
  }
}
