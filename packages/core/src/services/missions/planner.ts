/**
 * Mission planner — turns an open-ended brief into a task graph by asking
 * the lead agent to produce a structured plan. Tolerant JSON extraction with
 * a safe single-task fallback so a mission always has a runnable plan.
 */

import { runAgentDeep } from '@/services/AgentService';

export type PlannedTask = {
  id: string;
  title: string;
  ownerAgentSlug: string;
  type: 'analysis' | 'creative' | 'synthesis' | 'artifact' | 'diagnostic' | 'action';
  status: 'pending';
  dependsOn?: string[];
  approvalRequired?: boolean;
};

const TASK_TYPES = ['analysis', 'creative', 'synthesis', 'artifact', 'diagnostic', 'action'];

function planningPrompt(brief: string, goal: string | undefined, team: { lead: string; members: string[] }): string {
  const roster = [team.lead, ...team.members].join(', ');
  return [
    'You are the lead of an AI team planning an open-ended mission. Break the brief into a short,',
    'ordered task graph (4–8 tasks). Assign each task to ONE teammate by their exact slug.',
    '',
    `Brief: ${brief}`,
    goal ? `Goal: ${goal}` : '',
    `Team (assign tasks only to these slugs): ${roster}`,
    '',
    'Reply with ONLY a fenced ```json block of this shape:',
    '{"tasks":[{"id":"t1","title":"...","ownerAgentSlug":"<slug>","type":"analysis|creative|synthesis|artifact|diagnostic|action","dependsOn":["t0"],"approvalRequired":false}]}',
    'Rules: ids are t1..tN; the final task should be a synthesis or artifact owned by the lead;',
    'mark a task approvalRequired:true only if it sends/changes something external.',
  ].filter(Boolean).join('\n');
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function planMission(opts: {
  orgId: string;
  brief: string;
  goal?: string;
  team: { lead: string; members: string[] };
  userId?: string;
}): Promise<PlannedTask[]> {
  const validSlugs = new Set([opts.team.lead, ...opts.team.members]);
  let raw = '';
  try {
    const result = await runAgentDeep({
      orgId: opts.orgId,
      agentSlug: opts.team.lead,
      message: planningPrompt(opts.brief, opts.goal, opts.team),
      userId: opts.userId,
    });
    raw = result.response;
  } catch {
    raw = '';
  }

  const parsed = extractJson(raw) as { tasks?: unknown[] } | null;
  const tasks: PlannedTask[] = [];
  if (parsed && Array.isArray(parsed.tasks)) {
    parsed.tasks.forEach((t, i) => {
      const obj = t as Record<string, unknown>;
      const owner = typeof obj.ownerAgentSlug === 'string' && validSlugs.has(obj.ownerAgentSlug)
        ? obj.ownerAgentSlug
        : opts.team.lead;
      const type = typeof obj.type === 'string' && TASK_TYPES.includes(obj.type) ? obj.type : 'analysis';
      tasks.push({
        id: typeof obj.id === 'string' && obj.id ? obj.id : `t${i + 1}`,
        title: typeof obj.title === 'string' && obj.title ? obj.title : `Task ${i + 1}`,
        ownerAgentSlug: owner,
        type: type as PlannedTask['type'],
        status: 'pending',
        dependsOn: Array.isArray(obj.dependsOn) ? (obj.dependsOn as string[]) : undefined,
        approvalRequired: obj.approvalRequired === true,
      });
    });
  }

  // Fallback: a single synthesis task owned by the lead, so the mission always runs.
  if (tasks.length === 0) {
    tasks.push({
      id: 't1',
      title: 'Complete the brief',
      ownerAgentSlug: opts.team.lead,
      type: 'synthesis',
      status: 'pending',
    });
  }
  return tasks;
}
