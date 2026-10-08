/**
 * The tracker family's reads — the connected issue tracker, live.
 *
 * The knowledge index mirrors one document per issue: key, summary, status,
 * description. It holds no comments, no attachments, no links and no
 * transitions, and it is an hour old. A seat that writes a contract from an
 * issue, judges a change against the acceptance a client wrote in a comment,
 * or draws from a screenshot a client attached reads the issue here instead.
 *
 * Present for any agent whose `connectorSources` include a tracker source
 * (`familyInScope`); the provider is the source's (`services/tracker/provider.ts`),
 * never named by the agent. Writes are actions (`tracker.*`) through
 * `propose_action`, so the trust ladder, the ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope } from '@/libs/connectors/families';

export const READ_ISSUE_TOOL = 'tracker_read_issue';
export const SEARCH_ISSUES_TOOL = 'tracker_search_issues';
export const READ_ATTACHMENT_TOOL = 'tracker_read_attachment';

/** Text a model can read inline; anything longer is cut once. */
const TEXT_MAX = 60_000;
const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|x-yaml|yaml|csv))/i;

export function trackerTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'tracker')) {
    return [];
  }
  return [readIssueTool(ctx), searchIssuesTool(ctx), readAttachmentTool(ctx)];
}

function readIssueTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { trackerProviderFor } = await import('@/services/tracker/provider');
        const provider = await trackerProviderFor(ctx.orgId, { issueKey: args.key });
        const issue = await provider.readIssue(args.key.trim().toUpperCase());
        return JSON.stringify({ ok: true, tracker: provider.kind, issue, note: 'To change it, propose_action one of tracker.transition_issue, tracker.update_issue, tracker.comment, tracker.attach_file with this key.' });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_ISSUE_TOOL,
      description: 'One issue on the connected issue tracker (Jira or Linear), read live: summary, description, status and its category, type, priority, labels, assignee, reporter, dates, fix versions, every comment, the attachments (ids to read with tracker_read_attachment), linked issues, and the status transitions available from where it stands. Use it before writing a contract from an issue, judging against acceptance a client wrote on it, or answering on it.',
      schema: z.object({ key: z.string().min(3).max(40).describe('The issue key, e.g. NOCO-123.') }),
    },
  );
}

function searchIssuesTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { trackerProviderFor } = await import('@/services/tracker/provider');
        const provider = await trackerProviderFor(ctx.orgId, { sourceSlug: args.source ?? null });
        const rows = await provider.searchIssues(args.query ?? '', args.limit ?? 20);
        return JSON.stringify({ ok: true, tracker: provider.kind, projects: provider.projectKeys, count: rows.length, issues: rows, note: rows.length === 0 ? 'Nothing matched inside the configured projects.' : 'Read one whole with tracker_read_issue.' });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: SEARCH_ISSUES_TOOL,
      description: 'Search the connected issue tracker live, in its own query language (JQL on Jira: status = "To Do" AND updated >= -7d; plain words on Linear, matched against title and description). The search is always bounded to the projects the source is configured for; leave the query empty for the most recently updated issues. Returns key, summary, status, assignee, updated and the link per issue.',
      schema: z.object({
        query: z.string().max(2000).optional().describe('The query, in the tracker\'s own language, without the project clause. Empty: the most recently updated issues.'),
        limit: z.number().int().min(1).max(50).optional().describe('How many (default 20).'),
        source: z.string().optional().describe('The tracker source to search, when the workspace has more than one.'),
      }),
    },
  );
}

function readAttachmentTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { trackerProviderFor } = await import('@/services/tracker/provider');
        const provider = await trackerProviderFor(ctx.orgId, { issueKey: args.issue_key ?? null });
        const file = await provider.readAttachment(args.attachment_id);
        const base = { ok: true, tracker: provider.kind, attachmentId: args.attachment_id, filename: file.filename, mimeType: file.mimeType, bytes: file.bytes.byteLength };
        if (file.mimeType.startsWith('image/')) {
          const { saveArtifact } = await import('@/libs/tools/artifacts/store');
          const ext = file.filename.includes('.') ? file.filename.split('.').pop()! : (file.mimeType.split('/')[1] ?? 'png');
          const saved = await saveArtifact({ orgId: ctx.orgId, data: file.bytes, ext, contentType: file.mimeType });
          return JSON.stringify({ ...base, url: saved.url, note: 'Stored in this workspace; use the url as a reference image (draw_mockup, fetch_image) or attach it to a record.' });
        }
        if (TEXT_TYPES.test(file.mimeType)) {
          const text = file.bytes.toString('utf8');
          return JSON.stringify({ ...base, text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n[Cut at ${TEXT_MAX} of ${text.length} characters.]` : text });
        }
        return JSON.stringify({ ...base, note: `A ${file.mimeType} file cannot be read inline; say what it is and who attached it, and ask for its content if the work needs it.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_ATTACHMENT_TOOL,
      description: 'An attachment on an issue of the connected issue tracker, by the id tracker_read_issue lists: an image is stored in this workspace and its url returned (a reference for a mockup, a screenshot of the bug); a text, markdown, CSV or JSON file comes back as text; anything else comes back as its name, type and size.',
      schema: z.object({
        attachment_id: z.string().min(1).max(40).describe('The attachment id, from tracker_read_issue.'),
        issue_key: z.string().max(40).optional().describe('The issue it is on, so the right tracker source answers when the workspace has several.'),
      }),
    },
  );
}
