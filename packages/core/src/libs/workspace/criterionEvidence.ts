import type { FeatureProof, ProofCriterion, ProofState } from './featureProof';
import { markdownSections } from '@/libs/cards/headingAnchor';

/**
 * WHICH ARTIFACT PROVES WHICH CRITERION — the proof a release can open.
 *
 * Release #223 (2026-09-29) read "QA approved, 6 of 6…" and, folded under
 * Technical details, eight links all called "QA screenshot": the before
 * shots, the duplicates, none tied to a criterion — and the named-test run
 * that proved four of the six lines was not linked at all. The proof was on
 * the record; the release could not show it (principle 10: every claim
 * traceable in one move).
 *
 * This pairs each line of {@link FeatureProof} (the one count every surface
 * reads) with the stored artifact behind it, from QA's own words:
 *
 * - a line whose evidence names an artifact (`…/artifacts/1369`) is that
 *   artifact — a `qa-test-run` is a named-test proof, a `qa-screenshot` a
 *   screenshot;
 * - a line whose evidence links a picture is the screenshot artifact carrying
 *   that picture, the lowest id when the capture stored it twice, with the
 *   "before" shot of the same flow and viewport beside it;
 * - a named-test proof carries the test's name and, when the run's document
 *   has a section for it, that section's anchor.
 *
 * Pure: the release pack stores what this returns, and the release page reads
 * it again from the same records, so the two cannot disagree.
 */

/** An artifact as the pairing reads it. `md` is a markdown artifact's text. */
export type ProofArtifact = { id: number; title: string; kind: string; role: string | null; url: string | null; md: string | null };

/** One criterion's proof, as the release pack stores it (`meta.evidence[].criteria`). */
export type CriterionEvidence = {
  criterion: string;
  group: ProofCriterion['group'];
  status: ProofState;
  /** What kind of proof backs it; null when QA's words name neither. */
  kind: 'screenshot' | 'test' | null;
  /** The stored artifact that is the proof, when one is. */
  artifactId: number | null;
  testName?: string;
  /** The same flow's "before" shot, one click from the after. */
  beforeArtifactId?: number;
  /** The section of the test-run document that holds this test. */
  anchor?: string;
};

const IMAGE = /\.(?:png|jpe?g|gif|webp)$/i;

function bare(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/$/, '');
}

function fileOf(url: string): string {
  return bare(url).split('/').pop() ?? '';
}

function normal(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A screenshot title's parts: "Checkout, empty cart · desktop · after".
 * @param title - The artifact's title.
 */
export function shotParts(title: string): { flow: string; viewport: string | null; side: 'before' | 'after' | null } {
  const parts = title.split(' · ').map(p => p.trim());
  const last = parts[parts.length - 1]?.toLowerCase();
  const side = last === 'before' || last === 'after' ? last : null;
  const rest = side ? parts.slice(0, -1) : parts;
  return { flow: rest.length > 1 ? rest.slice(0, -1).join(' · ') : rest[0] ?? '', viewport: rest.length > 1 ? rest[rest.length - 1]! : null, side };
}

/**
 * The named test a piece of evidence quotes: `Named test 'csv content: …' passed`.
 * @param evidence - QA's words.
 */
export function testNameOf(evidence: string | null): string | null {
  const m = evidence ? /named test\s+(?:'([^']+)'|"([^"]+)"|‘([^’]+)’|“([^”]+)”|`([^`]+)`)/i.exec(evidence) : null;
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5])!.trim() : null;
}

function isShot(a: ProofArtifact): boolean {
  return a.role === 'qa-screenshot' || a.kind === 'image' || (a.url !== null && IMAGE.test(bare(a.url)));
}

/**
 * The section of a test-run document that holds this test: the one that ran
 * it, else the one whose heading is the criterion's words.
 * @param md - The test-run document.
 * @param testName - The test.
 * @param criterion - The line it proves.
 */
