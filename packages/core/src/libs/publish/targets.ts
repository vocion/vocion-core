/**
 * WHERE A PROJECT'S PAGES GO: its publish targets (`publishTargets` on a
 * Project, the `data_room` record's metadata), what each kind needs, and the
 * page file a target turns a draft into. Pure and client-safe. The Project page
 * shows them as stored (`DataRoomService.publishTargetLine`); the
 * `site.publish_page` action (`libs/actions/site-publish-page.ts`) reads them
 * to publish.
 *
 * One target per destination a client has, each with an id the pages name:
 *
 * - `github`: a pull request with the page file. `path` places the file and
 *   names the slug (`src/content/blog/{slug}.mdx`); `format` is how the body is
 *   written; `frontmatter` is the template the site's own files use, mirrored
 *   key for key from two or three existing files when the client is onboarded.
 *   Its values are literals, or placeholders a page fills in: {title},
 *   {metaTitle}, {description}, {slug}, {date}, {datetime}, {keyword}.
 * - `squarespace`: a draft post on the site's blog, written in the editor by a
 *   browser run, since Squarespace has no API for posts.
 * - `wordpress`: declared so a project can say so; nothing publishes there yet.
 */

import { stringify } from 'yaml';
import { z } from 'zod';

export const PUBLISH_TARGET_KINDS = ['github', 'squarespace', 'wordpress'] as const;
export type PublishTargetKind = (typeof PUBLISH_TARGET_KINDS)[number];

export const PAGE_FORMATS = ['mdx', 'md', 'html'] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

/** The values a page fills a template with. */
export const PAGE_PLACEHOLDERS = ['title', 'metaTitle', 'description', 'slug', 'date', 'datetime', 'keyword'] as const;
type Placeholder = (typeof PAGE_PLACEHOLDERS)[number];

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** A target's id: what a page or a batch names it by. */
const targetIdSchema = z.string().regex(/^[a-z0-9][\w-]{0,62}$/i, 'a short id: letters, digits, - and _');

/**
 * The placeholders a template uses that a page cannot fill.
 * @param text - A template string.
 */
function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map(m => m[1]!).filter(name => !(PAGE_PLACEHOLDERS as readonly string[]).includes(name));
}

/**
 * Every string inside a template value, however deep.
 * @param value - A frontmatter value.
 */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

/**
 * A path written relative to the repository's root: no leading slash, no
 * `..`, nothing under `.git/`. The same rule the change itself applies
 * (`services/factory/githubChange.ts` `cleanPath`).
 * @param path - The path.
 */
function insideRepo(path: string): boolean {
  const p = path.trim();
  return Boolean(p) && !p.startsWith('/') && !p.split('/').some(part => part === '..' || part === '') && p !== '.git' && !p.startsWith('.git/');
}

const githubConfigSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'the repository as owner/name'),
  baseBranch: z.string().min(1).max(200).optional(),
  path: z.string().min(3).max(400).refine(p => p.includes('{slug}'), 'the path names the page with {slug}, e.g. src/content/blog/{slug}.mdx').refine(insideRepo, 'a path inside the repository, from its root').superRefine((p, ctx) => {
    const unknown = unknownPlaceholders(p);
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'custom', message: `the path uses ${unknown.map(n => `{${n}}`).join(', ')}, which a page cannot fill (it can fill ${PAGE_PLACEHOLDERS.map(n => `{${n}}`).join(', ')})` });
    }
  }),
  format: z.enum(PAGE_FORMATS).optional(),
  frontmatter: z.record(z.string(), z.unknown()).default({}).superRefine((fm, ctx) => {
    const unknown = [...new Set(stringsIn(fm).flatMap(unknownPlaceholders))];
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'custom', message: `the frontmatter uses ${unknown.map(n => `{${n}}`).join(', ')}, which a page cannot fill` });
    }
  }),
});

const squarespaceConfigSchema = z.object({
  siteUrl: z.string().url().refine(u => /^https:\/\//i.test(u), 'the site\'s https:// address'),
  /** The blog's path on the site, e.g. /blog or /journal. */
  blogPath: z.string().regex(/^\/[\w\-/]*$/, 'the blog\'s path, starting with /').optional(),
});

/** Declared so a project can name it; nothing publishes there yet. */
const wordpressConfigSchema = z.object({ siteUrl: z.string().url() }).passthrough();

const base = { id: targetIdSchema, label: z.string().max(120).optional() };

export const publishTargetSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('github'), config: githubConfigSchema }),
  z.object({ ...base, kind: z.literal('squarespace'), config: squarespaceConfigSchema }),
  z.object({ ...base, kind: z.literal('wordpress'), config: wordpressConfigSchema }),
]);

export type PublishTarget = z.infer<typeof publishTargetSchema>;
export type GithubTarget = Extract<PublishTarget, { kind: 'github' }>;
export type SquarespaceTarget = Extract<PublishTarget, { kind: 'squarespace' }>;

