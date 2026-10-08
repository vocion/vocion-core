import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AudioLines,
  BarChart3,
  Bug,
  Calendar,
  Contact,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  GitPullRequest,
  Globe,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  NotebookText,
  Pencil,
  Plug,
  Radar,
  SquareKanban,
  Video,
} from 'lucide-react';

/**
 * The Lucide icons connectors name in their `icon` field (`libs/sources/*.ts`),
 * listed rather than looked up off the whole namespace, which would pull every
 * icon into the client bundle. It is what a connector's tile draws when its
 * brand has no logo (`IntegrationLogo`). `connectorIcon.test.ts` holds every
 * registered connector's icon to this list.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  AudioLines,
  BarChart3,
  Bug,
  Calendar,
  Contact,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  GitPullRequest,
  Globe,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  NotebookText,
  Pencil,
  Plug,
  Radar,
  SquareKanban,
  Video,
};

/**
 * The icon a connector names, or the plug for a name not in the list.
 * @param name - The connector's `icon`.
 */
export function connectorIcon(name: string): LucideIcon {
  return Object.hasOwn(ICONS, name) ? ICONS[name]! : Plug;
}

/**
 * Whether the list carries a connector's icon.
 * @param name - The connector's `icon`.
 */
export function hasConnectorIcon(name: string): boolean {
  return Object.hasOwn(ICONS, name);
}