function sectionAnchor(md: string, testName: string | null, criterion: string): string | undefined {
  const sections = markdownSections(md).filter(s => s.level >= 2);
  if (testName) {
    // The section that RAN the test: its command names it in quotes, or its
    // output passes it (✓). Every section's output also lists the tests it
    // skipped, so a bare mention names every section.
    const ran = (body: string) => body.includes(`"${testName}"`) || body.includes(`'${testName}'`) || body.split('\n').some(l => /^\s*[✓✔]/.test(l) && l.includes(testName));
    const hit = sections.find(s => ran(s.body));
    if (hit) {
      return hit.anchor;
    }
  }
  const line = normal(criterion);
  const hit = sections.find((s) => {
    const heading = normal(s.text.replace(/^(passed|failed|skipped)\s*:\s*/i, ''));
    return heading.length >= 12 && (line.startsWith(heading) || heading.startsWith(line) || line.slice(0, 40) === heading.slice(0, 40));
  });
  return hit?.anchor;
}

/**
 * The proof behind one criterion.
 * @param c - The criterion, as {@link FeatureProof} judged it.
 * @param artifacts - The artifacts stored on the attempt that counts.
 */
export function evidenceFor(c: ProofCriterion, artifacts: ProofArtifact[]): CriterionEvidence {
  const words = c.evidence ?? '';
  const byId = new Map(artifacts.map(a => [a.id, a]));
  const cited = [...words.matchAll(/\/artifacts\/(\d+)/g)].map(m => byId.get(Number(m[1]))).find((a): a is ProofArtifact => a !== undefined);
  const links = [...words.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)].map(m => m[0].replace(/[.,;:!?]+$/, ''));
  const pictures = links.filter(u => IMAGE.test(bare(u)));
  const files = new Set([...pictures.map(fileOf), ...[...words.matchAll(/([\w.-]+\.(?:png|jpe?g|gif|webp))\b/gi)].map(m => m[1]!)]);
  const byOrder = [...artifacts].sort((x, y) => x.id - y.id);
  const shown = cited
    ?? byOrder.find(a => isShot(a) && a.url !== null && pictures.some(p => bare(p) === bare(a.url!)))
    ?? byOrder.find(a => isShot(a) && a.url !== null && files.has(fileOf(a.url)));
  const testName = testNameOf(words);
  const kindOf = (): CriterionEvidence['kind'] => {
    if (shown?.role === 'qa-test-run') {
      return 'test';
    }
    if (shown && isShot(shown)) {
      return 'screenshot';
    }
    return testName !== null ? 'test' : !shown && /\bscreenshot\b/i.test(words) ? 'screenshot' : null;
  };
  const kind = kindOf();
  const out: CriterionEvidence = { criterion: c.statement, group: c.group, status: c.state, kind, artifactId: shown?.id ?? null };
  if (kind === 'test' && testName) {
    out.testName = testName;
  }
  if (kind === 'screenshot' && shown) {
    const after = shotParts(shown.title);
    const before = byOrder.find((a) => {
      const p = shotParts(a.title);
      return a.id !== shown.id && a.role === 'qa-screenshot' && p.side === 'before' && p.flow === after.flow && p.viewport === after.viewport;
    });
    if (before) {
      out.beforeArtifactId = before.id;
    }
  }
  if (kind === 'test' && shown?.md) {
    const anchor = sectionAnchor(shown.md, testName, c.statement);
    if (anchor) {
      out.anchor = anchor;
    }
  }
  return out;
}

/**
 * Every criterion's proof, acceptance lines then plan-risk lines.
 * @param proof - The one count (`featureProof`).
 * @param artifacts - The artifacts stored on the attempt that counts.
 */
export function criterionEvidence(proof: Pick<FeatureProof, 'acceptance' | 'risks'>, artifacts: ProofArtifact[]): CriterionEvidence[] {
  return [...proof.acceptance, ...proof.risks].map(c => evidenceFor(c, artifacts));
}

/**
 * The artifacts a release's stored proof names, so the page can load them.
 * @param meta - The release's metadata.
 */
export function evidenceArtifactIdsOf(meta: Record<string, unknown>): number[] {
  const stored = Array.isArray(meta.verificationArtifactIds) ? meta.verificationArtifactIds : [];
  const packs = Array.isArray(meta.evidence) ? meta.evidence as Array<Record<string, unknown>> : [];
  const cited = packs.flatMap(p => (Array.isArray(p?.criteria) ? p.criteria as Array<Record<string, unknown>> : [])).flatMap(c => [c?.artifactId, c?.beforeArtifactId]);
  return [...new Set([...stored, ...cited].map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
}
