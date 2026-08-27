'use client';

import type { LucideIcon } from 'lucide-react';
import type { SurfaceId } from './surfaces';
import { Radar, Shapes, Sparkles } from 'lucide-react';
import { AppSidebarNav } from '@/features/dashboard/AppSidebarNav';
import { groupEnabledSurfaces } from './surfaces';

/**
 * Renders the surfaces a workspace switched on, grouped under their registry
 * `section`. Grouping lives in `groupEnabledSurfaces`; this component only
 * turns icon NAMES into components (the registry is imported by the CLI
 * loader and has to stay React-free).
 * @param props
 * @param props.enabled - surface ids from `project.enabledSurfaces`
 */

const SURFACE_ICONS: Record<string, LucideIcon> = {
  radar: Radar,
  sparkles: Sparkles,
};

/** Unknown icon name renders as a generic shape rather than crashing the shell. */
const FALLBACK_ICON = Shapes;

export const SurfaceNav = (props: { enabled: SurfaceId[] }) => (
  <>
    {groupEnabledSurfaces(props.enabled).map(section => (
      <AppSidebarNav
        key={section.label}
        label={section.label}
        items={section.items.map(item => ({
          title: item.label,
          url: item.url,
          icon: SURFACE_ICONS[item.icon] ?? FALLBACK_ICON,
        }))}
      />
    ))}
  </>
);
