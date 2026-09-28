import type { DocumentVerification } from '@/libs/cards/specs';
import type { PreviewDoc, PreviewFact } from '@/libs/preview/types';
import type { RecordRef } from '@/services/chat/pageContext';
import type { KnowledgeDocumentDetail } from '@/services/SourceSyncService';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { inspectDocument } from '@/libs/documents/sheets';
import { canOpenArtifact } from '@/libs/share/audience';
import { artifactSchema, briefingSchema, conversationMessageSchema, conversationSchema, leadBriefSchema, toolCallSchema, workerRunSchema } from '@/models/Schema';
import { findDocumentForCitation } from './documentRef';
import { registerPreview } from './registry';

/**
 * Every record type that can be previewed today, one descriptor each.
 *
 * Importing this module registers them. `routers/Preview.ts` is the only
 * importer, because registration must happen exactly once and on the server.
 *
 * All of these read a first-party table or the `knowledge_document` mirror.
 * None makes an outbound call: the connectors already synced this data, and a
 * peek must not cost a round trip to someone else's API or spend a rate limit
 * on a glance.
 */

/** Long bodies are cut; the panel links to the page that holds the rest. */
const BODY_LIMIT = 6000;

function body(text: string | null | undefined, limit = BODY_LIMIT): { body?: string; truncated?: boolean } {
  const t = (text ?? '').trim();
  if (!t) {
    return {};
  }
  return t.length > limit ? { body: `${t.slice(0, limit)}…`, truncated: true } : { body: t };
}

/** A thread or a run log is read to the end: a larger cap, the newest kept. */
const LOG_LIMIT = 40_000;
function tailBody(text: string): { body?: string; truncated?: boolean } {
  const t = text.trim();
  return t.length > LOG_LIMIT ? { body: `…${t.slice(-LOG_LIMIT)}`, truncated: true } : body(t, LOG_LIMIT);
}

function when(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 16).replace('T', ' ') : null;
}

function facts(...items: Array<PreviewFact | null | false | undefined | ''>): PreviewFact[] {
  return items.filter((f): f is PreviewFact => typeof f === 'object' && f !== null && Boolean(f.value));
}

/**
 * How a mirrored document names itself, per the connector that ingested it.
 * @param doc
 */
