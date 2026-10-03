import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BookOpen, Bot, Box, Bug, CheckCheck, CircleHelp, ClipboardCheck, Cpu, Database, FileDiff, FileText, FolderOpen, Gauge, GitBranch, Globe, KeyRound, Layers, LayoutDashboard, Lightbulb, ListChecks, Mail, MessageCircleQuestion, Package, PanelsTopLeft, Puzzle, Radar, Receipt, Rocket, Send, Server, Shapes, Shield, Siren, Sparkles, Video, Zap } from 'lucide-react';

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
  'check-check': CheckCheck,
  'circle-help': CircleHelp,
  'clipboard-check': ClipboardCheck,
  'cpu': Cpu,
  'database': Database,
  'file-diff': FileDiff,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'gauge': Gauge,
  'git-branch': GitBranch,
  'globe': Globe,
  'key-round': KeyRound,
  'layers': Layers,
  'layout-dashboard': LayoutDashboard,
  'lightbulb': Lightbulb,
  'list-checks': ListChecks,
  'mail': Mail,
  'message-circle-question': MessageCircleQuestion,
  'package': Package,
  'panels-top-left': PanelsTopLeft,
  'puzzle': Puzzle,
  'radar': Radar,
  'receipt': Receipt,
  'rocket': Rocket,
  'send': Send,
  'server': Server,
  'shield': Shield,
  'siren': Siren,
  'sparkles': Sparkles,
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
