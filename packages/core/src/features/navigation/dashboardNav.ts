import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Blocks,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Code2,
  Compass,
  Cpu,
  Database,
  FileCode2,
  FileStack,
  FolderOpen,
  Gauge,
  GitBranch,
  Inbox,
  LineChart,
  MessageSquare,
  Network,
  Newspaper,
  Plug,
  ShieldCheck,
  Sparkles,
  Store,
  TestTube,
  TrendingUp,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

/**
 * The dashboard's route registry — the ONE list the sidebar (both views), the
 * ⌘K palette and the breadcrumb read, so a page is grouped, ordered, named and
 * gated the same way everywhere (nav sweep, Chris 2026-09-15). Add a page
 * here and it appears in all three; there is no second list to keep in step.
 *
 * Groups: `Workspace` is the WORK view (the daily driver). `Team` … `Organization`
 * are the MANAGE view's sections, in this order. `You` is personal (Profile) —
 * reachable from the avatar menu and the palette, never a manage section.
 */

export type DashboardGroupId = 'Workspace' | 'Team' | 'Knowledge' | 'Build' | 'Insights' | 'Organization' | 'You';

/** A key of the `DashboardLayout` message namespace — typed against en.json so a label cannot point at a string that does not exist. */
export type DashboardLayoutKey = keyof (typeof import('@/locales/en.json'))['DashboardLayout'];

export type DashboardGroup = {
  id: DashboardGroupId;
  /** English heading — what the palette shows. */
  title: string;
  /** `DashboardLayout` message key for the sidebar's translated heading. */
  i18nKey?: DashboardLayoutKey;
  /** Rendered as a section of the sidebar's MANAGE view. */
  manage: boolean;
};

export const DASHBOARD_GROUPS: readonly DashboardGroup[] = [
  { id: 'Workspace', title: 'Workspace', i18nKey: 'main_section_label', manage: false },
  { id: 'Team', title: 'Team', i18nKey: 'team_section_label', manage: true },
  { id: 'Knowledge', title: 'Knowledge', i18nKey: 'knowledge_section_label', manage: true },
  { id: 'Build', title: 'Build', i18nKey: 'build_section_label', manage: true },
  { id: 'Insights', title: 'Insights', i18nKey: 'insights_section_label', manage: true },
  { id: 'Organization', title: 'Organization', i18nKey: 'organization_section_label', manage: true },
  { id: 'You', title: 'You', i18nKey: 'you_section_label', manage: false },
];

export type DashboardRoute = {
  url: string;
  /** English title — the palette row, the breadcrumb, and the sidebar fallback. */
  title: string;
  group: DashboardGroupId;
  icon: LucideIcon;
  /** `DashboardLayout` message key for the sidebar's translated label. */
  i18nKey?: DashboardLayoutKey;
  /** Extra words the palette should match on. */
  keywords?: string[];
  /** Hidden from the palette and the sidebar for non-admins (still used for breadcrumbs). */
  adminOnly?: boolean;
  /**
   * This route is one TAB of a combined page (the url of the page that owns
   * the tab strip). Tabs keep their own URL so deep links, pins and the
   * breadcrumb still work; the sidebar shows the owner and reveals the tabs
   * beneath it while you are on that page.
   */
  tabOf?: string;
  /**
   * A palette row only — never a sidebar row, never a breadcrumb owner. For an
   * alias onto a filtered view of a page that is already in the nav, so old
   * muscle memory ("review") still finds the work without a second door to it.
   */
  paletteOnly?: boolean;
  /** For the page that OWNS a tab strip: the label of its own first tab (its title names the whole page). */
  tabTitle?: string;
  /** `DashboardLayout` message key for `tabTitle`. */
  tabI18nKey?: DashboardLayoutKey;
  /**
   * A WORK row that earns its place: shown in the Workspace group only while
   * pinned, otherwise one row down under "More". Chat and Review are never
   * this — they are the surface (Chris, 2026-09-18).
   */
  pinnable?: true;
  /** A pinnable row that starts pinned for everyone until they unpin it. */
  defaultPinned?: true;
  /**
   * The plugin that owns this page (`workspace.yaml` `plugins:`). The row —
   * sidebar, palette, breadcrumb owner — shows only while that plugin is on;
   * the route itself stays reachable, so a deep link never 404s.
   */
  plugin?: string;
  /**
   * A plugin that ALSO lists this core route in its own section, under
   * "More ›", without owning it — the row stays where it is for every other
   * workspace. Chris, 2026-09-24: the factory's reference sets "visible
   * inside the SF UI — for now a menu item unpinned under More".
   */
  offeredBy?: string;
};

