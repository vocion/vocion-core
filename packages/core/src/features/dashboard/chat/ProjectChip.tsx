'use client';

import type { ThreadProject } from './useChatSession';
import { FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/libs/I18nNavigation';

/**
 * The Project a conversation works for, in its header: one quiet chip that
 * opens the project. Its turns use that project's connections and no other
 * project's (`services/connect/connectionScope.ts`), so the person can see
 * whose GitHub or Squarespace an answer may reach (principle 10).
 * @param props - The chip.
 * @param props.project - The project, or null for none (renders nothing).
 * @param props.testId - Where it sits, for tests.
 */
export function ProjectChip({ project, testId = 'conversation-project' }: { project: ThreadProject | null; testId?: string }) {
  const t = useTranslations('Chat');
  if (!project) {
    return null;
  }
  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      title={t('project_chip_hint', { name: project.title })}
      className="inline-flex max-w-48 min-w-0 shrink items-center gap-1 rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
      data-testid={testId}
    >
      <FolderOpen className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{t('project_chip', { name: project.title })}</span>
    </Link>
  );
}
