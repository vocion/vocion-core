import type React from 'react';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { actionRunSchema, agentSchema, toolCallSchema } from '@/models/Schema';

/**
 * Agent activity + review for one business object — the provenance panel on
 * `/dashboard/objects/[id]`.
 *
 * Object-level decisions ARE review-queue decisions: an agent's proposed
 * action on a record (route it, follow up on it) is an `action_run`
 * referencing the object, so "review the applicant" and "review the action"
 * are the same row, the same status transition, the same audit trail as
 * `/dashboard/review`. What agents already did to the record is the
 * `tool_call` log, filtered to this object. No new tables, no new queue.
 *
 * Linkage convention: a row references an object via `input.objectRef`
 * (preferred) or by carrying the object's external id anywhere in its input
 * (legacy/tenant keys like `input.applicant`). Pending actions also match on
 * the review-card dedup key, `<slug>:<object id>:<action id>`.
 */

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

  const refLike = `%"${externalRef}"%`;

  // What agents did to this record — objectRef convention first; fall back to
  // the ref appearing as any JSON string value in the call input.
  const calls = await db
    .select()
    .from(toolCallSchema)
    .where(sql`${toolCallSchema.orgId} = ${orgId} AND (
      ${toolCallSchema.input} ->> 'objectRef' = ${externalRef}
      OR ${toolCallSchema.input}::text LIKE ${refLike}
    )`)
    .orderBy(desc(toolCallSchema.createdAt))
    .limit(25);

  // What agents proposed and a person has not decided yet.
  const pending = await db
    .select()
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.status, 'pending'),
      sql`(
        ${actionRunSchema.input} ->> 'objectRef' = ${externalRef}
        OR ${actionRunSchema.input}::text LIKE ${refLike}
        OR ${actionRunSchema.dedupKey} LIKE ${`%:${externalRef}:%`}
      )`,
    ))
    .orderBy(desc(actionRunSchema.createdAt))
    .limit(25);

  if (calls.length === 0 && pending.length === 0) {
    return null;
  }

  // Display names for the agents that acted — the "who did this" linkage.
  const agents = await db.query.agentSchema.findMany({
    where: eq(agentSchema.orgId, orgId),
    columns: { slug: true, name: true },
  });
  const agentName = new Map(agents.map(a => [a.slug, a.name]));

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
        <div className="mb-5 space-y-2">
          {pending.map((a) => {
            const who = a.invokedBy?.startsWith('agent:') ? agentName.get(a.invokedBy.slice(6)) ?? a.invokedBy.slice(6) : a.invokedBy;
            return (
              <div key={a.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{a.actionId}</span>
                  <StatusPill status="pending" size="sm" />
                  {who && (
                    <span className="text-xs text-muted-foreground">
                      proposed by
                      {' '}
                      {who}
                    </span>
                  )}
                  {typeof a.proposal?.confidence === 'number' && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(a.proposal.confidence * 100)}
                      % confident
                    </span>
                  )}
                  <Link href="/dashboard/review" className="ml-auto text-xs underline">Decide in Review</Link>
                </div>
                {a.proposal?.rationale && <p className="mt-1.5 text-sm text-muted-foreground">{a.proposal.rationale}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        {calls.map((c) => {
          const why = outputWhy(c.output);
          const status: React.ComponentProps<typeof StatusPill>['status'] = c.error ? 'failed' : 'completed';
          return (
            <div key={c.id} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{c.tool}</span>
                <StatusPill status={status} size="sm" />
                <Link href={`/dashboard/agents/${c.agentSlug}` as never} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                  by
                  {' '}
                  {agentName.get(c.agentSlug) ?? c.agentSlug}
                </Link>
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
              {why && <p className="mt-1.5 text-sm text-muted-foreground">{why}</p>}
              {c.error && (
                <p className="mt-1.5 border-l-2 border-red-500/50 pl-2 text-xs text-red-600">{c.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
