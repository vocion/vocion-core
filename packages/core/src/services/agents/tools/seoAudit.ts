/**
 * The SEO audit's tools.
 *
 *   seo_run_audit        read a client's whole site, its home page's structured
 *                        data, robots.txt and Google's results for its name;
 *                        file the findings as this run's `seo_audit` record and
 *                        a shareable report with the recommended next steps
 *   seo_update_findings  a finding's "Fix it" (a page planned in a batch, or a
 *                        task on the project), or a person's verdict (dismiss,
 *                        fixed, reopen), each with when, who and why
 *
 * The checks are code (`services/seo/audit.ts`), the register too
 * (`services/seo/audits.ts`): the model reads what was found and says what to
 * do first; it never lists a finding the run did not make. Services load when
 * a tool runs, not when it is listed.
 */

import type { RuntimeContext } from '../types';
import type { AuditFinding } from '@/services/seo/audit';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { stepProgress } from '@/libs/chat/stepProgress';
import { recordIdArg, recordIdOf } from './recordIdArg';

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * seo_run_audit.
 * @param ctx - The turn.
 */
export function seoRunAuditTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [{ getDataRoom }, { inventoryProject, fetchText }, { homepageSchema }, { auditFindings, auditCoverage, siteOriginOf }, { fileAudit, getAudit, SEO_AUDIT_TYPE }, { mergeMeta }] = await Promise.all([
        import('@/services/DataRoomService'),
        import('./siteInventory'),
        import('@/services/seo/profilePrefill'),
        import('@/services/seo/audit'),
        import('@/services/seo/audits'),
        import('@/services/seo/records'),
      ]);
      const room = await getDataRoom(ctx.orgId, args.project_id);
      if (!room) {
        return `No project #${args.project_id} in this workspace. list_projects names them.`;
      }
      const profile = room.meta.seoProfile;
      const progress = stepProgress(ctx.emit, 'seo_run_audit');
      const run = await inventoryProject(ctx, room, { url: args.url ?? profile?.website, cap: args.max_pages, onProgress: (p) => {
        if (p.phase === 'discover') {
          progress.note('Finding sitemap and linked pages');
        } else if (p.completed === p.total) {
          progress.note(`Checked ${p.completed} pages; preparing the inventory`);
        } else {
          progress.pulse(`Checking pages: ${p.completed} of ${p.total}`);
        }
      } });
      if (!run.ok) {
        return `The audit could not run: ${run.message}`;
      }
      const { inv } = run;
      const origin = siteOriginOf(inv);
      progress.note(`Inventory recorded: ${inv.rows.length} pages checked; reading home-page structured data`);
      // The home page's structured data, read now.
      let schema: ReturnType<typeof homepageSchema> | null | undefined;
      try {
        const { getBrowseProvider } = await import('@/libs/tools/browse/registry');
        const page = await getBrowseProvider().fetchHtml(`${origin}/`, { orgId: ctx.orgId });
        schema = page ? homepageSchema(page.html) : undefined;
      } catch {
        schema = undefined;
      }
      progress.note('Checking robots.txt crawler access');
      const robots = await fetchText(`${origin}/robots.txt`).catch(() => undefined);
      progress.note('Checking search results for the client’s name');
      // Google's page for the client's own name: where its site stands.
      let brand: Parameters<typeof auditFindings>[0]['brand'] = null;
      let brandNote: string | null = null;
      try {
        const { cachedSearch } = await import('./serpResearch');
        const own = new Set([hostOf(origin), ...(room.meta.domains ?? []).map(d => hostOf(/^https?:/.test(d) ? d : `https://${d}`))].filter(Boolean));
        const { serp } = await cachedSearch(ctx, { query: room.title }, true);
        const hit = serp.organic.find(o => own.has(o.domain.replace(/^www\./, '')) || [...own].some(d => o.domain.endsWith(`.${d}`)));
        brand = { query: room.title, position: hit?.position ?? null, isGoogleRanking: serp.isGoogleRanking, checkedAt: serp.retrievedAt ?? new Date().toISOString() };
      } catch {
        brandNote = 'Google\'s results for the client\'s name could not be read (no SERP provider here), so that check did not run. Say so.';
      }
      const checkedAt = new Date().toISOString();
      const reads = { checkedAt, inventory: inv, schema, robots, brand, profile, clientName: room.title };
      const findings = auditFindings(reads);
      const coverage = auditCoverage(reads);
      progress.note(`Found ${findings.length} finding groups, ${findings.filter(f => f.severity === 'high').length} high priority; saving evidence`);
      // The agent's own act, recorded as the agent's: never a person's id.
      const by = `agent:${ctx.agentSlug ?? 'seo-strategist'}`;
      const filed = await fileAudit(ctx.orgId, { project: { id: room.id, title: room.title, profile }, site: origin, checkedAt, findings, coverage, pagesRead: inv.rows.length, listed: inv.listed, inventoryArtifactId: run.artifactId, by });
      if (!filed) {
        return `The audit ran (${findings.length} findings) but this workspace has no ${SEO_AUDIT_TYPE} record type: the SEO app needs its update. Say so.`;
      }
      progress.note('Audit findings saved; building the shareable report');
      // The shareable report: an artifact on the audit's record.
      const { renderMarkdownArtifact } = await import('./renderArtifacts');
      const { anchorArtifact } = await import('@/services/ArtifactService');
      const made = await renderMarkdownArtifact(ctx, filed.audit.title.replace(/^Audit/, 'SEO audit'), filed.audit.meta.report, 'seo/audits');
      if (made.artifactId !== null) {
        await anchorArtifact({ orgId: ctx.orgId, id: made.artifactId, record: { type: 'object', id: String(filed.audit.id), role: 'report' } }).catch(() => null);
        await mergeMeta(ctx.orgId, filed.audit.id, () => ({ reportArtifactId: made.artifactId! }));
      }
      const audit = (await getAudit(ctx.orgId, filed.audit.id))!;
      const m = audit.meta;
      return JSON.stringify({
        audit: { id: audit.id, title: audit.title, href: `/dashboard/objects/${audit.id}` },
        coverage,
        report: made.artifactId ? { artifactId: made.artifactId, href: `/dashboard/artifacts/${made.artifactId}` } : null,
        project: { id: room.id, href: `/dashboard/projects/${room.id}` },
        read: { pages: inv.rows.length, listed: inv.listed, from: inv.from, homePageSchema: schema === undefined ? 'not read' : 'read', robots: robots === undefined ? 'not read' : robots === null ? 'none' : 'read', googleForName: brand ? (brand.position ? `#${brand.position}` : 'not on the first page') : 'not read' },
        counts: m.counts,
        recommendedNextSteps: m.nextSteps,
        findings: m.findings.map(f => ({ key: f.key, category: f.category, severity: f.severity, title: f.title, status: f.status, ...(f.url ? { url: f.url } : {}), ...(f.urls ? { pages: f.urls.length } : {}), ...(f.suggestPage ? { suggestPage: f.suggestPage } : {}) })),
        ...(filed.resolved.length && filed.previous ? { fixedSinceLastRun: `${filed.resolved.length} findings the run of ${filed.previous.meta.checkedAt.slice(0, 10)} had open are no longer found; they are marked fixed there.` } : {}),
        ...(profile ? {} : { noProfile: 'The project has no SEO profile, so the local and goal-weighted checks did not run. Offer seo_propose_profile.' }),
        ...(brandNote ? { note: brandNote } : {}),
        next: 'Say the headline (open findings, how many high) and the recommended next steps, in order, and link the report (it is shareable from its page). Each finding has a Fix it: seo_update_findings plans a page for it or makes a task. Do not restate every finding; the report holds them.',
      });
    },
    {
      name: 'seo_run_audit',
      description: 'Audit a client\'s site: reads every page from the sitemap (status, title, meta description, H1, canonical, noindex, words, schema), the home page\'s Organization schema, robots.txt and Google\'s results for the client\'s name, and checks them in code (technical, content, AI visibility, local / Google Business Profile). Files the run as an seo_audit record on the project, findings with severity, evidence, page and date, a person\'s earlier verdicts carried forward, and a shareable report with the recommended next steps. A new client\'s first run: onboard, audit, report, next steps.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project.'),
        url: z.string().max(300).optional().describe('The site, when the project has no domain or profile website.'),
        max_pages: z.number().int().min(1).max(5000).optional().describe('Pages read at most (default 300).'),
      }),
    },
  );
}