export const DASHBOARD_ROUTES: readonly DashboardRoute[] = [
  // ── WORK ────────────────────────────────────────────────────────────────
  { url: '/dashboard/chat', title: 'Chat', group: 'Workspace', icon: MessageSquare, i18nKey: 'chat', keywords: ['ask', 'agent'] },
  { url: '/dashboard/inbox', title: 'Review', group: 'Workspace', icon: Inbox, i18nKey: 'inbox', keywords: ['inbox', 'decisions', 'asks', 'approvals', 'proposals', 'review', 'queue'] },
  { url: '/dashboard/briefings', title: 'Briefings', group: 'Workspace', icon: Newspaper, i18nKey: 'briefings', pinnable: true, defaultPinned: true },
  // Everything an agent or a person made beside a conversation — live,
  // versioned, editable. Replaces Canvases, whose saved tile arrangements
  // nobody arranged twice (`/dashboard/canvases` 308s here).
  { url: '/dashboard/artifacts', title: 'Artifacts', group: 'Workspace', icon: FileStack, keywords: ['canvas', 'canvases', 'documents', 'tables', 'charts', 'versions', 'history'], pinnable: true },
  // Review is no longer a place: the queue is the `proposal` kind of Review queue
  // (`/dashboard/review` 308s there). The row stays as a PALETTE alias so typing
  // "review" still lands where the work is, without a second sidebar door.
  { url: '/dashboard/inbox?kind=proposal', title: 'Review · Recommendations', group: 'Workspace', icon: CheckSquare, paletteOnly: true, keywords: ['review', 'approve', 'queue', 'hitl', 'proposals'] },
  // How the agents are doing, for the people working with them: agreement,
  // confidence and usage per agent. In the WORK view and open to members on
  // purpose (#342) — Adoption, under Insights, stays the admin's per-person view.
  { url: '/dashboard/scorecard', title: 'Scorecard', group: 'Workspace', icon: Gauge, i18nKey: 'scorecard', pinnable: true, defaultPinned: true, keywords: ['agreement', 'confidence', 'performance', 'alignment', 'how are the agents doing'] },
  { url: '/dashboard/search', title: 'Search', group: 'Workspace', icon: BookOpen, i18nKey: 'search', keywords: ['knowledge', 'retrieval'], pinnable: true },

  // ── MANAGE · Team — who works for you and the shapes their work takes ───
  { url: '/dashboard/teams', title: 'Teams & agents', tabTitle: 'Teams', tabI18nKey: 'teams', group: 'Team', icon: Network, i18nKey: 'teams_agents', keywords: ['org chart', 'roster', 'teams'] },
  { url: '/dashboard/agents', title: 'Agents', group: 'Team', icon: Users, i18nKey: 'agents', tabOf: '/dashboard/teams', keywords: ['roster', 'leads', 'specialists'] },
  { url: '/dashboard/missions', title: 'Missions', group: 'Team', icon: Compass, i18nKey: 'missions', keywords: ['goals', 'objectives'] },
  { url: '/dashboard/workflows', title: 'Workflows', group: 'Team', icon: GitBranch, i18nKey: 'workflows' },
  { url: '/dashboard/automation', title: 'Automations', group: 'Team', icon: CalendarClock, i18nKey: 'automations', keywords: ['schedules', 'cron', 'triggers', 'automation'] },

  // ── MANAGE · Knowledge — what the agents know, and about what ───────────
  { url: '/dashboard/connectors', title: 'Connectors', group: 'Knowledge', icon: Plug, i18nKey: 'sources', keywords: ['sources', 'integrations'] },
  { url: '/dashboard/objects', title: 'Objects', group: 'Knowledge', icon: Database, i18nKey: 'objects' },
  // One room per client engagement — the source of record the documents are
  // written from: status, cast, sources by weight, open items as asks. Under
  // Knowledge beside Objects (a room IS a record); the WORK view keeps its
  // five doors, and the rooms are one ⌘K away.
  { url: '/dashboard/rooms', title: 'Data rooms', group: 'Workspace', icon: FolderOpen, pinnable: true, plugin: 'data-rooms', keywords: ['data room', 'engagement', 'client', 'deal', 'proposal', 'transcripts', 'decision log'] },
  { url: '/dashboard/learnings', title: 'Learnings', group: 'Knowledge', icon: Sparkles, i18nKey: 'learnings', keywords: ['rules', 'feedback'] },
  { url: '/dashboard/workspace', title: 'Context', group: 'Knowledge', icon: FileCode2, i18nKey: 'context', keywords: ['workspace', 'yaml', 'workspace-as-code'] },

  // ── MANAGE · Build — what the agents can do ─────────────────────────────
  { url: '/dashboard/skills', title: 'Skills & tools', tabTitle: 'Skills', tabI18nKey: 'skills', group: 'Build', icon: Zap, i18nKey: 'skills_tools', keywords: ['playbooks', 'skills'] },
  { url: '/dashboard/tools', title: 'Tools', group: 'Build', icon: Wrench, i18nKey: 'tools', tabOf: '/dashboard/skills', keywords: ['capabilities', 'web search', 'keys'] },
  { url: '/dashboard/models', title: 'Vision models', group: 'Build', icon: Cpu, i18nKey: 'vision_models', tabOf: '/dashboard/skills', keywords: ['rekognition', 'classifier', 'analyze'] },
  { url: '/dashboard/evals', title: 'Evals', group: 'Build', icon: TestTube, i18nKey: 'evals', offeredBy: 'software-factory', keywords: ['tests', 'datasets', 'reference sets', 'gold standards'] },
  // Where you go to ADD capability, as against Teams & agents, which is what
  // you already have (Chris, 2026-09-19: "Teams/Agents = where you go to see
  // your agents and capabilities. Marketplace = where you go to add capability
  // (hire agents, enable plugins)"). Two tabs, because the plugins this core
  // ships and the catalog agents nobody has hired are two lists, not one long
  // page. Under Build beside Skills & tools and Evals because both are
  // capability.
  { url: '/dashboard/marketplace', title: 'Marketplace', tabTitle: 'Agents for hire', tabI18nKey: 'agents_for_hire', group: 'Build', icon: Store, i18nKey: 'marketplace', keywords: ['catalog', 'hire', 'recruit', 'roles', 'inactive agents', 'plugin', 'plugins', 'module', 'modules', 'apps', 'install', 'enable', 'turn on', 'wiki', 'data rooms', 'proposals'] },
  // The second tab. Hiring is what a person comes here for most often, so the
  // owner URL is the agent catalog (Chris, 2026-09-20: "flip agents and
  // plugins on these tabs"); plugins keep a stable URL of their own, and
  // `/dashboard/plugins` still lands on them.
  { url: '/dashboard/marketplace/plugins', title: 'Plugins', group: 'Build', icon: Blocks, i18nKey: 'plugins', tabOf: '/dashboard/marketplace', keywords: ['plugin', 'plugins', 'module', 'modules', 'apps', 'install', 'enable', 'turn on', 'wiki', 'data rooms', 'proposals'] },

  // ── MANAGE · Insights — how it is going ─────────────────────────────────
  { url: '/dashboard/team-report', title: 'Team report', group: 'Insights', icon: Network, i18nKey: 'team_report', keywords: ['outcome', 'kpi', 'spend', 'members'] },
  { url: '/dashboard/activity', title: 'Activity', group: 'Insights', icon: Activity, i18nKey: 'activity', keywords: ['runs', 'logs', 'history'] },
  { url: '/dashboard/observability', title: 'Observability', group: 'Insights', icon: LineChart, i18nKey: 'observability', keywords: ['langfuse', 'traces', 'spend'] },
  { url: '/dashboard/autonomy', title: 'Autonomy', group: 'Insights', icon: TrendingUp, i18nKey: 'autonomy', keywords: ['ladder', 'trust', 'promote'] },
  { url: '/dashboard/adoption', title: 'Adoption', group: 'Insights', icon: BarChart3, i18nKey: 'adoption', adminOnly: true, keywords: ['usage', 'logins'] },

  // ── MANAGE · Organization — the account itself ──────────────────────────
  { url: '/dashboard/members', title: 'Members', group: 'Organization', icon: UserPlus, i18nKey: 'members', keywords: ['users', 'invite', 'settings'] },
  { url: '/dashboard/developers', title: 'Developers', group: 'Organization', icon: Code2, i18nKey: 'developers', keywords: ['api', 'tokens', 'credentials', 'keys', 'mcp', 'sdk', 'docs'] },
  // The one row that leaves the dashboard shell: the reference is a full-page
  // Swagger UI an integrator keeps open beside their editor, so it renders on
  // its own route rather than inside the sidebar layout.
  { url: '/api-docs', title: 'Swagger Docs', group: 'Organization', icon: BookOpen, keywords: ['api', 'openapi', 'swagger', 'reference', 'endpoints', 'docs'] },
  { url: '/dashboard/admin', title: 'System', group: 'Organization', icon: ShieldCheck, i18nKey: 'system', keywords: ['status', 'admin', 'settings', 'health'] },

  // ── YOU — personal, not the workspace's ─────────────────────────────────
  { url: '/dashboard/profile', title: 'Profile', group: 'You', icon: Users, i18nKey: 'profile', keywords: ['account', 'password', 'name'] },
];