function documentSourceLabel(doc: KnowledgeDocumentDetail): string {
  const kind = String(doc.metadata.kind ?? '');
  if (kind === 'granola-note') {
    return 'Granola';
  }
  if (kind === 'zoom-recording') {
    return 'Zoom';
  }
  if (kind === 'gmail-thread' || kind === 'gmail-message') {
    return 'Gmail';
  }
  if (kind === 'calendar-event') {
    return 'Calendar';
  }
  if (doc.metadata.objectType) {
    return 'HubSpot';
  }
  const slug = doc.sourceSlug.split('-')[0] ?? doc.sourceSlug;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * A mirrored document as a preview. The shape every source kind lands in.
 * @param ref
 * @param doc
 */
function documentPreview(ref: RecordRef, doc: KnowledgeDocumentDetail): PreviewDoc {
  const meta = doc.metadata;
  const str = (k: string) => (typeof meta[k] === 'string' && meta[k] ? meta[k] : null);
  const participants = Array.isArray(meta.participants)
    ? meta.participants.filter((p): p is string => typeof p === 'string').join(', ')
    : str('participants');
  return {
    ref,
    // Never the external id: a document with no title says what it is.
    title: doc.title?.trim() || `${documentSourceLabel(doc)} document`,
    sourceLabel: documentSourceLabel(doc),
    subtitle: str('summary') ?? undefined,
    facts: facts(
      str('from') && { label: 'From', value: str('from')! },
      str('to') && { label: 'To', value: str('to')! },
      participants && { label: 'Participants', value: participants },
      str('startTime') && { label: 'Started', value: str('startTime')! },
      { label: 'Updated', value: when(doc.lastModifiedAt ?? doc.ingestedAt) ?? '' },
      { label: 'Source', value: doc.sourceSlug },
      str('objectType') && { label: 'Object', value: str('objectType')! },
    ),
    ...body(doc.content),
    href: `/dashboard/search/${doc.id}`,
    externalHref: doc.uri ?? str('recordingUrl') ?? undefined,
  };
}

/**
 * Resolve any citation that names ingested content — the evidence kinds
 * (granola / zoom / gmail / docuseal / …) and the Search detail page's own
 * numeric document ids, which arrive here as `document:<n>`.
 * @param ref
 * @param ctx
 * @param ctx.orgId
 * @param ctx.userId
 */
async function resolveDocument(ref: RecordRef, ctx: { orgId: string; userId: string | null }): Promise<PreviewDoc | null> {
  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const { getDocument } = await import('@/services/SourceSyncService');
  const allowed = ctx.userId ? await allowedSourceSlugsForUser(ctx.orgId, ctx.userId) : undefined;
  const numeric = /^\d+$/.test(ref.id) ? Number.parseInt(ref.id, 10) : null;
  const hit = numeric === null ? await findDocumentForCitation(ctx.orgId, ref.id, allowed) : null;
  const id = numeric ?? hit?.id ?? null;
  if (id === null) {
    return null;
  }
  const doc = await getDocument(ctx.orgId, id, allowed ? { allowedSourceSlugs: allowed } : {});
  return doc ? documentPreview(ref, doc) : null;
}

registerPreview('document', { sourceLabel: 'Document', resolve: resolveDocument });

/**
 * A CRM subject is a mirrored HubSpot record; `deals:123` / `contacts:9412`
 * are exactly the external ids the connector wrote, so the document resolver
 * answers the body. The NAME comes from `services/records/recordLabel`, which
 * #380 wrote as a `label(ref)` resolver for exactly this: it reads the same
 * mirror in one indexed, batched, org-scoped query and knows which mirrored
 * titles are really just the id again. Growing a second namer here would be
 * the defect §19 names.
 *
 * `object` also carries non-CRM business objects, which have their own page
 * and no ingested copy — those fall through to unresolved.
 * @param ref
 * @param ctx
 * @param ctx.orgId
 * @param ctx.userId
 */
async function resolveCrmRecord(ref: RecordRef, ctx: { orgId: string; userId: string | null }): Promise<PreviewDoc | null> {
  const doc = await resolveDocument(ref, ctx);
  if (!doc) {
    return null;
  }
  const { resolveRecordLabels } = await import('@/services/records/recordLabel');
  const named = (await resolveRecordLabels(ctx.orgId, [ref.id])).get(ref.id);
  return named ? { ...doc, title: named } : doc;
}

registerPreview('deal', { sourceLabel: 'HubSpot', resolve: resolveCrmRecord });

/**
 * An `object` ref is a business object first — a data room, since 2026-09-18
 * the record a chat turn most often makes — and a HubSpot record otherwise.
 * The room's preview is its status, cast, sources and open items, with the
 * room page one click away.
 * @param ref
 * @param ctx
 * @param ctx.orgId
 * @param ctx.userId
 */
async function resolveObject(ref: RecordRef, ctx: { orgId: string; userId: string | null }): Promise<PreviewDoc | null> {
  if (/^\d+$/.test(ref.id)) {
    const { exportDataRoom, getDataRoom, roomHref } = await import('@/services/DataRoomService');
    const room = await getDataRoom(ctx.orgId, Number.parseInt(ref.id, 10));
    if (room) {
      const md = (await exportDataRoom(ctx.orgId, room.id)) ?? '';
      const cut = md.length > 6000;
      return {
        ref,
        title: room.title,
        sourceLabel: 'Data room',
        kind: 'data_room',
        subtitle: room.meta.status ?? undefined,
        facts: [
          room.meta.stage ? { label: 'Stage', value: room.meta.stage } : null,
          room.meta.client ? { label: 'Client', value: room.meta.client } : null,
          { label: 'Sources', value: String(room.meta.sources?.length ?? 0) },
          { label: 'Cast', value: String(room.meta.cast?.length ?? 0) },
        ].filter((f): f is { label: string; value: string } => f !== null),
        body: cut ? md.slice(0, 6000) : md,
        href: roomHref(room.id),
        ...(cut ? { truncated: true } : {}),
      };
    }
  }
  return resolveCrmRecord(ref, ctx);
}

registerPreview('object', { sourceLabel: 'HubSpot', resolve: resolveObject });

/**
 * What to show in the panel for an artifact whose body is STRUCTURE rather
 * than prose.
 *
 * A sequence and a table have no markdown, so the text lookup above finds
 * nothing and the panel would report the artifact as empty — which is exactly
 * the bug this file just fixed, one level down. Render the structure as text
 * instead: it is a preview, and the full page still owns the real rendering.
 * @param kind - The artifact kind.
 * @param spec - Its spec.
 */
function specSummary(kind: string, spec: Record<string, unknown>): string | null {
  if (kind === 'sequence' && Array.isArray(spec.sends)) {
    const sends = spec.sends as Array<{ day?: number; step?: number; subject?: string; body?: string }>;
    const head = typeof spec.sequenceName === 'string' ? `**${spec.sequenceName}**\n\n` : '';
    return head + sends
      .map((s) => {
        const label = s.day !== undefined ? `Day ${s.day}` : `Send ${s.step ?? '?'}`;
        return `### ${label} — ${s.subject ?? '(no subject)'}\n\n${s.body ?? ''}`;
      })
      .join('\n\n');
  }
  if (kind === 'document' && typeof spec.html === 'string') {
    // The outline and the last verdict, with the first sheet as a picture.
    // The frame itself lives on the full page; a preview says what it is.
    const outline = inspectDocument(spec.html);
    const v = spec.verification as DocumentVerification | undefined;
    const first = v?.sheets.find(sh => sh.image);
    return [
      first?.image ? `![Sheet 1](${first.image})` : null,
      `**${outline.sheetCount} ${outline.sheetCount === 1 ? 'sheet' : 'sheets'}**${v ? ` · ${v.ok ? 'render-verified, no issues' : `${v.issues.length} ${v.issues.length === 1 ? 'issue' : 'issues'}`}${v.pdfPages !== null ? ` · PDF ${v.pdfPages} pages` : ''}` : ' · not verified'}`,
      outline.sheets.map(sh => `${sh.n}. ${sh.label || '(no label)'}`).join('\n'),
      v && v.issues.length > 0 ? v.issues.map(i => `- ${i}`).join('\n') : null,
    ].filter(Boolean).join('\n\n');
  }
  if (kind === 'table' && Array.isArray(spec.columns)) {
    const caption = typeof spec.caption === 'string' ? `**${spec.caption}**\n\n` : '';
    const cols = (spec.columns as Array<{ label?: string } | string>)
      .map(c => (typeof c === 'string' ? c : c.label ?? ''))
      .filter(Boolean);
    const rows = Array.isArray(spec.rows) ? spec.rows.length : 0;
    return `${caption}${cols.join(' · ')}\n\n${rows} ${rows === 1 ? 'row' : 'rows'}`;
  }
  return null;
}

registerPreview('artifact', {
  sourceLabel: 'Artifact',
  href: ref => `/dashboard/artifacts/${ref.id}`,
  resolve: async (ref, ctx) => {
    const id = Number.parseInt(ref.id, 10);
    if (!Number.isSafeInteger(id)) {
      return null;
    }
    const [row] = await db
      .select({ id: artifactSchema.id, title: artifactSchema.title, kind: artifactSchema.kind, spec: artifactSchema.spec, url: artifactSchema.url, folder: artifactSchema.folder, version: artifactSchema.currentVersion, updatedAt: artifactSchema.updatedAt, author: artifactSchema.lastAuthorId, shareAudience: artifactSchema.shareAudience, shareOwnerId: artifactSchema.shareOwnerId })
      .from(artifactSchema)
      .where(and(eq(artifactSchema.orgId, ctx.orgId), eq(artifactSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    // Shared with its owner only: the title is a fact of the workspace, the
    // body is not (`libs/share/audience.ts`).
    if (!canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId ?? null }, { userId: ctx.userId, isMember: true, hasToken: false })) {
      return { ref, title: row.title, sourceLabel: 'Artifact', kind: row.kind, unresolved: { reason: 'Shared with its owner only. Ask them to widen the audience.', reference: `artifact ${row.id}` } };
    }
    const spec = row.spec as Record<string, unknown>;
    // `md` FIRST, because that is what every markdown artifact actually
    // carries — `render_markdown` writes `{ title, md }` and so do the
    // personalization brief and recommendation. This descriptor looked only
    // for `markdown`/`text`, which no artifact has ever had, so the panel has
    // shown "No text was synced for this reference" for every artifact since
    // it was written. All 25 markdown artifacts in production use `md`.
    // Chris, 2026-09-17: *"no preview or content on the Preview pane for this
    // artifact."*
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
    const text = str(spec.md) ?? str(spec.markdown) ?? str(spec.text) ?? specSummary(row.kind, spec);
    return {
      ref,
      title: row.title,
      sourceLabel: 'Artifact',
      kind: row.kind,
      subtitle: row.folder ?? undefined,
      facts: facts(
        { label: 'Kind', value: row.kind },
        { label: 'Version', value: String(row.version) },
        row.author && { label: 'Last edited by', value: row.author },
        { label: 'Updated', value: when(row.updatedAt) ?? '' },
      ),
      ...body(text),
      externalHref: row.url ?? undefined,
    };
  },
});

registerPreview('briefing', {
  sourceLabel: 'Briefing',
  href: ref => `/dashboard/briefings/${ref.id}`,
  resolve: async (ref, ctx) => {
    const id = Number.parseInt(ref.id, 10);
    if (!Number.isSafeInteger(id)) {
      return null;
    }
    const [row] = await db
      .select({ id: briefingSchema.id, title: briefingSchema.title, content: briefingSchema.content, teamSlug: briefingSchema.teamSlug, agentSlug: briefingSchema.agentSlug, createdAt: briefingSchema.createdAt })
      .from(briefingSchema)
      .where(and(eq(briefingSchema.orgId, ctx.orgId), eq(briefingSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    return {
      ref,
      title: row.title,
      sourceLabel: 'Briefing',
      facts: facts(
        { label: 'Scope', value: row.teamSlug ?? 'Workspace rollup' },
        row.agentSlug && { label: 'Published by', value: row.agentSlug },
        { label: 'Published', value: when(row.createdAt) ?? '' },
      ),
      ...body(row.content),
    };
  },
});

registerPreview('conversation', {
  sourceLabel: 'Conversation',
  href: ref => `/dashboard/chat?c=${encodeURIComponent(ref.id)}`,
  resolve: async (ref, ctx) => {
    const id = Number.parseInt(ref.id, 10);
    if (!Number.isSafeInteger(id)) {
      return null;
    }
    const [row] = await db
      .select({ id: conversationSchema.id, title: conversationSchema.title, agentSlug: conversationSchema.agentSlug, surface: conversationSchema.surface, createdBy: conversationSchema.createdBy, createdAt: conversationSchema.createdAt })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, ctx.orgId), eq(conversationSchema.id, id)))
      .limit(1);
    if (!row) {
      return null;
    }
    const messages = await db
      .select({ role: conversationMessageSchema.role, content: conversationMessageSchema.content, at: conversationMessageSchema.createdAt })
      .from(conversationMessageSchema)
      .where(eq(conversationMessageSchema.conversationId, id))
      .orderBy(asc(conversationMessageSchema.id))
      .limit(40);
    // THE AGENT'S WORK, not just its words: every tool call in the thread,
    // placed before the reply it led to, with whether it failed (Chris,
    // 2026-09-25: "I want to see log history for agent runs").
    const calls = await db
      .select({ tool: toolCallSchema.tool, error: toolCallSchema.error, ms: toolCallSchema.durationMs, at: toolCallSchema.createdAt })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, ctx.orgId), eq(toolCallSchema.conversationId, id)))
      .orderBy(asc(toolCallSchema.createdAt))
      .limit(200);
    return {
      ref,
      title: row.title,
      sourceLabel: 'Conversation',
      facts: facts(
        { label: 'Agent', value: row.agentSlug },
        { label: 'Surface', value: row.surface },
        row.createdBy && { label: 'Started by', value: row.createdBy },
        { label: 'Started', value: when(row.createdAt) ?? '' },
      ),
      ...body(messages.map((m, i) => {
        const since = i === 0 ? null : messages[i - 1]!.at;
        const steps = m.role === 'assistant'
          ? calls.filter(c => c.at <= m.at && (since === null || c.at > since))
          : [];
        const log = steps.length > 0
          ? `${steps.map(c => `- \`${c.tool}\`${c.error ? ' — failed' : ''}${c.ms ? ` · ${(c.ms / 1000).toFixed(1)}s` : ''}`).join('\n')}\n\n`
          : '';
        return `**${m.role}** · ${when(m.at) ?? ''}\n\n${log}${m.content}`;
      }).join('\n\n---\n\n'), LOG_LIMIT),
    };
  },
});

registerPreview('worker_run', {
  sourceLabel: 'Engineering run',
  resolve: async (ref, ctx) => {
    const id = Number.parseInt(ref.id, 10);
    if (!Number.isSafeInteger(id)) {
      return null;
    }
    const [run] = await db.select().from(workerRunSchema).where(and(eq(workerRunSchema.orgId, ctx.orgId), eq(workerRunSchema.id, id))).limit(1);
    if (!run) {
      return null;
    }
    const progress = (run.progress ?? {}) as Record<string, unknown>;
    const logLines = Array.isArray(progress.log) ? (progress.log as unknown[]).map(String) : typeof progress.log === 'string' ? progress.log.split('\n') : [];
    const failures = Array.isArray(run.failures) ? (run.failures as Array<{ scope?: string; message?: string }>) : [];
    const input = (run.input ?? {}) as { task?: { task_id?: string; objective?: string; repo?: string } };
    const text = [
      input.task?.objective ? `**Objective** — ${input.task.objective}` : null,
      run.summary ? `**Summary**\n\n${run.summary}` : null,
      run.error ? `**Error** — ${run.error}` : null,
      failures.length > 0 ? `**Failures**\n\n${failures.map(f => `- ${f.scope ?? 'run'}: ${f.message ?? ''}`).join('\n')}` : null,
      typeof progress.step === 'string' ? `**Last step** — ${progress.step}` : null,
      logLines.length > 0 ? `**Log (last ${Math.min(logLines.length, 80)} lines)**\n\n\`\`\`\n${logLines.slice(-80).join('\n')}\n\`\`\`` : null,
    ].filter(Boolean).join('\n\n');
    return {
      ref,
      title: input.task?.task_id ?? `Engineering run ${run.id}`,
      sourceLabel: 'Engineering run',
      facts: facts(
        { label: 'Status', value: run.status },
        { label: 'Agent', value: run.agentSlug },
        run.model && { label: 'Model', value: run.model },
        typeof run.cents === 'number' && { label: 'Cost', value: `$${(run.cents / 100).toFixed(2)}` },
        { label: 'Queued', value: when(run.createdAt) ?? '' },
        run.claimedAt && { label: 'Started', value: when(run.claimedAt) ?? '' },
        run.completedAt && { label: 'Ended', value: when(run.completedAt) ?? '' },
        input.task?.repo && { label: 'Repo', value: input.task.repo },
      ),
      ...tailBody(text || 'This run has reported nothing yet.'),
    };
  },
});