/**
 * seo_update_findings.
 * @param ctx - The turn.
 */
export function seoUpdateFindingsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const ref = await recordIdOf(ctx.orgId, args.audit_id);
      if ('reason' in ref) {
        return `Not changed: ${ref.reason}.`;
      }
      const [{ getAudit, moveFindings }, { getDataRoom, addOpenItem }] = await Promise.all([import('@/services/seo/audits'), import('@/services/DataRoomService')]);
      const audit = await getAudit(ctx.orgId, ref.id);
      if (!audit) {
        return `Not changed: #${ref.id} is not an SEO audit here.`;
      }
      const room = await getDataRoom(ctx.orgId, audit.meta.projectId);
      const profile = room?.meta.seoProfile;
      // The agent's own act, recorded as the agent's: never a person's id.
      const by = `agent:${ctx.agentSlug ?? 'seo-strategist'}`;
      const chosen = args.findings.map(k => audit.meta.findings.find(f => f.key === k) ?? k);
      const unknown = chosen.filter((f): f is string => typeof f === 'string');
      if (unknown.length) {
        return `Not changed: ${unknown.map(k => `"${k}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a finding on audit #${audit.id}. Its findings: ${audit.meta.findings.map(f => f.key).join(', ')}.`;
      }
      const findings = chosen as AuditFinding[];
      const line = (moves: Array<{ key: string; status?: string; refused?: string }>) => moves.map(m => (m.refused ? `${m.key}: not changed (${m.refused})` : `${m.key}: ${args.action === 'mark_fixed' && m.status === 'fixed' ? 'reported fixed; rerun required to verify' : m.status}`)).join('; ');
      if (args.action === 'dismiss' || args.action === 'mark_fixed' || args.action === 'reopen') {
        if (args.action === 'dismiss' && !args.note?.trim()) {
          return 'Not changed: a dismissal says why (note), so the next run and the next person can read it.';
        }
        const moves = await moveFindings(ctx.orgId, audit.id, findings.map(f => f.key), { kind: args.action }, { by, note: args.note }, profile);
        return `Audit #${audit.id}: ${line(moves)}. Every later run carries a dismissal forward.`;
      }
      const open = findings.filter(f => f.status === 'open' && !f.fix);
      const skipped = findings.filter(f => !open.includes(f)).map(f => `${f.key} (${f.fix ? `already fixed by a ${f.fix.kind}: ${f.fix.href}` : f.status})`);
      if (open.length === 0) {
        return `Nothing to fix: ${skipped.join('; ')}.`;
      }
      if (args.action === 'make_task') {
        const made: string[] = [];
        for (const f of open) {
          const pages = f.url ? [f.url] : (f.urls ?? []);
          const ask = await addOpenItem(ctx.orgId, audit.meta.projectId, { title: `Fix: ${f.title}`, body: [f.evidence, pages.length ? `Pages: ${pages.join(', ')}` : null, `From [${audit.title}](/dashboard/objects/${audit.id}), checked ${f.checkedAt.slice(0, 10)}.`, args.note ?? null].filter(Boolean).join('\n\n'), urgent: f.severity === 'high', sourceRef: `seo-audit:${audit.id}:${f.key}` }, by);
          const href = `/dashboard/inbox/${ask.id}`;
          await moveFindings(ctx.orgId, audit.id, [f.key], null, { by }, profile, { kind: 'task', id: ask.id, href, at: new Date().toISOString() });
          made.push(`${f.key} → task #${ask.id} (${href})`);
        }
        return `Made ${made.length} ${made.length === 1 ? 'task' : 'tasks'} on the project: ${made.join('; ')}.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''} Each finding stays open until a later audit no longer finds it or a person marks it fixed.`;
      }
      // plan_page: a page for each finding, in one batch with its plan sign-off.
      const pages = open.map((f) => {
        const p = open.length === 1 && args.page ? { keyword: args.page.keyword, pageType: args.page.page_type, location: args.page.location, title: args.page.title } : f.suggestPage ? { keyword: f.suggestPage.keyword, pageType: f.suggestPage.pageType, location: f.suggestPage.location } : null;
        return { f, p };
      });
      const missing = pages.filter(x => !x.p).map(x => x.f.key);
      if (missing.length) {
        return `Not planned: ${missing.join(', ')} ${missing.length === 1 ? 'suggests' : 'suggest'} no page. Pass page (keyword and page_type) for one finding at a time, or make it a task.`;
      }
      try {
        const [{ planSeoBatch }, { fileSeoPlanAsk }, { askHere, showDocked }] = await Promise.all([import('@/services/seo/records'), import('@/services/seo/signoff'), import('@/services/decisions/askHere')]);
        const { batch, pages: made } = await planSeoBatch(ctx.orgId, by, { projectId: audit.meta.projectId, topic: args.topic ?? `Audit fixes ${audit.meta.checkedAt.slice(0, 10)}`, pages: pages.map(x => ({ keyword: x.p!.keyword, ...(x.p!.title ? { title: x.p!.title } : {}), pageType: x.p!.pageType, ...(x.p!.location ? { location: x.p!.location } : {}) })) });
        for (const [i, x] of pages.entries()) {
          const page = made[i];
          if (page) {
            await moveFindings(ctx.orgId, audit.id, [x.f.key], null, { by }, profile, { kind: 'page', id: page.id, href: `/dashboard/objects/${page.id}`, at: new Date().toISOString() });
          }
        }
        const here = await askHere(ctx);
        const ask = await fileSeoPlanAsk({ orgId: ctx.orgId, batchId: batch.id, agentSlug: ctx.agentSlug, why: `From ${audit.title}: ${open.map(f => f.title).join('; ')}.`, here });
        const docked = ask && here ? await showDocked(ctx, ask.askId) : false;
        return `Planned batch #${batch.id} with ${made.length} ${made.length === 1 ? 'page' : 'pages'} for the audit's findings (/dashboard/p/seo-pages?batch=${batch.id}), each finding linked to its page, and filed the plan's sign-off${ask ? ` (ask #${ask.askId}${docked ? ', docked above their composer' : ', on Needs you'})` : ''}. Nothing is briefed until a person approves it.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`;
      } catch (err) {
        return `Not planned: ${(err as Error).message}`;
      }
    },
    {
      name: 'seo_update_findings',
      description: 'Act on an SEO audit\'s findings, by key: plan_page (a page planned in a batch for each finding, with its plan sign-off; a finding that suggests no page needs `page`), make_task (an open item on the client\'s project for each), or a person\'s verdict: dismiss (with a note why; kept on every later run), mark_fixed, reopen. Each finding is linked to what fixed it.',
      schema: z.object({
        audit_id: recordIdArg('The audit'),
        findings: z.array(z.string().min(1)).min(1).max(50).describe('Finding keys, as seo_run_audit or the report lists them.'),
        action: z.enum(['plan_page', 'make_task', 'dismiss', 'mark_fixed', 'reopen']),
        note: z.string().max(500).optional().describe('Why (required to dismiss), or what the task should say.'),
        topic: z.string().max(200).optional().describe('plan_page: the batch\'s topic.'),
        page: z.object({ keyword: z.string().min(1).max(200), page_type: z.enum(['location', 'service', 'blog', 'landing']), location: z.string().max(120).optional(), title: z.string().max(200).optional() }).optional().describe('plan_page, one finding: the page to plan when the finding suggests none.'),
      }),
    },
  );
}
