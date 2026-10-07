/**
 * How the web connector behaves as a guest on someone else's site: it reads
 * the site's robots.txt once per run and skips what it disallows (RFC 9309),
 * and it leaves a gap between two requests to the same site, the longer of a
 * default and the site's own `Crawl-delay`, capped.
 *
 * The sync runner puts `politeness` on every real run's context. A context
 * without it, as in the connector's unit tests, fetches unpaced and never asks
 * for robots.txt.
 */
import type { SourceContext } from './types';

export type CrawlPoliteness = {
  /** Read and obey each site's robots.txt. */
  robots: boolean;
  /** Smallest gap between two requests to one site. */
  minDelayMs: number;
  /** Largest gap a site's `Crawl-delay` can ask for. */
  maxDelayMs: number;
};

export const DEFAULT_CRAWL_POLITENESS: CrawlPoliteness = {
  robots: true,
  minDelayMs: 1_000,
  maxDelayMs: 30_000,
};

const ROBOTS_TIMEOUT_MS = 10_000;
/** RFC 9309 asks parsers to read at least the first 500 KiB. */
const ROBOTS_MAX_BYTES = 500 * 1024;

type Rule = { allow: boolean; pattern: string };

export type RobotsPolicy = {
  /** True when the path (with its query string) may be fetched. */
  allows: (pathWithQuery: string) => boolean;
  /** The group's `Crawl-delay`, in seconds, when it set one. */
  crawlDelaySeconds?: number;
  /** Why every path is refused, when the file could not be read at all. */
  refusedBecause?: string;
};

const ALLOW_ALL: RobotsPolicy = { allows: () => true };

/**
 * The product token a robots.txt group names, from a User-Agent string:
 * `VocionBot/0.1 (+https://vocion.ai)` answers to `vocionbot`.
 * @param userAgent - the full User-Agent header.
 */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[\s/]/)[0] ?? userAgent).toLowerCase();
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

/**
 * Read a robots.txt body into the policy for one crawler.
 *
 * Groups whose User-agent equals the product token win over `*`, and several
 * groups naming the same agent are merged. The longest matching rule decides
 * a path; on a tie, Allow wins. An empty Disallow allows everything.
 * @param body - the robots.txt text.
 * @param token - the crawler's product token, lower case.
 */
export function parseRobots(body: string, token: string): RobotsPolicy {
  type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 1) {
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) {
      continue;
    }
    if ((key === 'allow' || key === 'disallow') && value) {
      current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelay = seconds;
      }
    }
  }

  const named = groups.filter(g => g.agents.includes(token));
  const chosen = named.length ? named : groups.filter(g => g.agents.includes('*'));
  if (!chosen.length) {
    return ALLOW_ALL;
  }
  const rules = chosen.flatMap(g => g.rules);
  const crawlDelaySeconds = chosen.map(g => g.crawlDelay).find(d => d !== undefined);
  return {
    crawlDelaySeconds,
    allows: (path) => {
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!patternMatches(rule.pattern, path)) {
          continue;
        }
        if (!best
          || rule.pattern.length > best.pattern.length
          || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/**
 * Fetch and read one site's robots.txt (RFC 9309 section 2.3.1): a 2xx body
 * is parsed; any 4xx means no rules; a 5xx or an unreachable file means the
 * whole site is off limits for this run.
 * @param origin - `https://host[:port]`.
 * @param userAgent - the User-Agent header the crawler sends.
 */
export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsPolicy> {
  const url = `${origin}/robots.txt`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS) });
  } catch (err) {
    return { allows: () => false, refusedBecause: `robots.txt unreachable (${(err as Error).message}), site skipped this run` };
  }
  if (res.status >= 500) {
    return { allows: () => false, refusedBecause: `robots.txt answered HTTP ${res.status}, site skipped this run` };
  }
  if (!res.ok) {
    return ALLOW_ALL;
  }
  const body = (await res.text()).slice(0, ROBOTS_MAX_BYTES);
  return parseRobots(body, productToken(userAgent));
}

type HostState = { policy: Promise<RobotsPolicy>; lastAt: number; queue: Promise<void> };

const hostsByRun = new WeakMap<SourceContext, Map<string, HostState>>();

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for this site's turn and say whether the URL may be fetched. Requests
 * to one site are queued one behind the other, each starting at least the
 * site's gap after the previous one; robots.txt is read on the site's first
 * request of the run and counts as a request.
 * @param ctx - the run context, which keys the per-site state for this run.
 * @param politeness - the run's policy.
 * @param url - the absolute http(s) URL about to be fetched.
 * @param userAgent - the User-Agent header the crawler sends.
 */
export async function politeTurn(
  ctx: SourceContext,
  politeness: CrawlPoliteness,
  url: string,
  userAgent: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const { origin, pathname, search } = new URL(url);
  let hosts = hostsByRun.get(ctx);
  if (!hosts) {
    hosts = new Map();
    hostsByRun.set(ctx, hosts);
  }
  let host = hosts.get(origin);
  if (!host) {
    const state: HostState = { policy: Promise.resolve(ALLOW_ALL), lastAt: 0, queue: Promise.resolve() };
    state.policy = politeness.robots
      ? fetchRobots(origin, userAgent).finally(() => {
          state.lastAt = Date.now();
        })
      : Promise.resolve(ALLOW_ALL);
    hosts.set(origin, state);
    host = state;
  }

  const policy = await host.policy;
  if (policy.refusedBecause) {
    return { allowed: false, reason: policy.refusedBecause };
  }
  if (!policy.allows(`${pathname}${search}`)) {
    return { allowed: false, reason: 'disallowed by robots.txt' };
  }

  const { minDelayMs, maxDelayMs } = politeness;
  const asked = (policy.crawlDelaySeconds ?? 0) * 1000;
  const gap = Math.min(Math.max(minDelayMs, asked), Math.max(minDelayMs, maxDelayMs));
  const state = host;
  const turn = state.queue.then(async () => {
    const wait = state.lastAt + gap - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    state.lastAt = Date.now();
  });
  state.queue = turn;
  await turn;
  return { allowed: true };
}