registerPreview('lead', {
  sourceLabel: 'Lead',
  resolve: async (ref, ctx) => {
    // Addressed either by row id or by the CRM ref the brief was built for.
    const id = /^\d+$/.test(ref.id) ? Number.parseInt(ref.id, 10) : null;
    const [row] = await db
      .select()
      .from(leadBriefSchema)
      .where(and(eq(leadBriefSchema.orgId, ctx.orgId), id === null ? eq(leadBriefSchema.contactRef, ref.id) : eq(leadBriefSchema.id, id)))
      .orderBy(desc(leadBriefSchema.id))
      .limit(1);
    if (!row) {
      return null;
    }
    const hubspotId = row.contactRef.split(':').pop() ?? row.contactRef;
    return {
      ref,
      title: row.contactName,
      sourceLabel: 'Lead',
      subtitle: [row.contactTitle, row.companyName].filter(Boolean).join(' · ') || undefined,
      facts: facts(
        { label: 'Status', value: row.status },
        { label: 'Trigger', value: row.triggerType },
        row.entranceSource && { label: 'Source', value: row.entranceSource },
        row.confidence !== null && { label: 'Confidence', value: `${Math.round(row.confidence * 100)}%` },
        { label: 'Claims', value: String(row.claims.length) },
      ),
      ...body(row.sections.map(s => `**${s.heading}**\n\n${s.body}`).join('\n\n')),
      href: `/gtm/lead/${encodeURIComponent(hubspotId)}`,
    };
  },
});

/**
 * A plain external link. Nothing to resolve — the panel shows where it goes
 * and hands over the link, labelled as leaving Vocion.
 */
registerPreview('page', {
  sourceLabel: 'Link',
  resolve: async (ref) => {
    if (!/^https?:\/\//i.test(ref.id)) {
      return null;
    }
    const url = new URL(ref.id);
    return {
      ref,
      title: ref.label ?? url.hostname.replace(/^www\./, ''),
      sourceLabel: 'Link',
      facts: facts({ label: 'Address', value: ref.id }),
      externalHref: ref.id,
    };
  },
});
