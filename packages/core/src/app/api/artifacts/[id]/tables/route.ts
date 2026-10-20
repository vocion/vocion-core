import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { exportFilename, extractTables, toCsv, toXlsx } from '@/libs/artifacts/tableExport';
import { db } from '@/libs/DB';
import { canOpenArtifact } from '@/libs/share/audience';
import { artifactSchema } from '@/models/Schema';
import { callerOrgFor } from '../_serve';

const noStore = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }, { status: 404, headers: noStore });

/**
 * `GET /api/artifacts/:id/tables?format=xlsx|csv[&table=N]` — an artifact's
 * tables as a spreadsheet (`libs/artifacts/tableExport.ts`).
 *
 * `xlsx` (the default) is one sheet per table, named by the heading above it;
 * `csv` is one table, the first unless `table` (0-based) names another. Who
 * may download is exactly who may open the artifact: the same caller rules as
 * `/api/artifacts/:id` (a session or `vcn_live_` token in the artifact's org,
 * or a `?share=` token while it is shared with anyone), then its audience.
 * @param req
 * @param ctx
 * @param ctx.params
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return notFound();
  }
  const caller = await callerOrgFor(req, id);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, Number(id)));
  if (!row || row.orgId !== caller.orgId) {
    return notFound();
  }
  if (!canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId ?? null }, { userId: caller.userId, hasToken: caller.hasToken, isMember: true })) {
    return notFound();
  }
  const tables = extractTables({ kind: row.kind, title: row.title, spec: row.spec });
  if (tables.length === 0) {
    return NextResponse.json({ error: { code: 'NO_TABLES', message: `“${row.title}” has no tables to export.` } }, { status: 422, headers: noStore });
  }
  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\'')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  if (format === 'csv') {
    const index = Number(req.nextUrl.searchParams.get('table') ?? 0);
    const table = Number.isInteger(index) ? tables[index] : undefined;
    if (!table) {
      return NextResponse.json({ error: { code: 'NO_SUCH_TABLE', message: `There are ${tables.length} tables; table must be 0–${tables.length - 1}.` } }, { status: 400, headers: noStore });
    }
    const name = exportFilename(tables.length > 1 ? `${row.title} - ${table.name}` : row.title, 'csv');
    return new Response(toCsv(table), { status: 200, headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(name) } });
  }
  const body = await toXlsx(tables);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...noStore,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition(exportFilename(row.title, 'xlsx')),
    },
  });
}
