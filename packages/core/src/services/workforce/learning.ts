import { sql } from 'drizzle-orm';
import { db } from '@/libs/DB';

/**
 * Native learning evidence, scoped to one workspace. Stock is current; flow uses [since, until).
 * @param orgId
 * @param since
 * @param until
 */
export async function readWorkforceLearning(orgId: string, since: Date, until: Date) {
  return db.transaction(async (tx) => {
    const datasets = await tx.execute<{
      id: number;
      slug: string;
      agent_slug: string;
      team_slug: string | null;
      agent_present: boolean;
      version: number;
      provider: string;
      cases: number;
      reference_cases: number;
      updated_at: Date;
      run_id: number | null;
      status: string | null;
      dataset_version: number | null;
      workspace_sha: string | null;
      completed_at: Date | null;
      pass_rate: number | null;
    }>(sql`
      SELECT d.id, d.slug, d.agent_slug, a.team_slug, a.id IS NOT NULL AS agent_present, d.version, d.provider, d.updated_at,
        (SELECT count(DISTINCT item)::int FROM jsonb_array_elements(d.items) item) AS cases,
        (SELECT count(DISTINCT item)::int FROM jsonb_array_elements(d.items) item
          WHERE length(trim(COALESCE(item->>'expectedOutput', ''))) > 0) AS reference_cases,
        r.id AS run_id, r.status, r.dataset_version, r.workspace_sha, r.completed_at,
        (r.metrics->>'passRate')::double precision AS pass_rate
      FROM eval_dataset d
      LEFT JOIN agent a ON a.org_id = d.org_id AND a.slug = d.agent_slug
      LEFT JOIN LATERAL (
        SELECT * FROM eval_run r WHERE r.org_id = ${orgId} AND r.dataset_id = d.id
          AND r.agent_slug = d.agent_slug AND r.provider = d.provider AND r.started_at < ${until}
        ORDER BY r.started_at DESC, r.id DESC LIMIT 1
      ) r ON true
      WHERE d.org_id = ${orgId} ORDER BY d.agent_slug, d.slug
    `);
    const feedback = await tx.execute<{ accumulated: number; received: number; applied: number; pending: number; failed: number }>(sql`
      WITH unique_feedback AS (
        SELECT DISTINCT ON (source, external_id) status, min(created_at) OVER (PARTITION BY source, external_id) AS first_seen
        FROM feedback_job WHERE org_id = ${orgId} AND created_at < ${until}
        ORDER BY source, external_id, updated_at DESC, id DESC
      ) SELECT count(*)::int AS accumulated,
        count(*) FILTER (WHERE first_seen >= ${since})::int AS received,
        count(*) FILTER (WHERE status = 'applied')::int AS applied,
        count(*) FILTER (WHERE status IN ('queued', 'processing', 'classified'))::int AS pending,
        count(*) FILTER (WHERE status = 'failed')::int AS failed FROM unique_feedback
    `);
    const candidates = await tx.execute<{ accumulated: number; approved: number; pending: number; decided: number; eval_completed: number }>(sql`
      SELECT count(*)::int AS accumulated,
        count(*) FILTER (WHERE c.status = 'approved')::int AS approved,
        count(*) FILTER (WHERE c.status = 'pending')::int AS pending,
        count(*) FILTER (WHERE c.decided_at >= ${since} AND c.decided_at < ${until})::int AS decided,
        count(*) FILTER (WHERE c.status = 'approved' AND r.status = 'succeeded'
          AND r.completed_at >= c.decided_at AND r.completed_at < ${until})::int AS eval_completed
      FROM learning_candidate c
      LEFT JOIN eval_run r ON r.org_id = ${orgId} AND r.id = c.eval_run_id
      WHERE c.org_id = ${orgId} AND c.created_at < ${until}
    `);
    const agents = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM agent WHERE org_id = ${orgId}`);
    const rows = datasets.rows.map((d) => {
      const fresh = Boolean(d.workspace_sha) && d.cases > 0 && d.status === 'succeeded' && d.dataset_version === d.version
        && d.completed_at !== null && new Date(d.completed_at).getTime() >= Math.max(new Date(d.updated_at).getTime(), until.getTime() - 30 * 86_400_000)
        && new Date(d.completed_at).getTime() < until.getTime();
      const passRate = fresh && d.workspace_sha && d.pass_rate !== null && Number.isFinite(Number(d.pass_rate)) && Number(d.pass_rate) >= 0 && Number(d.pass_rate) <= 1 ? Number(d.pass_rate) : null;
      return { id: d.id, slug: d.slug, agentSlug: d.agent_slug, registeredAgent: d.agent_present, teamSlug: d.team_slug, version: d.version, provider: d.provider, cases: d.cases, referenceCases: d.reference_cases, latestRunId: d.run_id, latestStatus: d.status, workspaceSha: d.workspace_sha, fresh, passRate };
    });
    return {
      generatedAt: until.toISOString(),
      window: { from: since.toISOString(), to: until.toISOString() },
      datasets: rows,
      summary: { datasets: rows.length, cases: rows.reduce((n, d) => n + d.cases, 0), referenceCases: rows.reduce((n, d) => n + d.referenceCases, 0), agentsWithCases: new Set(rows.filter(d => d.cases > 0 && d.registeredAgent).map(d => d.agentSlug)).size, registeredAgents: agents.rows[0]?.total ?? 0, freshDatasets: rows.filter(d => d.fresh).length, reviewedGoldStandards: null, holdoutCoverage: null, validatedImprovements: null },
      feedback: feedback.rows[0]!,
      candidates: candidates.rows[0]!,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export function learningInsights(report: Awaited<ReturnType<typeof readWorkforceLearning>>) {
  const suggestions: { evidence: string; text: string; measure: string }[] = [];
  if (report.feedback.failed > 0 || report.feedback.pending > 0) {
    suggestions.push({ evidence: `${report.feedback.pending} feedback jobs pending; ${report.feedback.failed} failed.`, text: 'Review feedback routing and failed processing before collecting more feedback.', measure: 'Track unique feedback resolved and subsequent recurrence; processing is not proof of improvement.' });
  }
  if (report.summary.freshDatasets < report.summary.datasets || report.summary.agentsWithCases < report.summary.registeredAgents) {
    suggestions.push({ evidence: `${report.summary.agentsWithCases}/${report.summary.registeredAgents} registered agents have cases; ${report.summary.freshDatasets}/${report.summary.datasets} datasets have fresh results.`, text: 'Prioritize representative failure cases and rerun changed datasets for agents doing consequential work.', measure: 'Compare the same dataset version and grader, preserve independent holdouts, and review real accepted work.' });
  }
  if (report.candidates.approved > report.candidates.eval_completed) {
    suggestions.push({ evidence: `${report.candidates.approved} approved learning candidates; ${report.candidates.eval_completed} have a linked completed post-decision eval.`, text: 'Evaluate approved changes before claiming they improved agent performance.', measure: 'Require comparable before/after evidence and a regression check; completed evals alone do not establish improvement.' });
  }
  return suggestions;
}
