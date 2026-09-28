import { OctagonAlert } from 'lucide-react';

/** One task of a mission run's plan, as much of it as the run page shows. */
type PlanTask = {
  id: string;
  title: string;
  ownerAgentSlug: string;
  type: string;
  status: string;
  error?: string;
};

const TASK_STATUS_TONE: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  running: 'text-primary',
  awaiting_approval: 'text-amber-600 dark:text-amber-400',
  failed: 'text-destructive',
  pending: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
};

/**
 * One row of the plan. A task that failed or was skipped says why under its
 * title — `Skipped: it depends on "Research", which failed.` — because the
 * run-level error alone says only that something went wrong, not where
 * (vocion-core#121).
 * @param props - The task and its place in the plan.
 * @param props.task - The task.
 * @param props.position - Its one-based position in the plan.
 */
function PlanTaskRow({ task, position }: { task: PlanTask; position: number }) {
  const showReason = Boolean(task.error) && (task.status === 'failed' || task.status === 'skipped');
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 text-xs text-muted-foreground">{position}</span>
      <span className="min-w-0 flex-1">
        <span className="block">{task.title}</span>
        <span className="block text-xs text-muted-foreground">
          {task.ownerAgentSlug}
          {' '}
          ·
          {' '}
          {task.type}
        </span>
        {showReason && (
          <span className={`mt-1 block text-xs whitespace-pre-wrap ${task.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {task.error}
          </span>
        )}
      </span>
      <span className={`text-[11px] ${TASK_STATUS_TONE[task.status] ?? 'text-muted-foreground'}`}>{task.status.replace('_', ' ')}</span>
    </li>
  );
}

/**
 * A mission run's plan, one row per task, or "Planning…" before there is one.
 * @param props - The plan.
 * @param props.tasks - The run's tasks, in plan order.
 */
export function MissionRunPlan({ tasks }: { tasks: PlanTask[] }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">Planning…</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {tasks.map((task, i) => <PlanTaskRow key={task.id} task={task} position={i + 1} />)}
    </ol>
  );
}

/**
 * Why a run stopped, at the top of the page where a person looks first — the
 * same banner the workflow run page shows. It carries "Planning failed: …"
 * (vocion-core#122), "one or more tasks failed", or a cancel's reason; before
 * this it sat in small print at the bottom of the Coaching panel.
 * @param props - The run's status and error.
 * @param props.status - The run's status; only a failed or cancelled run shows the banner.
 * @param props.error - The run's error text.
 */
export function MissionRunStopReason({ status, error }: { status: string; error: string | null }) {
  if (!error || (status !== 'failed' && status !== 'cancelled')) {
    return null;
  }
  return (
    <div role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
        <OctagonAlert className="size-4" />
        {status === 'failed' ? 'Run failed' : 'Run cancelled'}
      </div>
      <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600/90 dark:text-red-400/90">
        {error}
      </pre>
    </div>
  );
}
