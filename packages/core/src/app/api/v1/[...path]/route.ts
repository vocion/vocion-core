import type { NextRequest } from 'next/server';
import { dispatchV1Request } from './dispatch';
import { V1_ROUTES } from './routeTable.generated';

/**
 * The one route entry for every `/api/v1/...` request (#1598).
 *
 * The 114 handlers live in `../_routes/`, a private folder Next does not route,
 * and this hands each request to the one Next would have picked
 * (`dispatch.ts`). One entry instead of 114 cut about 1.9 to 3.5 GiB of peak
 * build memory; `../README.md` explains the pattern and how to add a handler.
 */

/**
 * Route segment config for every v1 handler: Next reads it from this file only.
 * `dynamic` keeps the live stream (`_routes/live`) uncached; `maxDuration` is
 * the longest any handler needs (`_routes/objects/[id]/analyze`), a limit
 * deployment platforms read from the build output.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** What Next passes this catch-all: the path below `/api/v1`, one decoded segment each. */
type CatchAllContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'GET', request, (await context.params).path);
}

export async function HEAD(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'HEAD', request, (await context.params).path);
}

export async function OPTIONS(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'OPTIONS', request, (await context.params).path);
}

export async function POST(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'POST', request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'PUT', request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'DELETE', request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: CatchAllContext): Promise<Response> {
  return dispatchV1Request(V1_ROUTES, 'PATCH', request, (await context.params).path);
}
