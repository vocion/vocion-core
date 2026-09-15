/**
 * Export a saved canvas as a workspace page (`docs/workspace-pages.md`).
 *
 * A canvas is what one person arranged beside one conversation; a workspace
 * page is the same view for everyone, versioned in the workspace repo. The
 * mapping is deliberately partial — only tiles that correspond to a page
 * archetype are exported, and the rest are listed so the person knows what
 * to build by hand:
 *
 *   markdown tile → `archetype: markdown` (the md becomes the sibling file)
 *   table tile    → `archetype: list` over a `documents`/`objects` source is
 *                   NOT derivable from static rows, so the rows are embedded
 *                   in the sibling .md as a GFM table under a heading
 *   chart / record / link / file → listed as unsupported (no archetype yet)
 *
 * The result is two files a person commits: `pages/<slug>.yaml` and
 * `pages/<slug>.md`. Nothing is written to the workspace from here — the
 * app cannot write a tenant's repo; the person does, through a PR.
 */

import type { ArtifactRow, CanvasRow } from '@/services/ArtifactService';
import { stringify } from 'yaml';
import { PageManifestSchema } from '@/libs/workspace/pages';

export type CanvasPageExport = {
  slug: string;
  files: Array<{ path: string; content: string }>;
  /** Tiles that did not map to a page archetype, with why. */
  unsupported: Array<{ id: number; title: string; kind: string; reason: string }>;
};

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return s || 'canvas';
}

function mdEscape(v: unknown): string {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function tableToMarkdown(spec: Record<string, unknown>): string {
  const columns = (spec.columns as Array<{ key: string; label?: string }> | undefined) ?? [];
  const rows = (spec.rows as Array<Record<string, unknown>> | undefined) ?? [];
  if (columns.length === 0) {
    return '';
  }
  const head = `| ${columns.map(c => mdEscape(c.label ?? c.key)).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${columns.map(c => mdEscape(r[c.key])).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

export function exportCanvasAsPage(canvas: CanvasRow, artifacts: ArtifactRow[]): CanvasPageExport {
  const slug = slugify(canvas.name);
  const unsupported: CanvasPageExport['unsupported'] = [];
  const sections: string[] = [];

  for (const a of artifacts) {
    if (a.kind === 'markdown') {
      const title = (a.spec.title as string | undefined) ?? a.title;
      sections.push(`## ${title}\n\n${String(a.spec.md ?? '')}`);
    } else if (a.kind === 'table') {
      const md = tableToMarkdown(a.spec);
      if (md) {
        sections.push(`## ${a.title}\n\n${md}${a.spec.caption ? `\n\n_${String(a.spec.caption)}_` : ''}`);
      } else {
        unsupported.push({ id: a.id, title: a.title, kind: a.kind, reason: 'table has no columns' });
      }
    } else {
      unsupported.push({
        id: a.id,
        title: a.title,
        kind: a.kind,
        reason: a.kind === 'chart'
          ? 'no chart archetype yet — author a custom widget in pages/components/registry.tsx'
          : a.kind === 'record'
            ? 'records are live data — use archetype: list with source: {kind: objects}'
            : 'links and files are not page content',
      });
    }
  }

  const manifest = PageManifestSchema.parse({
    slug,
    title: canvas.name,
    description: `Saved from a Vocion canvas on ${canvas.createdAt.toISOString().slice(0, 10)}.`,
    nav: { section: 'Canvases', order: 0, hidden: false },
    archetype: 'markdown',
    contentFile: `${slug}.md`,
  });

  const yaml = `# Exported from canvas "${canvas.name}" (id ${canvas.id}) — edit freely; the canvas is not linked.\n${stringify(manifest)}`;
  const md = `# ${canvas.name}\n\n${sections.join('\n\n') || '_This canvas had no markdown or table tiles._'}\n`;

  return {
    slug,
    files: [
      { path: `pages/${slug}.yaml`, content: yaml },
      { path: `pages/${slug}.md`, content: md },
    ],
    unsupported,
  };
}