/**
 * A project's targets as written, each checked: the ones that hold, and why
 * each one that does not. A target that fails is left out of `targets` but
 * never silently: its problem names it.
 * @param raw - `metadata.publishTargets` of a Project, whatever it holds.
 */
export function publishTargetsOf(raw: unknown): { targets: PublishTarget[]; problems: string[] } {
  if (raw === undefined || raw === null) {
    return { targets: [], problems: [] };
  }
  if (!Array.isArray(raw)) {
    return { targets: [], problems: ['publishTargets is not a list'] };
  }
  const targets: PublishTarget[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const parsed = publishTargetSchema.safeParse(entry);
    const name = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : `#${i + 1}`;
    if (!parsed.success) {
      problems.push(`${name}: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'target'} ${issue.message}`).join('; ')}`);
      return;
    }
    if (seen.has(parsed.data.id)) {
      problems.push(`${name}: a second target with this id; ids must be unique in a project`);
      return;
    }
    seen.add(parsed.data.id);
    targets.push(parsed.data);
  });
  return { targets, problems };
}

/**
 * The target a page publishes to: the one it names, or the project's only
 * one. Anything else is a reason, written for the person fixing it.
 * @param raw - The project's `publishTargets`.
 * @param id - The target the page or batch names, when it names one.
 */
export function resolvePublishTarget(raw: unknown, id?: string | null): { ok: true; target: PublishTarget } | { ok: false; why: string } {
  const { targets, problems } = publishTargetsOf(raw);
  const broken = problems.length > 0 ? ` (${problems.length} target${problems.length === 1 ? '' : 's'} could not be read: ${problems.join(' | ')})` : '';
  if (id) {
    const found = targets.find(t => t.id === id);
    if (found) {
      return { ok: true, target: found };
    }
    return { ok: false, why: `The project has no publish target "${id}"${targets.length > 0 ? `; it has ${targets.map(t => t.id).join(', ')}` : ''}${broken}.` };
  }
  if (targets.length === 1) {
    return { ok: true, target: targets[0]! };
  }
  if (targets.length === 0) {
    return { ok: false, why: `The project says nowhere to publish: add a publish target to it (a GitHub repo or a Squarespace site)${broken}.` };
  }
  return { ok: false, why: `The project publishes to ${targets.map(t => t.id).join(', ')}: name the target this page goes to.` };
}

/**
 * The format a GitHub target writes: its own, else what its path's extension says.
 * @param target - The target.
 */
export function formatOf(target: GithubTarget): PageFormat {
  if (target.config.format) {
    return target.config.format;
  }
  const ext = target.config.path.split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown' ? 'md' : ext === 'html' || ext === 'htm' ? 'html' : 'mdx';
}

/**
 * A URL slug from a title or a keyword: lower case, ASCII, words joined by -.
 * @param text - The title or keyword.
 */
export function slugify(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

/** A slug a page may carry: what `slugify` writes. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The page being published, as templates read it. */
export type PageFields = {
  title: string;
  /** The title search engines show (`<title>`, the SEO title); the page's title when none was written. */
  metaTitle?: string | null;
  description: string;
  slug: string;
  keyword?: string | null;
  /** When it is published; `date` and `datetime` are read from it. */
  at: Date;
};

function valuesOf(page: PageFields): Record<Placeholder, string> {
  return {
    title: page.title,
    metaTitle: page.metaTitle || page.title,
    description: page.description,
    slug: page.slug,
    date: page.at.toISOString().slice(0, 10),
    datetime: page.at.toISOString(),
    keyword: page.keyword ?? '',
  };
}

/**
 * A template string with the page's values in place of its placeholders.
 * @param text - The template.
 * @param page - The page.
 */
export function fillTemplate(text: string, page: PageFields): string {
  const values = valuesOf(page);
  return text.replace(PLACEHOLDER_RE, (m, name: string) => (name in values ? values[name as Placeholder] : m));
}

/**
 * A frontmatter template filled in: strings filled, lists and maps filled
 * through, everything else (a number, a boolean, a date) kept as written.
 * @param value - A template value.
 * @param page - The page.
 */
function fillValue(value: unknown, page: PageFields): unknown {
  if (typeof value === 'string') {
    return fillTemplate(value, page);
  }
  if (Array.isArray(value)) {
    return value.map(v => fillValue(v, page));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillValue(v, page)]));
  }
  return value;
}

/**
 * The frontmatter a page gets: the target's template, key for key, filled in.
 * @param template - The target's `frontmatter`.
 * @param page - The page.
 */
export function renderFrontmatter(template: Record<string, unknown>, page: PageFields): Record<string, unknown> {
  return fillValue(template, page) as Record<string, unknown>;
}

/**
 * The body without its leading `# Title`, when the frontmatter already
 * carries the title: a site that renders its title from frontmatter would
 * otherwise show it twice, and a page with two H1s reads worse to a search
 * engine too.
 * @param markdown - The draft.
 * @param template - The target's frontmatter template.
 */
export function bodyWithoutTitle(markdown: string, template: Record<string, unknown>): string {
  const titled = stringsIn(template).some(s => s.includes('{title}'));
  if (!titled) {
    return markdown.trim();
  }
  return markdown.replace(/^\s*#\s+(?:\S[^\n]*)?\n+/, '').trim();
}

const META_LINE_RE = /^\s*(?:[-*]\s*)?(?:\*\*|__)?(?:meta\s*title|meta\s*description|seo\s*title|seo\s*description|url\s*slug|slug)(?:\*\*|__)?\s*:/i;
const META_HEADING_RE = /^\s*(?:#{1,6}\s*(?:meta|seo)\b[^\n]*|-{3,}|\*{3,})$/i;

/**
 * The body without a trailing block of page metadata a writer left in it
 * ("Meta title: …", "Meta description: …", "Slug: …", under a "## Meta"
 * heading or a rule): those go in the page's fields, never on the page.
 * @param markdown - The draft.
 */
export function stripMetaBlock(markdown: string): string {
  const lines = markdown.replace(/\s+$/, '').split('\n');
  let end = lines.length;
  let stripped = false;
  while (end > 0 && (lines[end - 1]!.trim() === '' || META_LINE_RE.test(lines[end - 1]!))) {
    stripped ||= META_LINE_RE.test(lines[end - 1]!);
    end -= 1;
  }
  if (!stripped) {
    return markdown.trim();
  }
  while (end > 0 && (lines[end - 1]!.trim() === '' || META_HEADING_RE.test(lines[end - 1]!))) {
    end -= 1;
  }
  return lines.slice(0, end).join('\n').trim();
}

/**
 * Markdown made safe to read as MDX: outside code, a brace would open an
 * expression and a bare `<` a component, so both are escaped; tags and
 * autolinks are left as they are.
 * @param markdown - The body.
 */
export function escapeForMdx(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    // Inline code spans keep their text; everything between them is escaped.
    out.push(line.split(/(`[^`]*`)/).map((part, i) => (i % 2 === 1
      ? part
      : part.replace(/[{}]/g, c => `\\${c}`).replace(/<(?![a-z/!])/gi, '&lt;'))).join(''));
  }
  return out.join('\n');
}

/**
 * The file a page becomes on a GitHub target: where it goes, and its whole
 * text — the target's frontmatter template filled in, then the body in the
 * target's format. An `html` target is handed the body already rendered
 * (`html`), since rendering markdown is the server's job.
 * @param target - The GitHub target.
 * @param page - The page.
 * @param body - The draft.
 * @param body.markdown - The draft's markdown.
 * @param body.html - The draft rendered as HTML, for an html target.
 */
export function renderPageFile(target: GithubTarget, page: PageFields, body: { markdown: string; html?: string }): { path: string; format: PageFormat; content: string } {
  const format = formatOf(target);
  const path = fillTemplate(target.config.path, page);
  const template = target.config.frontmatter ?? {};
  const frontmatter = renderFrontmatter(template, page);
  const head = Object.keys(frontmatter).length > 0 ? `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n` : '';
  const markdown = bodyWithoutTitle(body.markdown, template);
  if (format === 'html') {
    if (body.html === undefined) {
      throw new Error('an html target needs the body rendered as HTML');
    }
    return { path, format, content: `${head}${body.html.trim()}\n` };
  }
  return { path, format, content: `${head}${format === 'mdx' ? escapeForMdx(markdown) : markdown}\n` };
}

/**
 * A target as a project stores it, before it is checked: what the Project page
 * lists under "Publishes to". `config` is the kind's own.
 */
export type StoredPublishTarget = {
  id: string;
  kind: PublishTargetKind;
  label?: string;
  config?: Record<string, unknown>;
};

const PUBLISH_KIND_LABEL: Record<PublishTargetKind, string> = { github: 'GitHub', squarespace: 'Squarespace', wordpress: 'WordPress' };

/**
 * One publish target in a line: its label, its kind, and where it points
 * when the config names it (a repo, a site). The project page, the project's
 * bundle and the publish card all say it this way.
 * @param t - The target, as stored or as checked.
 */
export function publishTargetLine(t: StoredPublishTarget | PublishTarget): string {
  const c = (t.config ?? {}) as Record<string, unknown>;
  const where = [c.repo, c.siteUrl, c.url].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  const kind = PUBLISH_KIND_LABEL[t.kind] ?? t.kind;
  return [t.label && t.label !== where ? t.label : null, where ? `${kind} ${where}` : kind].filter(Boolean).join(' — ');
}

/**
 * A Squarespace blog's address: the site with its blog path.
 * @param target - The Squarespace target.
 */
export function squarespaceBlogUrl(target: SquarespaceTarget): string {
  return `${target.config.siteUrl.replace(/\/+$/, '')}${target.config.blogPath ?? '/blog'}`;
}
