/**
 * playbook Card — a SKILL.md (a playbook or a skill), read whole from its
 * workspace folder and rendered the way the skills page renders it: the
 * frontmatter as a quiet meta line, the body as markdown.
 *
 * The spec is the authored file (`libs/workspace/source.ts`). The markdown
 * renderer is the markdown card's — one prose renderer, not a second one.
 */

import type { PlaybookSourceSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { parse as parseYaml } from 'yaml';
import { playbookSpecSchema } from '../specs';
import { MarkdownCardView } from './markdown';

export const PLAYBOOK_SLUG = 'playbook';

type Frontmatter = { name?: string; description?: string; playbooks: string[]; version?: number; license?: string };

/**
 * The frontmatter and the body, tolerating a file mid-edit: no frontmatter
 * means the whole text is the body.
 * @param md
 */
export function splitPlaybook(md: string): { meta: Frontmatter | null; body: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: null, body: md };
  }
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? '');
  } catch {
    return { meta: null, body: match[2] ?? '' };
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  return {
    meta: {
      name: str(r.name),
      description: str(r.description),
      playbooks: Array.isArray(r.playbooks) ? r.playbooks.filter((x): x is string => typeof x === 'string') : [],
      version: typeof r.version === 'number' ? r.version : undefined,
      license: str(r.license),
    },
    body: (match[2] ?? '').trim(),
  };
}

export function PlaybookCardView({ data, surface }: { data: PlaybookSourceSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const { meta, body } = splitPlaybook(data.md);
  if (dense) {
    return (
      <article className="min-w-0 text-sm" data-playbook-card="dense">
        <p className="font-medium text-foreground">{meta?.name ?? data.slug}</p>
        {meta?.description && <p className="mt-0.5 line-clamp-3 text-muted-foreground">{meta.description}</p>}
      </article>
    );
  }
  return (
    <article className="min-w-0" data-playbook-card="full">
      <header className="mb-4 border-b border-border/60 pb-3">
        <p className="text-[12px] text-muted-foreground">
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] tracking-wide uppercase">{data.kind}</span>
          {' '}
          <code className="font-mono">{data.slug}</code>
          {meta?.version !== undefined && ` · v${meta.version}`}
          {meta?.license && ` · ${meta.license}`}
        </p>
        {meta?.description && <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>}
        {meta && meta.playbooks.length > 0 && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Attaches:
            {' '}
            {meta.playbooks.join(', ')}
          </p>
        )}
      </header>
      {body.trim().length > 0
        ? <MarkdownCardView data={{ md: body }} surface={surface} />
        : <p className="text-sm text-muted-foreground italic">No body yet — the frontmatter is all there is.</p>}
    </article>
  );
}

export const playbookCard = defineCard({
  slug: PLAYBOOK_SLUG,
  name: 'Playbook',
  description: 'A workspace playbook or skill — its SKILL.md read whole. Edited in place; every save is a version and a workspace apply.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: playbookSpecSchema,
  Renderer: ({ data, surface }) => <PlaybookCardView data={data} surface={surface} />,
});
