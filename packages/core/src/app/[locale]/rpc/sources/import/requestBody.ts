/**
 * Shared request parsing for the two import routes.
 *
 * Both take the same body — the connector slug plus the file as text — and both
 * have to reject the same shapes of nonsense. Reading it in one place keeps the
 * two routes from disagreeing about what a valid request is.
 */

/** The file size the route refuses outright, before any parsing. */
import { MAX_IMPORT_BYTES } from '@/libs/sources/bulkImport';

export type ImportRequest
  = | { kind: string; csvText: string; error: null }
    | { kind: ''; csvText: ''; error: string };

/**
 * Read `{ kind, csv }` off a request, or say what is wrong with it.
 * @param req - The incoming request.
 */
export async function readImportRequest(req: Request): Promise<ImportRequest> {
  let body: { kind?: unknown; csv?: unknown };
  try {
    body = await req.json();
  } catch {
    return { kind: '', csvText: '', error: 'Bad JSON' };
  }

  if (typeof body.kind !== 'string' || body.kind.length === 0) {
    return { kind: '', csvText: '', error: 'Missing kind' };
  }
  if (typeof body.csv !== 'string' || body.csv.trim().length === 0) {
    return { kind: '', csvText: '', error: 'Missing csv' };
  }
  if (new TextEncoder().encode(body.csv).length > MAX_IMPORT_BYTES) {
    return { kind: '', csvText: '', error: `That file is larger than the ${Math.round(MAX_IMPORT_BYTES / 1_048_576)} MB limit.` };
  }

  return { kind: body.kind, csvText: body.csv, error: null };
}
