/**
 * A GitHub target's frontmatter template, LEARNED from the site's own posts:
 * two or three existing files in the target's folder are read, and their
 * frontmatter becomes the template, key for key. A value every post shares
 * (a layout, a draft flag, a default image) stays a literal; a value that
 * varies per post becomes the placeholder that fills it ({title}, {date:…},
 * {author}, {tags} …), read from the key's name and the shape of its values.
 * Pure: the reading is `services/publish/learnTemplate.ts`, and what comes out
 * is a suggestion a person applies on the project (Publishing), never a
 * target written on their behalf.
 */

import type { StoredPublishTarget } from './targets';
import { parse } from 'yaml';

/** A post read from the repository: its path and its whole text. */
export type SampleFile = { path: string; text: string };

/** What the posts taught: the template, the path pattern, and anything a person should check. */
export type LearnedTemplate = {
  frontmatter: Record<string, unknown>;
  /** The path a new page takes, `{slug}` in place of the post's name; null when the files disagree. */
  path: string | null;
  /** The files it was read from. */
  read: string[];
  /** One line each: a key left out, or a value kept from the first post that a person should check. */
  notes: string[];
};

/**
 * A learned target waiting on a person, as the project keeps it
 * (`publishTargetSuggestion`): the whole target to apply, the target it
 * replaces (null for a new one), and what it was read from: a GitHub
 * target's repository and ref, or a Webflow target's site and collection
 * (`from`, in words; `services/publish/learnWebflow.ts`).
 */
export type PublishTargetSuggestion = {
  target: StoredPublishTarget;
  replaces: string | null;
  /** The repository the posts were read in (GitHub); the site's name (Webflow). */
  repo: string;
  /** The ref the posts were read at (GitHub); the collection's name (Webflow). */
  ref: string;
  /** What it was learned from, in a line for the project page ("Blog Posts on Northwind Outfitters"). */
  from?: string;
  read: string[];
  notes: string[];
  at: string;
  /** Who or what asked for it: a person's id, or `agent:<slug>`. */
  by: string | null;
};

/**
 * A file's frontmatter and body, or null when it has none.
 * @param text - The file.
 */
export function frontmatterOf(text: string): { data: Record<string, unknown>; body: string } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    return null;
  }
  try {
    // The core schema: a bare 2026-07-08 is read as the string it is written as.
    const data = parse(m[1]!, { schema: 'core' }) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? { data: data as Record<string, unknown>, body: m[2] ?? '' } : null;
  } catch {
    return null;
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * The placeholder a date value is written as, or null when it is not a date
 * this can write: `2026-07-08`, an ISO timestamp, `July 8, 2026`, `Jul 8, 2026`.
 * @param value - One post's value.
 */
export function dateFormatOfValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return '{date:YYYY-MM-DD}';
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return '{datetime}';
  }
  const named = /^([a-z]+)\.? (\d{1,2}), \d{4}$/i.exec(v);
  if (named) {
    const month = named[1]!.toLowerCase();
    const day = named[2]!.length === 2 && named[2]!.startsWith('0') ? 'DD' : 'D';
    if (MONTH_NAMES.includes(month)) {
      return `{date:MMMM ${day}, YYYY}`;
    }
    if (MONTH_NAMES.some(n => n.slice(0, 3) === month)) {
      return `{date:MMM ${day}, YYYY}`;
    }
  }
  return null;
}

/**
 * A key as compared: lower case, no separators.
 * @param k
 */
const keyOf = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The placeholder for one key whose values vary between posts, or undefined
 * when neither its name nor its values say what it is.
 * @param key - The key, as the posts write it.
 * @param values - Its value in each post.
 * @param authorSlugs - The project's authors' slugs, when it names them.
 */
