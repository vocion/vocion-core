/**
 * Which rendered files a superseded version left behind, and which of them are
 * safe to remove.
 *
 * Every render-verify writes a PNG per sheet and a PDF into the artifact
 * store, and nothing has ever removed one. A twelve-sheet proposal edited
 * twenty times is 260 files, 259 of which nobody will open again; the box's
 * disk grows for the life of the deployment. So: a plan, and a plan only.
 *
 * The rules, in the order they bind — each one is a way of NOT deleting
 * something:
 *
 *  1. **A file a CURRENT version references is never removable.** That is the
 *     document the person has open.
 *  2. **The newest N superseded versions keep their files.** Restoring v2
 *     writes a new head carrying v2's content, so recent history has to stay
 *     openable, not just listable.
 *  3. **A file is removable only if NO surviving reference anywhere points at
 *     it.** The store is content-addressed — `<orgId>-<sha256[0..16]>.<ext>` —
 *     so a sheet that did not change between v3 and v4 is ONE file on disk
 *     that both versions name. Per-version bookkeeping alone would delete a
 *     live sheet. The union is taken across every artifact in the org, not
 *     just the one being swept.
 *  4. **A file no version ever referenced is not a candidate.** `generate_image`
 *     writes PNGs that live only in a message's markdown, and a `markdown`
 *     artifact's body can name a stored file inline. Nothing here walks prose,
 *     so nothing here may delete on prose's behalf: candidates come ONLY from
 *     the specs of superseded versions. True orphans stay on disk, and that is
 *     the correct outcome for a function that cannot see who points at them.
 *
 * Pure: no database, no filesystem. It is handed what the rows say and it
 * returns a plan. `scripts/sweep-artifacts.ts` is what reads rows, and it
 * reports rather than deletes unless it is explicitly told otherwise.
 */

import { isSafeArtifactFilename } from './url';

/** One version of one artifact, reduced to what the sweep needs to decide. */
export type SweepVersion = {
  artifactId: number;
  /** The version number; higher is newer. */
  version: number;
  /** Whether this is the artifact's head — the version the app serves. */
  current: boolean;
  /** Artifact-store filenames this version references, in any order. */
  files: readonly string[];
};

/** One file the plan would remove, and the version whose supersession freed it. */
export type SweepCandidate = {
  filename: string;
  artifactId: number;
  /** The newest superseded version that referenced it. */
  version: number;
};

export type SweepPlan = {
  /** Files nothing surviving points at. Ordered by artifact, then version, then name. */
  removable: SweepCandidate[];
  /** Distinct filenames a current version holds. */
  keptCurrent: number;
  /** Distinct filenames kept because they belong to one of the newest N superseded versions. */
  keptRecent: number;
  /**
   * Files a superseded version named that a SURVIVING version names too —
   * kept by rule 3. A non-zero count here is the content-addressed store
   * doing its job, and the number this sweep would have destroyed if it
   * counted per version.
   */
  keptShared: number;
};

export type SweepOptions = {
  /**
   * How many superseded versions per artifact keep their files. 0 keeps only
   * the current version's; the script's default is deliberately higher,
   * because a person restoring last week's draft expects to see it.
   */
  keepSuperseded: number;
};

/**
 * The artifact-store filename a stored URL points at, or null when the URL is
 * not one of ours.
 *
 * Two shapes exist in live rows: the authenticated route
 * `/api/artifacts/<id>/<file>` and the legacy `/artifacts/<file>` that
 * `artifactHref` still rewrites. Anything else — an external link, a data
 * URI, an in-app route — is not a file this sweep may reason about.
 * @param url - Whatever the spec stored.
 */
export function artifactFilenameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  const m = url.match(/^\/(?:api\/)?artifacts\/(?:[\w.-]+\/)?([\w.-]+)$/);
  const name = m?.[1];
  if (!name || !isSafeArtifactFilename(name) || !name.includes('.')) {
    return null;
  }
  return name;
}

