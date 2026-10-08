import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AudioLines,
  BarChart3,
  Bug,
  Building2,
  Calendar,
  Cloud,
  Contact,
  CreditCard,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  GitPullRequest,
  Globe,
  Handshake,
  Landmark,
  Mail,
  Megaphone,
  MessageSquare,
  Mic,
  NotebookPen,
  NotebookText,
  Pencil,
  PhoneCall,
  Plug,
  Radar,
  Receipt,
  SquareKanban,
  Users,
  Video,
  Wallet,
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
  Building2,
  Calendar,
  Cloud,
  Contact,
  CreditCard,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  GitPullRequest,
  Globe,
  Handshake,
  Landmark,
  Mail,
  Megaphone,
  MessageSquare,
  Mic,
  NotebookPen,
  NotebookText,
  Pencil,
  PhoneCall,
  Plug,
  Radar,
  Receipt,
  SquareKanban,
  Users,
  Video,
  Wallet,
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
