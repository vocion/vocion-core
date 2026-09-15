import { NextResponse } from 'next/server';
import { isAskKind, isAskRisk, isAskStatusFilter, listAsks, normaliseOptions, upsertAsk } from '@/services/AskService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination } from '../_shared';
import { askErrorResponse, optDate, optStr } from './_lib';

/**
 * GET /api/v1/asks?status=open|decided|all&source=<prefix>&agentSlug=&kind=&groupKey=&limit=&offset=
 *
 * What is waiting on a person. `status` defaults to `open`; `decided` is every
 * answered status, or name one exactly (`approved`, `rejected`, `done`,
 * `superseded`). `source` is a prefix match on `sourceRef`, so a filer reads
 * back only its own asks (`source=workforce:`). Newest first, with the real
 * total for the filters.
 * Auth: tenant API token or dashboard session.
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
  return NextResponse.json(await listAsks(caller.orgId, {
    status,
    kind,
    source: url.searchParams.get('source') ?? undefined,
    agentSlug: url.searchParams.get('agentSlug') ?? undefined,
    groupKey: url.searchParams.get('groupKey') ?? undefined,
    limit,
    offset,
  }));
}

/**
 * POST /api/v1/asks
 *   { kind, title, body?, sourceRef?, agentSlug?, teamSlug?, risk?,
 *     options?: (string | { id, label, description?, recommended? })[],
 *     groupKey?, groupTitle?, contextUrl?, contextMd?, dueAt?, notifyAt?, projectId? }
 *
 * File a question for a person. `options` may be bare strings (id = slug of
 * the label) or objects; at most one may be `recommended`. `url` is accepted
 * as an alias of `contextUrl`. With a `sourceRef` this org has already filed,
 * the open row is updated in place and the reply is 200 — status and decision
 * are never touched by a re-file. A new ask is 201.
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
  try {
    const { ask, created } = await upsertAsk({
      orgId: caller.orgId,
      createdBy: caller.actorId,
      ask: {
        kind: body.kind,
        title,
        body: optStr(body, 'body') ?? null,
        sourceRef: optStr(body, 'sourceRef') ?? null,
        agentSlug: optStr(body, 'agentSlug') ?? null,
        teamSlug: optStr(body, 'teamSlug') ?? null,
        risk: isAskRisk(rawRisk) ? rawRisk : null,
        options: normaliseOptions(body.options),
        groupKey: optStr(body, 'groupKey') ?? null,
        groupTitle: optStr(body, 'groupTitle') ?? null,
        contextUrl: optStr(body, 'contextUrl') ?? optStr(body, 'url') ?? null,
        contextMd: optStr(body, 'contextMd') ?? null,
        dueAt,
        notifyAt,
        projectId: optStr(body, 'projectId') ?? null,
      },
    });
    return NextResponse.json({ ask, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return askErrorResponse(error);
  }
}
