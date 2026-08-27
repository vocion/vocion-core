/**
 * Surface registry — the optional dashboard surfaces a workspace can switch
 * on. Route, page, label, icon and sidebar section all live HERE in core; a
 * workspace only names the id in `workspace.yaml`:
 *
 *   surfaces: [personalization]
 *
 * That split is the point. Config turns a surface on; it never authors a URL,
 * so a workspace cannot produce a dead link. Naming an unregistered id fails
 * at `workspace:check` rather than rendering a 404 into the sidebar.
 *
 * Always-on surfaces (chat, review, activity…) stay hardcoded in AppSidebar —
 * they are the product, not options.
 *
 * Pure data, no React: the workspace loader imports this from the CLI, so an
 * icon is a lucide NAME resolved to a component in `SURFACE_ICONS`.
 */

export type Surface = {
  /**
   * Route. Must be a real page under `app/[locale]/(auth)/<segment>/`, where
   * `<segment>` names the section (`/gtm/personalization`), and that segment
   * needs an `(auth)/<segment>/layout.tsx` rendering `AppShell`. The first
   * segment is auto-protected — see SURFACE_PATH_SEGMENTS.
   */
  url: string;
  /** Sidebar link text. */
  label: string;
  /** Sidebar group heading. Surfaces sharing a section render under one heading. */
  section: string;
  /** lucide-react icon name — see SURFACE_ICONS. */
  icon: string;
  /** Shown in the workspace docs + apply summary, not in the sidebar. */
  description: string;
};

export const SURFACES = {
  personalization: {
    url: '/gtm/personalization',
    label: 'Personalization',
    section: 'GTM',
    icon: 'sparkles',
    description: 'Review queue for MQLs the personalization agent has briefed and drafted a sequence for.',
  },
  discovery: {
    url: '/gtm/discovery',
    label: 'Discovery ledger',
    section: 'GTM',
    icon: 'radar',
    description: 'Every call the discovery-detection sweep assessed, with scores, thresholds and the human decision.',
  },
} as const satisfies Record<string, Surface>;

/**
 * First path segment of every registered surface (`gtm`, …), deduped.
 *
 * The auth proxy builds its protected-path pattern from this, so registering
 * a surface under a NEW segment protects it automatically. Hardcoding the
 * list there instead would mean a future section ships publicly readable
 * until someone remembers to edit a regex.
 */
export const SURFACE_PATH_SEGMENTS: string[] = [
  ...new Set(Object.values(SURFACES).map(s => s.url.split('/')[1]!)),
];

export type SurfaceId = keyof typeof SURFACES;

export const SURFACE_IDS = Object.keys(SURFACES) as SurfaceId[];

export function isSurfaceId(id: string): id is SurfaceId {
  return Object.hasOwn(SURFACES, id);
}

export type SurfaceSection = {
  label: string;
  items: Array<{ id: SurfaceId; label: string; url: string; icon: string }>;
};

/**
 * Group enabled surfaces into sidebar sections. Sections come out in the
 * order their FIRST surface is listed, so the workspace author controls
 * placement by ordering `surfaces:` and needs no second ordering key.
 *
 * Ids are validated at workspace load, but a core that dropped a surface can
 * still meet a workspace that names it, so unknown ids are skipped rather
 * than rendered as a broken link.
 * @param enabled - surface ids from `project.enabledSurfaces`
 */
export function groupEnabledSurfaces(enabled: string[]): SurfaceSection[] {
  const sections: SurfaceSection[] = [];

  for (const id of enabled) {
    if (!isSurfaceId(id)) {
      continue;
    }
    const surface = SURFACES[id];
    let section = sections.find(s => s.label === surface.section);
    if (!section) {
      section = { label: surface.section, items: [] };
      sections.push(section);
    }
    section.items.push({ id, label: surface.label, url: surface.url, icon: surface.icon });
  }

  return sections;
}
