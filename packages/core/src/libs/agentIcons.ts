import type { LucideIcon } from 'lucide-react';
import { Bot, Compass, Ear, FileText, Send, Sparkles, TrendingUp, Users } from 'lucide-react';

/**
 * Map an agent's authored `icon` string (workspace YAML `icon:`) to a Lucide
 * component. Keeps the agents pages honoring the authored icon instead of
 * hardcoding one. Unknown/absent names fall back to a sensible default:
 * `Compass` for primaries (a front-door / coordinator), `Bot` for specialists.
 */
const ICONS: Record<string, LucideIcon> = {
  'compass': Compass,
  'users': Users,
  'send': Send,
  'trending-up': TrendingUp,
  'file-text': FileText,
  'ear': Ear,
  'sparkles': Sparkles,
  'bot': Bot,
};

export function agentIcon(name: string | null | undefined, opts?: { primary?: boolean }): LucideIcon {
  if (name && ICONS[name]) {
    return ICONS[name];
  }
  return opts?.primary ? Compass : Bot;
}