/**
 * The route registered at exactly this path, if any.
 * @param url
 */
export function dashboardRoute(url: string): DashboardRoute | undefined {
  return DASHBOARD_ROUTES.find(r => r.url === url);
}

/**
 * Who is looking, for gating rows: admin-only rows drop out for members, and
 * a plugin-owned row shows only while its plugin is on. `enabledPlugins`
 * undefined means "don't gate on plugins" (a caller with no project in hand).
 */
export type NavViewer = { isAdmin?: boolean; enabledPlugins?: readonly string[] };

/**
 * Whether a route is offered to this viewer.
 * @param r - The route.
 * @param viewer - Who is looking.
 */
export function routeVisible(r: DashboardRoute, viewer: NavViewer): boolean {
  if (r.adminOnly && !viewer.isAdmin) {
    return false;
  }
  if (r.plugin && viewer.enabledPlugins && !viewer.enabledPlugins.includes(r.plugin)) {
    return false;
  }
  return true;
}

/**
 * Routes a person may see: admin-only rows drop out for members, plugin rows
 * for workspaces without the plugin.
 * @param viewer - Who is looking (a bare boolean is the legacy `isAdmin`).
 */
function visibleRoutes(viewer: NavViewer | boolean): DashboardRoute[] {
  const v = typeof viewer === 'boolean' ? { isAdmin: viewer } : viewer;
  return DASHBOARD_ROUTES.filter(r => routeVisible(r, v));
}

