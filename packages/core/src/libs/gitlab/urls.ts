/**
 * GitLab's web URLs, read and written — pure, so the provider, the factory's
 * read-backs and the runner contract all agree on one spelling.
 *
 * A merge request lives at `<instance>/<project path>/-/merge_requests/<iid>`
 * and a pipeline at `<instance>/<project path>/-/pipelines/<id>`, where the
 * project path may be nested (`group/subgroup/project`). The `/-/` separator
 * is what makes a nested path unambiguous, so the path is everything between
 * the instance and it. An instance served under a path prefix
 * (`https://code.northwind.example/gitlab`) names that prefix as its base URL,
 * and the prefix is not part of the project path.
 */

import { normalizeBaseUrl } from './client';

/** A merge request named by its URL. */
export type MergeRequestUrl = { baseUrl: string; host: string; project: string; iid: number; url: string };

/** A pipeline named by its URL. */
export type PipelineUrl = { baseUrl: string; host: string; project: string; pipelineId: number; url: string };

const SEGMENT = /^[\w.-]+$/;

/**
 * The instance and project path in front of a `/-/<kind>/<n>` URL, or null.
 * @param url - A web URL.
 * @param kind - `merge_requests` or `pipelines`.
 * @param baseUrls - Instances whose path prefix should be stripped; gitlab.com needs none.
 */
function split(url: string, kind: 'merge_requests' | 'pipelines', baseUrls: readonly string[]): { baseUrl: string; host: string; project: string; n: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  const m = new RegExp(`^(.*?)/-/${kind}/(\\d+)(?:/[\\w-]*)?/?$`).exec(parsed.pathname);
  if (!m) {
    return null;
  }
  let path = m[1]!.replace(/^\/+/, '');
  const origin = parsed.origin.toLowerCase();
  let baseUrl = origin;
  for (const base of baseUrls) {
    const b = normalizeBaseUrl(base);
    let bu: URL;
    try {
      bu = new URL(b);
    } catch {
      continue;
    }
    const prefix = bu.pathname.replace(/^\/+|\/+$/g, '');
    if (bu.origin.toLowerCase() === origin && prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
      path = path.slice(prefix.length).replace(/^\/+/, '');
      baseUrl = `${origin}/${prefix}`;
      break;
    }
  }
  const segments = path.split('/');
  if (segments.length < 2 || !segments.every(s => SEGMENT.test(s))) {
    return null;
  }
  return { baseUrl, host: parsed.hostname.toLowerCase(), project: path, n: Number(m[2]) };
}

/**
 * A merge request URL's parts, or null when the URL is not one. Trailing tabs
 * (`/diffs`, `/commits`, `/pipelines`), a query and a fragment are dropped.
 * @param url - A web URL.
 * @param baseUrls - Self-managed instances served under a path prefix.
 */
export function parseMergeRequestUrl(url: string, baseUrls: readonly string[] = []): MergeRequestUrl | null {
  const s = split(url, 'merge_requests', baseUrls);
  return s ? { baseUrl: s.baseUrl, host: s.host, project: s.project, iid: s.n, url: mergeRequestUrl(s.baseUrl, s.project, s.n) } : null;
}

/**
 * A pipeline URL's parts, or null when the URL is not one.
 * @param url - A web URL.
 * @param baseUrls - Self-managed instances served under a path prefix.
 */
export function parsePipelineUrl(url: string, baseUrls: readonly string[] = []): PipelineUrl | null {
  const s = split(url, 'pipelines', baseUrls);
  return s ? { baseUrl: s.baseUrl, host: s.host, project: s.project, pipelineId: s.n, url: pipelineUrl(s.baseUrl, s.project, s.n) } : null;
}

/**
 * The web URL of a merge request.
 * @param baseUrl - The instance.
 * @param project - The project path.
 * @param iid - The merge request's number in its project.
 */
export function mergeRequestUrl(baseUrl: string, project: string, iid: number): string {
  return `${normalizeBaseUrl(baseUrl)}/${project}/-/merge_requests/${iid}`;
}

/**
 * The web URL of a pipeline.
 * @param baseUrl - The instance.
 * @param project - The project path.
 * @param id - The pipeline id.
 */
export function pipelineUrl(baseUrl: string, project: string, id: number): string {
  return `${normalizeBaseUrl(baseUrl)}/${project}/-/pipelines/${id}`;
}

/**
 * The project a clone or web URL names on an instance, as its path: the
 * part after the instance, without `.git` and without any `/-/…` tail.
 * Null when the URL is not on that instance or names no project.
 * @param url - `https://gitlab.com/northwind/platform/api.git`, or its web URL.
 * @param baseUrl - The instance.
 */
export function projectOfUrl(url: string, baseUrl: string): string | null {
  const base = normalizeBaseUrl(baseUrl);
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return null;
  }
  const path = trimmed.slice(base.length + 1).replace(/\/-\/.*$/, '').replace(/\.git$/, '');
  const segments = path.split('/');
  return segments.length >= 2 && segments.every(s => SEGMENT.test(s)) ? path : null;
}
