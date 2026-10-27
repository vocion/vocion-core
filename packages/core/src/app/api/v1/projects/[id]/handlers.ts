import type { NextRequest } from 'next/server';
import type { ApiCaller } from '@/services/writeApi';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exportDataRoom, getDataRoom, unfileFromDataRoom, updateDataRoom } from '@/services/DataRoomService';

/**
 * What `/api/v1/projects/:id` and the older `/api/v1/rooms/:id` both answer,
 * for a caller the route already authenticated. Two paths, one behaviour:
 * projects were called data rooms until 2026-10-27, and links and tokens
 * written against the old path keep working.
 */

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, { status: 404 });

function projectIdOf(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The project as JSON.
 * @param caller - The authenticated caller.
 * @param rawId - The `:id` segment.
 */
export async function readProject(caller: ApiCaller, rawId: string): Promise<Response> {
  const id = projectIdOf(rawId);
  const room = id ? await getDataRoom(caller.orgId, id) : null;
  return room ? NextResponse.json(room) : notFound();
}

const PatchSchema = z.object({
  notes: z.string().max(60_000).optional(),
  rules: z.array(z.string().max(300)).max(60).optional(),
  autoFile: z.boolean().optional(),
});

/**
 * A person editing the project's wiki, instructions or auto-filing from its page.
 * @param caller - The authenticated caller.
 * @param rawId - The `:id` segment.
 * @param req - The request, for its JSON body.
 */
export async function patchProject(caller: ApiCaller, rawId: string, req: NextRequest): Promise<Response> {
  const id = projectIdOf(rawId);
  if (!id) {
    return notFound();
  }
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.issues.map(i => i.message).join('; ') } }, { status: 400 });
  }
  const current = await getDataRoom(caller.orgId, id);
  if (!current) {
    return notFound();
  }
  const { notes, rules, autoFile } = parsed.data;
  const room = await updateDataRoom(caller.orgId, id, {
    ...(notes === undefined ? {} : { notes }),
    // Instructions are replaced as a whole from the page: the textarea is the list.
    ...(rules === undefined ? {} : { removeRules: current.meta.rules ?? [], addRules: rules }),
    ...(autoFile === undefined ? {} : { autoFile }),
  });
  return NextResponse.json(room);
}

/**
 * Take a source out of a project (`?document=<id>` or `?artifact=<id>`).
 * @param caller - The authenticated caller.
 * @param rawId - The `:id` segment.
 * @param req - The request, for its query string.
 */
export async function unfileProjectSource(caller: ApiCaller, rawId: string, req: NextRequest): Promise<Response> {
  const id = projectIdOf(rawId);
  const url = new URL(req.url);
  const documentId = Number(url.searchParams.get('document') ?? '');
  const artifactId = Number(url.searchParams.get('artifact') ?? '');
  if (!id || (!(documentId > 0) && !(artifactId > 0))) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Name the project and a document or artifact' } }, { status: 400 });
  }
  const out = await unfileFromDataRoom(caller.orgId, id, {
    ...(documentId > 0 ? { documentId } : {}),
    ...(artifactId > 0 ? { artifactId } : {}),
  });
  if (!out) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No such source on this project' } }, { status: 404 });
  }
  return NextResponse.json({ removed: out.removed, sources: out.room.meta.sources?.length ?? 0 });
}

/**
 * The whole project as one markdown file, the LLM-context bundle.
 * @param caller - The authenticated caller.
 * @param rawId - The `:id` segment.
 */
export async function exportProject(caller: ApiCaller, rawId: string): Promise<Response> {
  const id = projectIdOf(rawId);
  const room = id ? await getDataRoom(caller.orgId, id) : null;
  const md = room && id ? await exportDataRoom(caller.orgId, id) : null;
  if (!room || md === null) {
    return notFound();
  }
  const filename = `${room.title.replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'project'} - context.md`;
  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