/**
 * The WORK view's rows, in order. Palette-only aliases are not rows.
 * @param viewer - Who is looking; omitted = every row.
 */
export function workRoutes(viewer: NavViewer = {}): DashboardRoute[] {
  return DASHBOARD_ROUTES.filter(r => r.group === 'Workspace' && !r.paletteOnly && routeVisible(r, { ...viewer, isAdmin: true }));
}

/**
 * The WORK rows that are always there — the surface itself: Chat, Review.
 * @param viewer - Who is looking.
 */
export function workCoreRoutes(viewer: NavViewer = {}): DashboardRoute[] {
  return workRoutes(viewer).filter(r => !r.pinnable);
}

/**
 * The WORK rows a person pins into the Workspace group; unpinned they sit under "More".
 * @param viewer - Who is looking.
 */
export function workPinnableRoutes(viewer: NavViewer = {}): DashboardRoute[] {
  return workRoutes(viewer).filter(r => r.pinnable);
}

/** The pinnable WORK rows everyone starts with pinned (Briefings). */
export const DEFAULT_WORK_PINS: readonly string[] = DASHBOARD_ROUTES.filter(r => r.pinnable && r.defaultPinned).map(r => r.url);

/**
 * The MANAGE view's sections, each with its top-level rows (tabs excluded) in registry order.
 * @param viewer - Who is looking (a bare boolean is the legacy `isAdmin`).
 */
export function manageNavGroups(viewer: NavViewer | boolean): Array<{ group: DashboardGroup; routes: DashboardRoute[] }> {
  return DASHBOARD_GROUPS
    .filter(g => g.manage)
    .map(group => ({ group, routes: visibleRoutes(viewer).filter(r => r.group === group.id && !r.tabOf) }));
}

/**
 * Every MANAGE row a person can pin — top-level pages AND their tabs (a tab is a destination too).
 * @param viewer - Who is looking (a bare boolean is the legacy `isAdmin`).
 */
export function manageRoutes(viewer: NavViewer | boolean): DashboardRoute[] {
  const manageIds = new Set(DASHBOARD_GROUPS.filter(g => g.manage).map(g => g.id));
  return visibleRoutes(viewer).filter(r => manageIds.has(r.group));
}

/**
 * The tabs of a combined page, owner first, in registry order. Empty when `url` owns no tabs.
 * @param url
 */
export function tabsOf(url: string): DashboardRoute[] {
  const owner = dashboardRoute(url);
  const tabs = DASHBOARD_ROUTES.filter(r => r.tabOf === url);
  return owner && tabs.length > 0 ? [owner, ...tabs] : [];
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
