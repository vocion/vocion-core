import { NextResponse } from 'next/server';
import openApiDocument from '@/libs/openapi/openapi.generated.json';
import { authApi, isErrorResponse } from '../_shared';

/**
 * GET /api/v1/openapi
 *
 * The OpenAPI 3.1 description of this API, as JSON — the same document the
 * Developers → API reference page renders, for Postman, an SDK generator, or
 * any other tool that reads a spec.
 *
 * It is generated from the route handlers by `npm run openapi:generate` and
 * committed, so what is served here is a static file rather than a walk of the
 * filesystem: production runs a bundle where `src/` does not exist.
 *
 * Authenticated like every other endpoint. The document names no records and
 * no credentials, but it does map this deployment's whole surface, which is
 * not something to hand to an anonymous caller.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  return NextResponse.json(openApiDocument);
}
