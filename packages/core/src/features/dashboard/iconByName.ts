import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BookOpen, Bot, Box, Bug, Building2, CircleHelp, Cpu, Database, FileText, FolderOpen, GitBranch, Globe, Layers, LayoutDashboard, LifeBuoy, Lightbulb, ListChecks, Mail, Megaphone, Package, PanelsTopLeft, Puzzle, Radar, Rocket, Send, Server, Shapes, Shield, Siren, Sparkles, Target, Users, Video, Zap } from 'lucide-react';

/**
 * lucide icon NAMES a workspace row may carry — a plugin, a page, a product
 * (`icon: send`) — resolved to a component here, once, so the YAML-side
 * registries stay React-free and every surface that draws a named icon
 * draws the same one. Unknown names fall back to a generic shape, never to
 * a crash: a typo in a workspace file is not a reason for a page to fail.
 */
export const ICONS_BY_NAME: Record<string, LucideIcon> = {
  'alert-triangle': AlertTriangle,
  'book-open': BookOpen,
  'bot': Bot,
  'box': Box,
  'bug': Bug,
  'building-2': Building2,
  'circle-help': CircleHelp,
  'cpu': Cpu,
  'database': Database,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'git-branch': GitBranch,
  'globe': Globe,
  'layers': Layers,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  'lightbulb': Lightbulb,
  'list-checks': ListChecks,
  'mail': Mail,
  'megaphone': Megaphone,
  'package': Package,
  'panels-top-left': PanelsTopLeft,
  'puzzle': Puzzle,
  'radar': Radar,
  'rocket': Rocket,
  'send': Send,
  'server': Server,
  'shield': Shield,
  'siren': Siren,
  'sparkles': Sparkles,
  'target': Target,
  'users': Users,
  'video': Video,
  'zap': Zap,
};

/**
 * The icon a name means, or a generic shape.
 * @param name - A lucide icon name as written in YAML (`panels-top-left`).
 * @param fallback - What an unknown name draws.
 */
export function iconByName(name: string | null | undefined, fallback: LucideIcon = Shapes): LucideIcon {
  return (name && ICONS_BY_NAME[name.trim().toLowerCase()]) || fallback;
}