function placeholderFor(key: string, values: unknown[], authorSlugs: ReadonlySet<string>): unknown {
  const k = keyOf(key);
  const strings = values.every(v => typeof v === 'string');
  const lists = values.every(v => Array.isArray(v) && v.every(x => typeof x === 'string'));
  const dates = values.map(dateFormatOfValue);
  if (strings && dates.every(d => d !== null && d === dates[0])) {
    return dates[0]!;
  }
  if (k === 'title' || k === 'name' || k === 'headline') {
    return '{title}';
  }
  if (k === 'metatitle' || k === 'seotitle') {
    return '{metaTitle}';
  }
  if (['description', 'summary', 'metadescription', 'seodescription'].includes(k)) {
    return '{description}';
  }
  if (['excerpt', 'subtitle', 'teaser', 'blurb', 'lede'].includes(k)) {
    return '{excerpt}';
  }
  if (k === 'slug') {
    return '{slug}';
  }
  if (['tags', 'keywords', 'topics'].includes(k)) {
    return lists ? '{tags}' : strings ? '{tags}' : undefined;
  }
  if (['category', 'categories', 'section'].includes(k)) {
    return lists ? ['{category}'] : strings ? '{category}' : undefined;
  }
  if (['author', 'authors', 'by', 'writer', 'byline'].includes(k)) {
    const flat = values.flatMap(v => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === 'string');
    const slugLike = flat.length > 0 && flat.every(v => authorSlugs.has(v) || KEBAB.test(v));
    const one = slugLike ? '{authorSlug}' : '{author}';
    return lists ? [one] : strings ? one : undefined;
  }
  if (['readtime', 'readingtime', 'minutesread', 'timetoread'].includes(k) && strings) {
    return '{readTime}';
  }
  if (k === 'alt' || k === 'imagealt') {
    return '{title}';
  }
  return undefined;
}

/**
 * The template for one level of frontmatter (nested maps recurse): keys in
 * every post, in the first post's order.
 * @param samples - Each post's map at this level.
 * @param prefix - Where this level sits, for the notes.
 * @param authorSlugs - The project's authors' slugs.
 * @param notes - Where the notes go.
 */
function templateLevel(samples: Array<Record<string, unknown>>, prefix: string, authorSlugs: ReadonlySet<string>, notes: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(samples[0] ?? {})) {
    const at = `${prefix}${key}`;
    const present = samples.filter(s => key in s);
    if (present.length < samples.length) {
      notes.push(`${at} is in ${present.length} of ${samples.length} posts, so it is left out; add it if new pages need it.`);
      continue;
    }
    const values = samples.map(s => s[key]);
    // A date is the page's date, never a literal copied from a post, even when the posts read agree.
    const dateStyle = values.every(v => typeof v === 'string') ? values.map(dateFormatOfValue) : [];
    if (dateStyle.length > 0 && dateStyle.every(d => d !== null && d === dateStyle[0])) {
      out[key] = dateStyle[0];
      continue;
    }
    if (values.every(v => same(v, values[0]))) {
      // Constant across the posts: a literal (a layout, a draft flag, a default image).
      out[key] = values[0];
      continue;
    }
    if (values.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
      out[key] = templateLevel(values as Array<Record<string, unknown>>, `${at}.`, authorSlugs, notes);
      continue;
    }
    const placeholder = placeholderFor(key, values, authorSlugs);
    if (placeholder !== undefined) {
      out[key] = placeholder;
      continue;
    }
    out[key] = values[0];
    notes.push(`${at} differs from post to post and no page field fills it, so it keeps the first post's value (${JSON.stringify(values[0])}); change it if every new page needs its own.`);
  }
  return out;
}

/**
 * The path a new page takes, from the posts' own paths: their folder, their
 * extension, and their name pattern (`2026-07-08-a-post.mdx` →
 * `{date:YYYY-MM-DD}-{slug}.mdx`; `a-post/index.mdx` → `{slug}/index.mdx`).
 * Null when the posts sit in different folders or name themselves differently.
 * @param paths - The posts' paths.
 */