/**
 * Every artifact-store filename a version's spec (and, for a file artifact,
 * its row URL) points at.
 *
 * Deliberately narrow: the document verification's sheet images and PDF, and
 * a file artifact's own URL. A `markdown` body or a `link` href is NOT read —
 * see rule 4 above.
 * @param spec - The version's spec, as stored.
 * @param rowUrl - The artifact row's `url` column, when the caller has it.
 */
export function filesInSpec(spec: unknown, rowUrl?: unknown): string[] {
  const found = new Set<string>();
  const add = (u: unknown) => {
    const name = artifactFilenameFromUrl(u);
    if (name) {
      found.add(name);
    }
  };
  add(rowUrl);
  if (spec && typeof spec === 'object') {
    const s = spec as Record<string, unknown>;
    add(s.url);
    const verification = s.verification;
    if (verification && typeof verification === 'object') {
      const v = verification as Record<string, unknown>;
      add(v.pdf);
      if (Array.isArray(v.sheets)) {
        for (const sheet of v.sheets) {
          if (sheet && typeof sheet === 'object') {
            add((sheet as Record<string, unknown>).image);
          }
        }
      }
    }
  }
  return [...found];
}

/**
 * Decide what is removable, given every version of every artifact in one
 * workspace. Pure.
 *
 * Hand it the WHOLE org: rule 3 needs the complete set of surviving
 * references, and a partial list would make a shared file look orphaned.
 * @param versions - Every version row, any order.
 * @param options - How much history keeps its files.
 */
export function planArtifactSweep(versions: readonly SweepVersion[], options: SweepOptions): SweepPlan {
  const keepSuperseded = Math.max(0, Math.floor(options.keepSuperseded));

  // Newest first within each artifact, so "the newest N superseded" is a slice.
  const byArtifact = new Map<number, SweepVersion[]>();
  for (const v of versions) {
    const list = byArtifact.get(v.artifactId) ?? [];
    list.push(v);
    byArtifact.set(v.artifactId, list);
  }
  for (const list of byArtifact.values()) {
    list.sort((a, b) => b.version - a.version);
  }

  const currentFiles = new Set<string>();
  const recentFiles = new Set<string>();
  // Superseded-and-old versions: the only place a candidate may come from.
  const candidates: SweepCandidate[] = [];

  for (const list of byArtifact.values()) {
    let supersededSeen = 0;
    for (const v of list) {
      if (v.current) {
        for (const f of v.files) {
          currentFiles.add(f);
        }
        continue;
      }
      supersededSeen += 1;
      if (supersededSeen <= keepSuperseded) {
        for (const f of v.files) {
          recentFiles.add(f);
        }
        continue;
      }
      for (const f of v.files) {
        candidates.push({ filename: f, artifactId: v.artifactId, version: v.version });
      }
    }
  }

  // Rule 3: anything a surviving version still names stays, whoever named it.
  const surviving = new Set([...currentFiles, ...recentFiles]);
  const seen = new Set<string>();
  const removable: SweepCandidate[] = [];
  let keptShared = 0;
  for (const c of candidates) {
    if (surviving.has(c.filename)) {
      if (!seen.has(c.filename)) {
        seen.add(c.filename);
        keptShared += 1;
      }
      continue;
    }
    if (seen.has(c.filename)) {
      continue;
    }
    seen.add(c.filename);
    removable.push(c);
  }
  removable.sort((a, b) => a.artifactId - b.artifactId || b.version - a.version || a.filename.localeCompare(b.filename));

  // A file kept by recency that a current version also holds is counted once,
  // under the stronger reason.
  let keptRecent = 0;
  for (const f of recentFiles) {
    if (!currentFiles.has(f)) {
      keptRecent += 1;
    }
  }
  return { removable, keptCurrent: currentFiles.size, keptRecent, keptShared };
}
