import type { LucideIcon } from 'lucide-react';
import { Activity, AlertTriangle, BarChart, BarChart3, BookOpen, Bot, Box, Bug, Building2, Calculator, Calendar, CircleHelp, Coins, Compass, Cpu, Database, Ear, FileClock, FileDiff, FileText, FolderOpen, Gauge, GitBranch, Globe, Hammer, Handshake, Inbox, Layers, LayoutDashboard, LifeBuoy, Lightbulb, LineChart, ListChecks, Mail, Megaphone, Package, PackageCheck, Palette, PanelsTopLeft, PenLine, PenTool, Puzzle, Radar, Radio, Receipt, Rocket, Route, Search, Send, Server, Settings, Shapes, Share2, Shield, ShieldCheck, Siren, Sparkles, Swords, Tags, Target, TrendingUp, UserCheck, Users, Video, Wand, Zap } from 'lucide-react';

/**
 * lucide icon NAMES a workspace row may carry — a plugin, a page, a product,
 * an agent (`icon: send`) — resolved to a component here, once, so the YAML-side
 * registries stay React-free and every surface that draws a named icon
 * draws the same one. Unknown names fall back to a generic shape, never to
 * a crash: a typo in a workspace file is not a reason for a page to fail.
 */
export const ICONS_BY_NAME: Record<string, LucideIcon> = {
  'activity': Activity,
  'alert-triangle': AlertTriangle,
  'bar-chart': BarChart,
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  'bot': Bot,
  'box': Box,
  'bug': Bug,
  'building-2': Building2,
  'calculator': Calculator,
  'calendar': Calendar,
  'circle-help': CircleHelp,
  'coins': Coins,
  'compass': Compass,
  'cpu': Cpu,
  'database': Database,
  'ear': Ear,
  'file-clock': FileClock,
  'file-diff': FileDiff,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'gauge': Gauge,
  'git-branch': GitBranch,
  'globe': Globe,
  'hammer': Hammer,
  'handshake': Handshake,
  'inbox': Inbox,
  'layers': Layers,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  'lightbulb': Lightbulb,
  'line-chart': LineChart,
  'list-checks': ListChecks,
  'mail': Mail,
  'megaphone': Megaphone,
  'package': Package,
  'package-check': PackageCheck,
  'palette': Palette,
  'panels-top-left': PanelsTopLeft,
  'pen-line': PenLine,
  'pen-tool': PenTool,
  'puzzle': Puzzle,
  'radar': Radar,
  'radio': Radio,
  'receipt': Receipt,
  'rocket': Rocket,
  'route': Route,
  'search': Search,
  'send': Send,
  'server': Server,
  'settings': Settings,
  'share-2': Share2,
  'shield': Shield,
  'shield-check': ShieldCheck,
  'siren': Siren,
  'sparkles': Sparkles,
  'swords': Swords,
  'tags': Tags,
  'target': Target,
  'trending-up': TrendingUp,
  'user-check': UserCheck,
  'users': Users,
  'video': Video,
  'wand': Wand,
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

/**
 * The icon an authored name means, or nothing — for a place that has its own
 * fallback (an agent's dot falls back to its initial, not to a shape).
 * @param name - A lucide icon name as written in YAML.
 */
export function authoredIcon(name: string | null | undefined): LucideIcon | undefined {
  return name ? ICONS_BY_NAME[name.trim().toLowerCase()] : undefined;
}
