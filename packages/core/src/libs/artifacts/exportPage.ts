/**
 * Export one artifact as a workspace page (`docs/workspace-pages.md`).
 *
 * An artifact is what one person worked out beside one conversation; a
 * workspace page is the same thing for everyone, versioned in the workspace
 * repo. That promotion is the manifesto's loop — a view one person needed
 * once becomes a page the team has (DESIGN-PRINCIPLES.md §6–7).
 *
 * The mapping is deliberately partial, and says so rather than pretending:
 *
 *   markdown → `archetype: markdown` (the body becomes the sibling file)
 *   table    → `archetype: list` over a live source is NOT derivable from
 *              static rows, so the rows are embedded in the sibling .md as a
 *              GFM table
 *   chart / record / link / file → refused with a reason; there is no page
 *              archetype for them yet
 *
 * Nothing is written to the workspace from here — the app cannot write a
 * tenant's repo; the person commits the two files, through a PR.
 */

import type { ArtifactRow } from '@/services/ArtifactService';
import { stringify } from 'yaml';
import { PageManifestSchema } from '@/libs/workspace/pages';

export type ArtifactPageExport = {
  slug: string;
  files: Array<{ path: string; content: string }>;
  /** Set when this artifact kind has no page archetype — `files` is then empty. */
  unsupported: { kind: string; reason: string } | null;
};

export function slugifyArtifact(name: string): string {
  const s = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return s || 'artifact';
}

function mdEscape(v: unknown): string {
  return String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function tableToMarkdown(spec: Record<string, unknown>): string {
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

const NO_ARCHETYPE: Record<string, string> = {
  chart: 'no chart archetype yet — author a custom widget in pages/components/registry.tsx',
  record: 'records are live data — use archetype: list with source: {kind: objects}',
  link: 'a link is not page content',
  file: 'a file is not page content — link to it from a page instead',
};

/**
 * Turn one artifact into the two files a person commits.
 * @param artifact - The artifact row, at its head version.
 */
export function exportArtifactAsPage(artifact: ArtifactRow): ArtifactPageExport {
  const slug = slugifyArtifact(artifact.title);
  let body: string | null = null;

  if (artifact.kind === 'markdown') {
    body = String(artifact.spec.md ?? '');
  } else if (artifact.kind === 'table') {
    const md = tableToMarkdown(artifact.spec);
    body = md ? `${md}${artifact.spec.caption ? `\n\n_${String(artifact.spec.caption)}_` : ''}` : null;
    if (!body) {
      return { slug, files: [], unsupported: { kind: artifact.kind, reason: 'the table has no columns' } };
    }
  } else {
    return { slug, files: [], unsupported: { kind: artifact.kind, reason: NO_ARCHETYPE[artifact.kind] ?? 'no page archetype for this kind' } };
  }

  const manifest = PageManifestSchema.parse({
    slug,
    title: artifact.title,
    description: `Exported from a Vocion artifact on ${new Date().toISOString().slice(0, 10)}.`,
    nav: { section: 'Artifacts', order: 0, hidden: false },
    archetype: 'markdown',
    contentFile: `${slug}.md`,
  });

  const yaml = `# Exported from artifact #${artifact.id} "${artifact.title}" at v${artifact.currentVersion} — edit freely; the artifact is not linked.\n${stringify(manifest)}`;
  const md = `# ${artifact.title}\n\n${body}\n`;

  return {
    slug,
    files: [
      { path: `pages/${slug}.yaml`, content: yaml },
      { path: `pages/${slug}.md`, content: md },
    ],
    unsupported: null,
  };
}
