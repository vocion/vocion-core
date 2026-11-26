import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aggregateListSchema, configureListSchema, createListSchema, ListValidationError, writeListSchema } from '@/libs/lists/spec';
import { installCrm } from '@/services/lists/crm';
import { aggregateList, configureList, createList, ListError, listLists, readList, writeListRecords } from '@/services/lists/service';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../_shared';

/**
 * List saved Lists or read one List with records and history.
 *
 * Requires a signed-in person; tenant tokens are rejected. Personal Lists are
 * owner-only. With no id, returns up to 50 Lists and nextOffset. With id, returns
 * up to 50 records, total, schema, current version and the latest 20 revisions.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Lists require a signed-in person', 403);
  }
  try {
    const url = new URL(req.url);
    const actor = { orgId: caller.orgId, userId: caller.actorId };
    const id = url.searchParams.get('id');
    const offset = z.coerce.number().int().min(0).parse(url.searchParams.get('offset') ?? 0);
    const result = id
      ? await readList(actor, { id, offset, view: url.searchParams.get('view') ?? undefined })
      : await listLists(actor, offset);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Create or update a List, aggregate records, or install the CRM starter.
 *
 * Requires a signed-in person; tenant tokens are rejected. The action is create,
 * write, configure, aggregate or crm. Writes and configuration require the latest
 * expectedVersion; conflicts return 409 without applying changes. Shared List
 * definitions and CRM installation require admin; members may edit shared records.
 * Follow-up rows do not send messages or schedule reminders.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  if (caller.source !== 'session') {
    return jsonError('FORBIDDEN', 'Lists require a signed-in person', 403);
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const actor = { orgId: caller.orgId, userId: caller.actorId };
  try {
    let result;
    switch (body.action) {
      case 'create': result = await createList(actor, createListSchema.parse(body));
        break;
      case 'write': result = await writeListRecords(actor, writeListSchema.parse(body));
        break;
      case 'configure': result = await configureList(actor, configureListSchema.parse(body));
        break;
      case 'aggregate': result = await aggregateList(actor, aggregateListSchema.parse(body));
        break;
      case 'crm': result = await installCrm(actor);
        break;
      default: throw new ListError('Unknown List action');
    }
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  if (error instanceof ListValidationError) {
    return jsonError('VALIDATION_FAILED', error.message, 400);
  }
  if (error instanceof ListError) {
    return jsonError('LIST_ERROR', error.message, error.status);
  }
  if (error instanceof z.ZodError) {
    return jsonError('VALIDATION_FAILED', error.issues.map(i => i.message).join('; '), 400);
  }
  // Do not send driver errors (which may contain SQL and values) to the browser.
  return jsonError('LIST_ERROR', 'The List could not be updated. Read it again and retry.', 500);
}
