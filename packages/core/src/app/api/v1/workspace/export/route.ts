import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { zipWorkspace } from '@/libs/workspace/archive';
import { exportWorkspace } from '@/services/workspace/WorkspaceExportService';
import { authApi, isErrorResponse, requireWorkspaceAdmin } from '../../_shared';

/**
 * GET /api/v1/workspace/export — this workspace as a zip of its files.
 *
 * Every kind the loader reads, in the layout `workspace:apply` takes: agents,
 * teams, skills and playbooks with their bodies, missions, automations,
 * workflows, object types, connectors, eval datasets, learning steps, trust
 * rules, voice, operating intent, pages, brand, plugins and settings. Each
 * file is the authored one wherever it still says what runs, and is written
 * from what is running wherever it does not (a resource changed or added in
 * the app). `EXPORT.md` at the root says which, and what an export never
 * carries: credentials, connector logins, records, conversations and history.
 *
 * Import it into another workspace with `POST /api/v1/workspace/import`, or
 * apply the unzipped folder with `workspace:apply`.
 *
 * Workspace admins only: the export is the whole workspace's configuration.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'export the workspace');
  if (denied) {
    return denied;
  }
  const exported = await exportWorkspace(caller.orgId);
  const root = `${exported.project.slug}-workspace`;
  const zip = zipWorkspace(exported.files, root);
  logger.info('workspace exported', { orgId: caller.orgId, actorId: caller.actorId, files: exported.files.length, fromRows: exported.report.fromRows.length, problems: exported.report.problems.length });
  return new NextResponse(new Blob([zip as BlobPart], { type: 'application/zip' }), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${root}-${exported.exportedAt.toISOString().slice(0, 10)}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
