import type React from 'react';
import { desc, eq, sql } from 'drizzle-orm';
import { Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { agentSchema, skillRunSchema, skillSchema } from '@/models/Schema';

/**
 * Agent activity + review for one business object — the provenance panel on
 * `/dashboard/objects/[id]`.
 *
 * Object-level decisions ARE skill-run decisions: an agent's proposed action
 * on a record (route it, follow up on it) is a `skill_run` referencing the
 * object, so "review the applicant" and "review the run" are the same row,
 * the same status transition, the same audit trail as `/dashboard/review`.
 * Pending runs render through the core ReviewQueue — approving here is
 * indistinguishable from approving there.
 *
 * Linkage convention: a run references an object via `input.objectRef`
 * (preferred) or by carrying the object's external id anywhere in its input
 * (legacy/tenant keys like `input.applicant`). No new tables, no new queue.
 */

type ConfidenceLevel = 'confident' | 'uncertain' | 'speculative';

function asConfidence(v: string | null): ConfidenceLevel | null {
  return (v === 'confident' || v === 'uncertain' || v === 'speculative') ? v : null;
}

function outputWhy(output: string | null): string | null {
  if (!output) {
    return null;
  }
  try {
    const j = JSON.parse(output);
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      const why = o.why ?? o.rationale ?? o.reason ?? o.email_draft ?? o.profile;
      if (typeof why === 'string') {
        return why;
      }
    }
  } catch { /* prose output */ }
  return output.length > 240 ? `${output.slice(0, 240)}…` : output;
}

export async function ObjectAgentActivity({ orgId, externalRef }: {
  orgId: string;
  /** The object's stable reference — metadata.external_id / externalId. */
  externalRef: string | null;
}) {
  if (!externalRef) {
    return null;
  }

  // objectRef convention first; fall back to the ref appearing as any JSON
  // string value in the run input (tenant keys like `applicant`).
  const runs = await db
    .select({
      run: skillRunSchema,
      skillSlug: skillSchema.slug,
      skillName: skillSchema.name,
    })
    .from(skillRunSchema)
    .innerJoin(skillSchema, eq(skillRunSchema.skillId, skillSchema.id))
    .where(sql`${skillRunSchema.orgId} = ${orgId} AND (
      ${skillRunSchema.input} ->> 'objectRef' = ${externalRef}
      OR ${skillRunSchema.input}::text LIKE ${`%"${externalRef}"%`}
    )`)
    .orderBy(desc(skillRunSchema.createdAt))
    .limit(25);

  if (runs.length === 0) {
    return null;
  }

  // Which agents own these skills — the "who did this" linkage.
  const slugs = [...new Set(runs.map(r => r.skillSlug))];
  const agents = await db.query.agentSchema.findMany({
    where: eq(agentSchema.orgId, orgId),
  });
  const agentBySkill = new Map<string, { slug: string; name: string }>();
  for (const a of agents) {
    for (const s of (a.skillSlugs ?? [])) {
      if (slugs.includes(s) && !agentBySkill.has(s)) {
        agentBySkill.set(s, { slug: a.slug, name: a.name });
      }
    }
  }

  const pending = runs.filter(r => r.run.status === 'pending').map(({ run: r }) => ({
    id: r.id,
    skillId: r.skillId,
    status: r.status,
    input: r.input as Record<string, unknown> | null,
    output: r.output ? r.output.slice(0, 4000) : null,
    truncated: !!(r.output && r.output.length > 4000),
    workspaceSha: r.workspaceSha,
    langfuseTraceId: r.langfuseTraceId,
    confidence: asConfidence(r.confidence),
    createdBy: r.createdBy,
    createdAt: r.createdAt ?? new Date(),
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
  }));
  const done = runs.filter(r => r.run.status !== 'pending');

  return (
    <section className="mt-6 rounded-lg border border-border p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-muted-foreground" />
        Agent activity
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Every agent action on this record, with its reasoning — pending items are the same review queue as
        {' '}
        <Link href="/dashboard/review" className="underline">Review</Link>
        .
      </p>

      {pending.length > 0 && (
        <div className="mb-5">
          <ReviewQueue initialSkillRuns={pending} initialWorkflowRuns={[]} />
        </div>
      )}

      <div className="space-y-3">
        {done.map(({ run: r, skillSlug, skillName }) => {
          const agent = agentBySkill.get(skillSlug);
          const why = outputWhy(r.output);
          return (
            <div key={r.id} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{skillName ?? skillSlug}</span>
                <StatusPill status={(r.status ?? 'completed') as React.ComponentProps<typeof StatusPill>['status']} size="sm" />
                {agent && (
                  <Link href={`/dashboard/agents/${agent.slug}` as never} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                    by
                    {' '}
                    {agent.name}
                  </Link>
                )}
                {r.rating === 'up' && <Badge variant="outline" className="gap-1 text-emerald-600"><ThumbsUp className="size-3" /></Badge>}
                {r.rating === 'down' && <Badge variant="outline" className="gap-1 text-red-500"><ThumbsDown className="size-3" /></Badge>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
              {why && <p className="mt-1.5 text-sm text-muted-foreground">{why}</p>}
              {r.feedbackNote && (
                <p className="mt-1.5 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                  “
                  {r.feedbackNote}
                  ”
                  {r.feedbackBy && (
                    <span className="not-italic">
                      {' '}
                      —
                      {' '}
                      {r.feedbackBy}
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
