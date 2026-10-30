/**
 * LEARN A GITHUB TARGET FROM THE SITE'S OWN POSTS, and put it in front of a
 * person. Two or three existing files in the target's folder are read through
 * the workspace's GitHub connection (`repoProviderFor`, the token
 * `tokenForRepo` resolves), and their frontmatter becomes the template
 * (`libs/publish/learnTemplate.ts`). What comes out is written on the project
 * as `publishTargetSuggestion`, which the project page's Publishing section
 * shows with Apply and Dismiss: the target itself is a person's to set, so
 * nothing here writes `publishTargets`.
 *
 * Runs when a person saves a GitHub target with no frontmatter (the project
 * PATCH), and when an agent asks (`seo_learn_frontmatter`, onboarding with
 * GitHub connected), naming a target or a repository and folder.
 */

import type { PublishTargetSuggestion, SampleFile } from '@/libs/publish/learnTemplate';
import type { StoredPublishTarget } from '@/libs/publish/targets';
import type { RepoFile, RepoTree } from '@/services/repo/provider';

/** How the repository is read; tests pass their own. */
export type RepoReader = {
  readTree: (repo: string, ref?: string | null) => Promise<RepoTree>;
  readFile: (repo: string, path: string, ref?: string | null) => Promise<RepoFile>;
};

/** What to learn from: a target the project has, or a repository and the folder its posts are in. */
export type LearnRequest = {
  targetId?: string;
  repo?: string;
  /** The folder the posts are in (`src/content/blog`). */
  folder?: string;
  baseBranch?: string;
  /** Who asked: a person's id, or `agent:<slug>`. */
  by: string | null;
};

export type LearnOutcome = { ok: true; suggestion: PublishTargetSuggestion; line: string } | { ok: false; why: string };

/**
 * The reader for a repository the workspace connected.
 * @param orgId - The workspace.
 * @param repo - `owner/name`.
 */
async function connectedReader(orgId: string, repo: string): Promise<RepoReader> {
  const { repoProviderFor } = await import('@/services/repo/provider');
  const provider = await repoProviderFor(orgId, repo);
  return {
    readTree: (r, ref) => provider.readTree(orgId, r, ref),
    readFile: (r, path, ref) => provider.readFile(orgId, r, path, ref),
  };
}

/**
 * Learn the target from the site's posts and keep it on the project as a
 * suggestion. Never writes the project's targets.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param req - What to learn from.
 * @param reader - How the repository is read (the workspace's connection by default).
 */
export async function suggestPublishTarget(orgId: string, projectId: number, req: LearnRequest, reader?: RepoReader): Promise<LearnOutcome> {
  const { getDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
  const { folderOf, postsFolderOf, samplePaths, templateFrom } = await import('@/libs/publish/learnTemplate');
  const { publishTargetSchema } = await import('@/libs/publish/targets');
  const project = await getDataRoom(orgId, projectId);
  if (!project) {
    return { ok: false, why: `#${projectId} is not a project in this workspace.` };
  }
  const targets = (project.meta.publishTargets ?? []) as StoredPublishTarget[];
  const github = targets.filter(t => t.kind === 'github');
  const existing = req.targetId ? targets.find(t => t.id === req.targetId) : !req.repo && github.length === 1 ? github[0] : undefined;
  if (req.targetId && !existing) {
    return { ok: false, why: `The project has no publish target "${req.targetId}".` };
  }
  if (existing && existing.kind !== 'github') {
    return { ok: false, why: `"${existing.id}" publishes to ${existing.kind}; only a GitHub target has a frontmatter template to learn.` };
  }
  const config = (existing?.config ?? {}) as { repo?: string; path?: string; baseBranch?: string; format?: string };
  const repo = req.repo?.trim() || config.repo;
  if (!repo) {
    return { ok: false, why: 'Name the repository (owner/name) the site is built from, or a GitHub target of the project.' };
  }
  let folder = (req.folder?.trim() ?? (config.path ? folderOf(config.path) : '')).replace(/^\/+|\/+$/g, '');
  const read = reader ?? await connectedReader(orgId, repo).catch((error: Error) => error);
  if (read instanceof Error) {
    return { ok: false, why: read.message };
  }
  let tree: RepoTree;
  try {
    tree = await read.readTree(repo, req.baseBranch ?? config.baseBranch ?? null);
  } catch (error) {
    return { ok: false, why: `${repo} could not be listed: ${(error as Error).message}` };
  }
  const blobs = tree.entries.filter(e => e.type === 'blob').map(e => e.path);
  // No folder named (a repo just picked): the folder holding the site's posts.
  if (!folder && samplePaths(blobs, '').length === 0) {
    folder = postsFolderOf(blobs) ?? '';
  }
  const paths = samplePaths(blobs, folder);
  if (paths.length === 0) {
    return { ok: false, why: `No markdown posts in ${repo}/${folder || '(the root)'} at ${tree.ref} to learn the frontmatter from. Name the folder the site's posts are in.` };
  }
  const files: SampleFile[] = [];
  for (const path of paths) {
    const file = await read.readFile(repo, path, tree.ref).catch(() => null);
    if (file && !file.truncated) {
      files.push({ path, text: file.text });
    }
  }
  const authorSlugs = (project.meta.authors ?? []).map(a => a.slug).filter((s): s is string => Boolean(s));
  const learned = templateFrom(files, { authorSlugs });
  if (!learned) {
    return { ok: false, why: `None of ${paths.join(', ')} has frontmatter to learn from.` };
  }
  const path = learned.path ?? config.path ?? `${folder ? `${folder}/` : ''}{slug}.mdx`;
  const id = existing?.id ?? (targets.some(t => t.id === 'site') ? `site-${targets.length + 1}` : 'site');
  const target: StoredPublishTarget = {
    id,
    kind: 'github',
    ...(existing?.label ? { label: existing.label } : {}),
    config: {
      ...config,
      repo,
      baseBranch: req.baseBranch ?? config.baseBranch ?? tree.ref,
      path,
      frontmatter: learned.frontmatter,
    },
  };
  const checked = publishTargetSchema.safeParse(target);
  if (!checked.success) {
    return { ok: false, why: `The learned target does not hold: ${checked.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}.` };
  }
  const suggestion: PublishTargetSuggestion = { target, replaces: existing?.id ?? null, repo, ref: tree.ref, read: learned.read, notes: learned.notes, at: new Date().toISOString(), by: req.by };
  await updateDataRoom(orgId, projectId, { publishTargetSuggestion: suggestion });
  const keys = Object.keys(learned.frontmatter);
  return {
    ok: true,
    suggestion,
    line: `Read ${learned.read.length} ${learned.read.length === 1 ? 'post' : 'posts'} in ${repo} (${learned.read.join(', ')}): ${keys.length} frontmatter ${keys.length === 1 ? 'key' : 'keys'}, path ${path}. It waits on the project's Publishing for a person to apply.${learned.notes.length > 0 ? ` To check: ${learned.notes.join(' ')}` : ''}`,
  };
}
