/**
 * `/rpc/sources/import-template` — download the CSV template for one connector.
 *
 *   GET ?kind=web → text/csv attachment, header row plus one example row.
 *
 * The template is generated from the connector's own `bulkImport` descriptor
 * rather than checked in as a file, so a column added to a connector cannot
 * drift out of sync with the template the operator is told to fill in.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { buildImportTemplate, importTemplateFileName } from '@/libs/sources/bulkImport';
import { getConnector } from '@/libs/sources/registry';

export async function GET(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const kind = new URL(req.url).searchParams.get('kind');
  if (!kind) {
    return Response.json({ error: 'Missing kind' }, { status: 400 });
  }

  const connector = getConnector(kind);
  if (!connector) {
    return Response.json({ error: `Unknown source connector: ${kind}` }, { status: 400 });
  }
  if (!connector.bulkImport) {
    return Response.json({ error: `${connector.name} sources cannot be imported from a file.` }, { status: 400 });
  }

  return new Response(buildImportTemplate(connector), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${importTemplateFileName(connector)}"`,
      // The template changes whenever the connector's columns do, and it is
      // cheap to build, so nothing downstream should hold an old copy.
      'Cache-Control': 'no-store',
    },
  });
}
