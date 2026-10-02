/**
 * WHAT A RUN DID, AS A PERSON WOULD SAY IT (Chris, 2026-10-02, FE-370).
 *
 * A run used to be listed by whatever string it was stored with:
 * `release-live-check: Every criterion is proven, or it is named as
 * unproven` (an automation slug and a mission's charter line), `Task
 * send-t374 (logic): changed 1 file(s), 6/6 checks passed, opened https://…`
 * (a worker's log line), or a bare `RUN-477`. This is the one function every
 * list of runs titles them with — the feature page's Timeline, its side
 * panel, the Activity feed, the Now line — so a run reads the same wherever
 * it is listed:
 *
 *   Built attempt 3 · 6/6 checks · PR #175
 *   Built attempt 1 · failed `test`
 *   QA reviewed attempt 2 · sent back: the header still wraps at 390px
 *   Checked it live · seen 4 of 4
 *   Drew the mockup
 *
 * Built from typed facts only: what kind of run it is, how it ended, which
 * attempt, the pull request and checks it reported, and the words the
 * workspace gave the definition that started it — an automation's `label`
 * ("Checked it live") and `doing` ("Checking it live") in its YAML. Core
 * names no automation, tool or record type here. The run's code (RUN-479)
 * is metadata beside the title, never the title.
 */

/** A run's checks as its result reported them. */
export type RunTitleCheck = { name: string; passed: boolean | null };

export type RunTitleFacts = {
  /** An engineering build (`worker_run`) or an agent's run (`mission_run`). */
  kind: 'build' | 'agent';
  /** The run's own status column. */
  status: string;
  /** Whether a build actually executed — a refused or never-claimed run did not. Absent, it did. */
  executed?: boolean;
  /**
   * What a finished run of this definition did, past tense — the starting
   * automation's `label` ("Checked it live"), else its name.
   */
  label?: string | null;
  /** The same while it runs ("Checking it live") — the automation's `doing`, else its name. */
  doing?: string | null;
  /** The attempt it built or reviewed, 1-based, when it is about one. */
  attempt?: number | null;
  /** How many attempts there are, for a build still queued ("attempt 2 of 3"). */
  of?: number | null;
  /**
   * What it found, in a few words, read off the record it wrote: "seen 4 of
   * 4", "approved 6 of 6", "sent back: <reason>". Absent, nothing is added.
   */
  result?: string | null;
  /** The pull request a build opened. */
  prUrl?: string | null;
  /** The checks a build reported. */
  checks?: readonly RunTitleCheck[];
  /** The checks a failed build named as failing (`check:<name>` failures), when its checks list is empty. */
  failedChecks?: readonly string[];
  /** The run's stored title: the last resort, for a run no definition names (a person's, a planner's). */
  stored?: string | null;
};

const LIVE = new Set(['queued', 'claimed', 'running', 'paused', 'planning', 'awaiting_review']);

/**
 * "PR #175" from a pull request URL, or null.
 * @param url - The URL.
 */
export function prNumberLabel(url: string | null | undefined): string | null {
  const n = url ? /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1] : undefined;
  return n ? `PR #${n}` : null;
}

/**
 * "6/6 checks" when any check reported, else null.
 * @param checks - The checks.
 */
function checksWord(checks: readonly RunTitleCheck[] | undefined): string | null {
  const known = (checks ?? []).filter(c => c.passed !== null);
  if (known.length === 0) {
    return null;
  }
  return `${known.filter(c => c.passed).length}/${known.length} checks`;
}

/**
 * The first failing check's name, as code: "`test`".
 * @param f - The facts.
 */
function failedCheck(f: RunTitleFacts): string | null {
  const name = (f.checks ?? []).find(c => c.passed === false)?.name ?? f.failedChecks?.[0] ?? null;
  return name ? `\`${name.replace(/^npm run /, '')}\`` : null;
}

/**
 * A run whose definition gave it no words: its stored title, unless that is
 * the machine form `<slug>: <charter>` the fire wrote, or a bare code.
 * @param f - The facts.
 */
function plainStored(f: RunTitleFacts): string | null {
  const s = f.stored?.trim() ?? '';
  // Neither the fire's machine form nor a bare code (RUN-88) is a title.
  return s && !/^[a-z0-9]+(?:-[a-z0-9]+)+: /.test(s) && !/^[A-Z]{2,5}-\d+$/.test(s) ? s : null;
}

/**
 * The run's title.
 * @param f - What is known about it.
 */
export function runTitle(f: RunTitleFacts): string {
  const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ');
  const live = LIVE.has(f.status);
  if (f.kind === 'build') {
    const n = f.attempt ?? null;
    const which = n === null ? '' : ` attempt ${n}`;
    if (f.executed === false) {
      return `Attempt${n === null ? '' : ` ${n}`} did not start`;
    }
    if (live) {
      return f.status === 'queued'
        ? `Attempt${n === null ? '' : ` ${n}${f.of && f.of >= n ? ` of ${f.of}` : ''}`} queued`
        : f.status === 'paused' ? `Paused building${which}` : `Building${which}`;
    }
    if (f.status === 'cancelled') {
      return `Attempt${n === null ? '' : ` ${n}`} cancelled`;
    }
    if (f.status === 'completed') {
      return join(`Built${which || ' it'}`, checksWord(f.checks), prNumberLabel(f.prUrl));
    }
    const check = failedCheck(f);
    return join(`Built${which || ' it'}`, check ? `failed ${check}` : 'failed');
  }
  const done = f.label?.trim() || null;
  const doing = f.doing?.trim() || done;
  const about = (words: string) => (f.attempt ? `${words} attempt ${f.attempt}` : words);
  if (!done && !doing) {
    return join(plainStored(f) ?? 'Agent run', live ? 'running' : f.status === 'completed' ? null : f.status);
  }
  if (live) {
    return about(doing!);
  }
  if (f.status === 'completed') {
    return join(about(done ?? doing!), f.result);
  }
  return join(about(doing!), f.status === 'cancelled' ? 'cancelled' : 'did not finish');
}
