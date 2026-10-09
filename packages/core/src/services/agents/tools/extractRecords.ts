/**
 * extract_records — files a person dropped into the conversation become typed
 * records (`services/intake/intake.ts`).
 *
 * The agent chooses the type and names the data room the files are kept in,
 * from what the person said; the tool reads each file once (vision for an
 * image, the extracted text for a document), folds the same person read
 * twice, checks the workspace's records and CRM-synced contacts, and writes
 * what is clear — every value with the file, page and confidence it came from.
 *
 * What it could not settle is ONE Decision, raised here in the person's turn
 * ("2 unreadable · 3 already in HubSpot — merge?"): a requirement, so it is
 * structural rather than something the agent is asked to remember. Each
 * option runs `records.settle_intake` with the held items. Outside a person's
 * turn (a mission) the items come back in the result for the agent to file.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * The tool.
 * @param ctx - The turn.
 */
export function extractRecordsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { IntakeError, intakeDecision, intakeSources } = await import('@/services/intake/intake');
      let artifactIds: number[] | undefined;
      if (args.files?.length && ctx.conversationId) {
        // The model knows the files by name; the uploads are found by it here.
        const [{ and, eq }, { db }, { artifactSchema }] = await Promise.all([import('drizzle-orm'), import('@/libs/DB'), import('@/models/Schema')]);
        const rows = await db
          .select({ id: artifactSchema.id, title: artifactSchema.title })
          .from(artifactSchema)
          .where(and(eq(artifactSchema.orgId, ctx.orgId), eq(artifactSchema.conversationId, ctx.conversationId), eq(artifactSchema.kind, 'file'), eq(artifactSchema.lastAuthorKind, 'human')));
        const wanted = new Set(args.files.map(f => f.trim().toLowerCase()));
        artifactIds = rows.filter(r => wanted.has(r.title.trim().toLowerCase())).map(r => r.id);
        if (artifactIds.length === 0) {
          return `None of ${args.files.join(', ')} is a file dropped in this conversation. Files here: ${rows.map(r => r.title).join(', ') || 'none'}. Omit \`files\` to read every file not read yet.`;
        }
      }
      let result;
      try {
        result = await intakeSources({
          orgId: ctx.orgId,
          userId: ctx.userId ?? null,
          agentSlug: ctx.agentSlug ?? null,
          conversationId: ctx.conversationId ?? null,
          objectType: args.object_type,
          artifactIds,
          roomTitle: args.room,
          set: args.set,
          hint: args.hint,
          identity: args.identity,
          minConfidence: args.min_confidence,
        });
      } catch (err) {
        if (err instanceof IntakeError) {
          return `Nothing read: ${err.message}`;
        }
        throw err;
      }
      ctx.emit({ type: 'record_created', record: { type: 'object', id: String(result.room.id), label: result.room.title, href: result.room.href } });
      ctx.emit({ type: 'tool_progress', tool: 'extract_records', meta: { created: result.created.length, held: result.pending.length, roomId: result.room.id } } as never);

      const lines: string[] = [];
      const label = result.objectType.label;
      lines.push(`Read ${result.files - result.alreadyRead.length} of ${result.files} file${result.files === 1 ? '' : 's'} into ${label} records; the files are kept in [${result.room.title}](${result.room.href})${result.room.created ? ' (opened now)' : ''}.`);
      if (result.created.length > 0) {
        lines.push(`Added ${result.created.length}: ${result.created.map(c => `[${c.title}](${c.href})`).join(', ')}.`);
      }
      if (result.merged > 0) {
        lines.push(`${result.merged} reading${result.merged === 1 ? ' was' : 's were'} the same person seen twice, folded into one.`);
      }
      if (result.alreadyRead.length > 0) {
        lines.push(`Already read before, left alone: ${result.alreadyRead.map(a => a.file).join(', ')}.`);
      }
      if (result.ignoredSet.length > 0) {
        lines.push(`Not fields of ${label}, so not set: ${result.ignoredSet.join(', ')}.`);
      }
      lines.push('Every value on these records carries the file, page and confidence it came from (the record\'s provenance).');

      const decision = intakeDecision(result, { conversationId: ctx.conversationId ?? null });
      if (!decision) {
        return lines.join('\n');
      }
      if (ctx.conversationId && ctx.userId && !ctx.missionRunId) {
        const { raiseDecision } = await import('@/services/decisions/DecisionService');
        const { normaliseOptions } = await import('@/services/AskService');
        const { view } = await raiseDecision({
          orgId: ctx.orgId,
          conversationId: ctx.conversationId,
          ownerUserId: ctx.userId,
          agentSlug: ctx.agentSlug ?? null,
          kind: 'ruling',
          question: decision.question,
          body: decision.body,
          options: normaliseOptions(decision.options),
          allowOther: true,
          contextMd: decision.contextMd,
          sourceRef: decision.sourceRef,
          objectRefs: [{ type: 'object', id: String(result.room.id) }],
        });
        ctx.emit({ type: 'decision', decision: view });
        lines.push(`The rest is ONE decision docked above the person's composer: "${decision.question}" (decision #${view.id}). Your turn ends there; say in one line what you added and that the rest is on the card. Do not list the held items again.`);
        return lines.join('\n');
      }
      lines.push(`Held back for a person (${decision.question}):`);
      lines.push(decision.contextMd);
      lines.push(`File ONE ask for them with file_ask, with these options as given: ${JSON.stringify(decision.options)}.`);
      return lines.join('\n');
    },
    {
      name: 'extract_records',
      description: [
        'Turn files a person dropped into this conversation — photos of badges or business cards, PDFs, notes, spreadsheet exports — into records of an object type, with every value traced to the file, page and confidence it came from.',
        'Choose the type from what the person said (lookup_objects lists the types), name the data room the files are kept in from context (e.g. "Northwind Expo 2026 — badges"), and pass values every record shares in `set` (the event, who met them).',
        'People already on file (a record of the type, or a contact synced from the CRM — matched by email, then name plus company), records the reader was unsure of and unreadable files are NOT written: they come back as one Decision in front of the person, which ends your turn.',
        'Files already read into records are skipped, so calling it again after more files arrive reads only the new ones.',
      ].join(' '),
      schema: z.object({
        object_type: z.string().min(1).max(120).describe('The object type slug to file them as, e.g. "lead".'),
        room: z.string().min(2).max(200).describe('The data room the files are kept in: an open room with this title, or a new one.'),
        files: z.array(z.string().min(1).max(300)).max(60).optional().describe('Only these files, by the name they were dropped with. Omit to read every file in this conversation not read yet.'),
        set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Field values every record gets, from what the person said: {"event": "Northwind Expo 2026", "met_by": "Alex"}. Never over a value a file shows.'),
        hint: z.string().max(500).optional().describe('What the person said these files are, for the reader: "badges scanned at our booth; handwriting on the back is mine".'),
        identity: z.object({
          email: z.string().optional(),
          name: z.string().optional(),
          company: z.string().optional(),
        }).optional().describe('Which fields identify a record, when the type does not declare them (x-identity).'),
        min_confidence: z.number().min(0).max(1).optional().describe('Below this a value or record goes to the person. Default 0.6.'),
      }),
    },
  );
}
