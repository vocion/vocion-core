/**
 * export_artifact_xlsx — an artifact's tables as a spreadsheet, filed beside it.
 *
 * The agent's half of the header's "Download as Excel" (`libs/artifacts/
 * tableExport.ts`): when a person asks for the numbers in a spreadsheet, the
 * agent hands them the file instead of retyping a table into chat.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { exportArtifactXlsx } from '@/services/artifacts/tableExport';
import { toPayload } from '@/services/ArtifactService';
import { openArtifactId } from './editArtifacts';
import { authorOf } from './renderArtifacts';

export function exportArtifactXlsxTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const id = args.id ?? openArtifactId(ctx);
      if (!id) {
        return 'Name the artifact to export: its id, or open it beside the conversation.';
      }
      try {
        const res = await exportArtifactXlsx({ orgId: ctx.orgId, id, author: authorOf(ctx), conversationId: ctx.conversationId ?? null, visibility: ctx.missionRunId ? 'system' : 'user' });
        ctx.emit({ type: 'artifact', artifact: toPayload(res.file) });
        return `Spreadsheet ready: ${res.filename} (${res.sheets.length} ${res.sheets.length === 1 ? 'sheet' : 'sheets'}: ${res.sheets.join('; ')}) at ${res.url}. Numbers are numbers, so it sums and charts in Excel or Google Sheets. It is filed beside the artifact as a file artifact.`;
      } catch (err) {
        return `Could not export the spreadsheet: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'export_artifact_xlsx',
      description: 'Export the tables in a document or table artifact to an Excel workbook (.xlsx, one sheet per table, numbers kept numeric), filed as a file artifact. Use when the person asks for the numbers in a spreadsheet, Excel or Google Sheets. Omit `id` for the open artifact.',
      schema: z.object({
        id: z.number().int().positive().optional(),
      }),
    },
  );
}