export function pathPatternOf(paths: readonly string[]): string | null {
  const shapes = paths.map((p) => {
    const parts = p.split('/');
    const file = parts.pop()!;
    const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1] ?? '';
    const name = file.slice(0, ext ? -(ext.length + 1) : undefined);
    if (name === 'index' && parts.length > 0) {
      parts.pop();
      return `${parts.join('/')}/{slug}/index.${ext}`;
    }
    const dated = /^\d{4}-\d{2}-\d{2}-/.test(name);
    return `${parts.join('/')}/${dated ? '{date:YYYY-MM-DD}-' : ''}{slug}.${ext}`;
  }).map(s => s.replace(/^\//, ''));
  return shapes.every(s => s === shapes[0]) && shapes[0] ? shapes[0] : null;
}

/**
 * The template two or three posts teach.
 * @param files - The posts, as read.
 * @param opts - What the project knows.
 * @param opts.authorSlugs - Its authors' slugs, so a post naming one reads as {authorSlug}.
 */
export function templateFrom(files: readonly SampleFile[], opts: { authorSlugs?: readonly string[] } = {}): LearnedTemplate | null {
  const parsed = files.map(f => ({ path: f.path, fm: frontmatterOf(f.text) })).filter((f): f is { path: string; fm: NonNullable<ReturnType<typeof frontmatterOf>> } => f.fm !== null);
  if (parsed.length === 0) {
    return null;
  }
  const notes: string[] = [];
  if (parsed.length < files.length) {
    notes.push(`${files.length - parsed.length} of the files read had no frontmatter and were left out.`);
  }
  if (parsed.length === 1) {
    notes.push('Only one post was read, so every value looks constant: check which ones change per post.');
  }
  const frontmatter = templateLevel(parsed.map(p => p.fm.data), '', new Set(opts.authorSlugs ?? []), notes);
  return { frontmatter, path: pathPatternOf(parsed.map(p => p.path)), read: parsed.map(p => p.path), notes };
}

/**
 * The folder a target's path writes into: the part before its first placeholder, up to its last `/`.
 * @param path - The target's path (`src/content/blog/{slug}.mdx`).
 */
export function folderOf(path: string): string {
  const fixed = path.split('{')[0] ?? '';
  return fixed.includes('/') ? fixed.slice(0, fixed.lastIndexOf('/')) : '';
}

/**
 * The posts to learn from in a repository listing: markdown files in the
 * folder (directly, or as `<post>/index.md(x)`), the last few by path — dated
 * names sort newest last.
 * @param paths - Every file path in the repository.
 * @param folder - The folder.
 * @param n - How many.
 */
export function samplePaths(paths: readonly string[], folder: string, n = 3): string[] {
  const base = folder ? `${folder.replace(/\/+$/, '')}/` : '';
  return paths
    .filter(p => p.startsWith(base) && /\.(?:mdx?|markdown)$/i.test(p))
    .filter((p) => {
      const rest = p.slice(base.length).split('/');
      return rest.length === 1 ? !/^(?:readme|_index|index)\./i.test(rest[0]!) : rest.length === 2 && /^index\.(?:mdx?|markdown)$/i.test(rest[1]!);
    })
    .sort()
    .slice(-n);
}

/**
 * The folder a site keeps its posts in, when nobody named it: the folder with
 * the most markdown posts directly in it (two at least), a `blog`, `posts` or
 * `articles` folder first on a tie. Null when there is none. Pure.
 * @param paths - Every file path in the repository.
 */
export function postsFolderOf(paths: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (!/\.(?:mdx?|markdown)$/i.test(p) || /(?:^|\/)(?:readme|changelog|license|contributing)\.[^/]+$/i.test(p) || /(?:^|\/)(?:node_modules|\.github|docs?)\//i.test(p)) {
      continue;
    }
    const at = p.lastIndexOf('/');
    if (at <= 0) {
      continue;
    }
    const folder = p.slice(0, at);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const named = (f: string) => (/(?:^|\/)(?:blog|posts|articles)$/i.test(f) ? 1 : 0);
  const best = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || named(b[0]) - named(a[0]) || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : null;
}
