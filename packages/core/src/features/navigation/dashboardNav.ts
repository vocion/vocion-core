import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Compass,
  Cpu,
  Database,
  GitBranch,
  KeyRound,
  LineChart,
  MessageSquare,
  Network,
  Newspaper,
  Plug,
  ShieldCheck,
  Sparkles,
  TestTube,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

/**
 * One entry in the dashboard's route registry — the single list the
 * breadcrumb and the ⌘K palette read so a page is named the same way in
 * both. The sidebar keeps its own translated lists (it groups differently);
 * a route added there should be added here too.
 */
export type DashboardRoute = {
  url: string;
  title: string;
  group: 'Workspace' | 'Team' | 'Knowledge' | 'Build' | 'Observability' | 'Organization';
  icon: LucideIcon;
  /** Extra words the palette should match on. */
  keywords?: string[];
  /** Hidden from the palette (still used for breadcrumbs). */
  adminOnly?: boolean;
};

export const DASHBOARD_ROUTES: DashboardRoute[] = [
  { url: '/dashboard/chat', title: 'Chat', group: 'Workspace', icon: MessageSquare, keywords: ['ask', 'agent'] },
  { url: '/dashboard/briefings', title: 'Briefings', group: 'Workspace', icon: Newspaper },
  { url: '/dashboard/review', title: 'Review', group: 'Workspace', icon: CheckSquare, keywords: ['approve', 'queue', 'hitl'] },
  { url: '/dashboard/activity', title: 'Activity', group: 'Workspace', icon: Activity, keywords: ['runs', 'logs', 'history'] },
  { url: '/dashboard/search', title: 'Search', group: 'Workspace', icon: BookOpen, keywords: ['knowledge', 'retrieval'] },
  { url: '/dashboard/teams', title: 'Teams', group: 'Team', icon: Network, keywords: ['org chart'] },
  { url: '/dashboard/agents', title: 'Agents', group: 'Team', icon: Users },
  { url: '/dashboard/missions', title: 'Missions', group: 'Team', icon: Compass },
  { url: '/dashboard/workflows', title: 'Workflows', group: 'Team', icon: GitBranch },
  { url: '/dashboard/automation', title: 'Automation', group: 'Team', icon: CalendarClock, keywords: ['schedules', 'cron', 'triggers'] },
  { url: '/dashboard/connectors', title: 'Connectors', group: 'Knowledge', icon: Plug, keywords: ['sources', 'integrations'] },
  { url: '/dashboard/objects', title: 'Objects', group: 'Knowledge', icon: Database },
  { url: '/dashboard/learnings', title: 'Learnings', group: 'Knowledge', icon: Sparkles, keywords: ['rules', 'feedback'] },
  { url: '/dashboard/skills', title: 'Skills', group: 'Build', icon: Zap, keywords: ['playbooks'] },
  { url: '/dashboard/tools', title: 'Tools', group: 'Build', icon: Wrench },
  { url: '/dashboard/models', title: 'Vision models', group: 'Build', icon: Cpu },
  { url: '/dashboard/evals', title: 'Evals', group: 'Build', icon: TestTube, keywords: ['tests', 'datasets'] },
  { url: '/dashboard/observability', title: 'Observability', group: 'Observability', icon: LineChart, keywords: ['langfuse', 'traces', 'spend'] },
  { url: '/dashboard/adoption', title: 'Adoption', group: 'Organization', icon: BarChart3, adminOnly: true },
  { url: '/dashboard/members', title: 'Members', group: 'Organization', icon: UserPlus, keywords: ['users', 'invite'] },
  { url: '/dashboard/api-tokens', title: 'API tokens', group: 'Organization', icon: KeyRound, adminOnly: true, keywords: ['credentials', 'keys'] },
  { url: '/dashboard/admin', title: 'System', group: 'Organization', icon: ShieldCheck, keywords: ['status', 'admin'] },
  { url: '/dashboard/workspace', title: 'Context', group: 'Build', icon: Database, keywords: ['workspace', 'yaml'] },
  { url: '/dashboard/profile', title: 'Profile', group: 'Organization', icon: Users },
];

/**
 * Title for a dashboard path, if it is a registered route.
 * @param url - Pathname without locale prefix.
 * @returns The route's title, or undefined for detail pages and unknown paths.
 */
export function dashboardRouteTitle(url: string): string | undefined {
  return DASHBOARD_ROUTES.find(r => r.url === url)?.title;
}

/**
 * Turn a slug segment into a readable label: `sales-assistant` → `Sales assistant`,
 * `proj-7fdf…` stays as is but truncated. Detail pages can override by
 * portalling their own leaf later; this is the fallback.
 * @param segment - One URL path segment.
 * @returns A human label.
 */
export function humanizeSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  if (/^\d+$/.test(decoded)) {
    return `#${decoded}`;
  }
  if (decoded.length > 28) {
    return `${decoded.slice(0, 26)}…`;
  }
  const words = decoded.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
