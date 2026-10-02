/**
 * Finished background runs (schedule ticks and one-off jobs) are history the
 * engine no longer needs: every tick of every cron leaves a row, so they are
 * pruned after a week. Request workflows and other definitions are never
 * pruned here — their steps are the record of a feature.
 * @param days - Age, by completion, past which a succeeded job run goes.
 */
export async function pruneFinishedJobRuns(days: number): Promise<{ pruned: number }> {
  const { durableMode } = await import('./index');
  if (durableMode() === 'memory') {
    return { pruned: 0 };
  }
  const { JOB_DEFINITION, JOB_TICK_WORKFLOW } = await import('./jobs');
  const { dbosClientForAdmin } = await import('./dbos');
  const client = await dbosClientForAdmin();
  const before = new Date(Date.now() - days * 86_400_000).toISOString();
  let pruned = 0;
  for (;;) {
    const page = await client.listWorkflows({ workflowName: [JOB_DEFINITION, JOB_TICK_WORKFLOW], status: 'SUCCESS', completedBefore: before, limit: 500, loadInput: false, loadOutput: false });
    if (page.length === 0) {
      return { pruned };
    }
    await client.deleteWorkflows(page.map(w => w.workflowID), true);
    pruned += page.length;
  }
}
