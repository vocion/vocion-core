import { NextResponse } from 'next/server';
import { apiRewriteDraft } from '@/services/writeApi';
import { authApi, isErrorResponse, readJsonBody, writeApiErrorResponse } from '../../_shared';

/**
 * POST /api/v1/reviews/rewrite
 *
 * Ask the model to rewrite a pending draft. Body: `{ id, hint? }`.
 *
 * The rewrite is returned, not saved — send it back through
 * `POST /api/v1/reviews/decide` as `editedInput` to adopt it. That way a client
 * can offer the reviewer a preview before anything changes.
 * Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
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
  try {
    return NextResponse.json(await apiRewriteDraft(caller, {
      id: Number(body.id),
      hint: typeof body.hint === 'string' ? body.hint : undefined,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
