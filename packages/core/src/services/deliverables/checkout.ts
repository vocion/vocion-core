/**
 * Check-out and check-in — the editor-neutral round trip for a deliverable
 * (`docs/decks.md`, "Out and back"). Works for both kinds: a deck goes out as
 * `deck.json` plus `slides/<id>.html` (or as a Claude Slides project), a
 * document as `document.html`.
 *
 * Vocion is the canonical copy. Check-out writes nothing; check-in is a new
 * version, re-rendered and re-audited, that records where it came back from
 * (`origin`). A check-in whose `baseVersion` is stale — the deliverable's
 * CONTENT changed in Vocion since it went out — is refused with the
 * slide-by-slide (or sheet-by-sheet) diff, so the person can redo their change
 * on top. A version that only recorded a verify or a red-team read is not a
 * content change and does not make a check-out stale.
 */

import type { DeckSpec, DocumentSpec } from '@/libs/cards/specs';
import type { ArtifactRow, Author } from '@/services/ArtifactService';
import type { AssetSource, DeckInput, DeckVerifyOutcome } from '@/services/decks/DeckEngine';
import type { VerifyOutcome } from '@/services/documents/DocumentEngine';
import { createHash } from 'node:crypto';
import { assetDownloadLink } from '@/libs/decks/assetLink';
import { blobAssetId, claudeSlidesToDeck, deckToClaudeSlides, isClaudeSlides } from '@/libs/decks/claudeSlides';
import { diffDecks, diffDocuments, diffText, isEmptyDiff } from '@/libs/decks/diff';
import { DECK_FILE, deckToFiles, DOCUMENT_FILE, filesToDeck } from '@/libs/decks/files';
import { assetRefs } from '@/libs/decks/slides';
import { stripFramework } from '@/libs/documents/framework';
import { ArtifactError, getArtifact, getArtifactVersion } from '@/services/ArtifactService';
import { ingestDeckAssets, reviseDeck } from '@/services/decks/DeckEngine';
import { reviseDocument } from '@/services/documents/DocumentEngine';

export type Checkout = {
  id: number;
  kind: 'deck' | 'document';
  title: string;
  baseVersion: number;
  format: 'vocion-deck/1' | 'claude-slides/4' | 'document-html';
  files: Record<string, string>;
  /** Asset id (or `project/_blob/<hex>` path) → a short-lived download link. */
  downloads: Record<string, string>;
};

/**
 * A deliverable as files.
 * @param input - Which one, and for a deck which file layout.
 * @param input.orgId
 * @param input.id
 * @param input.format - `vocion` (default) or `claude-slides`, for a deck.
 */
export async function checkoutDeliverable(input: { orgId: string; id: number; format?: 'vocion' | 'claude-slides' }): Promise<Checkout> {
  const row = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!row) {
    throw new ArtifactError('NOT_FOUND', `artifact #${input.id} not found`);
  }
  if (row.kind === 'document') {
    const spec = row.spec as Partial<DocumentSpec>;
    return { id: row.id, kind: 'document', title: row.title, baseVersion: row.currentVersion, format: 'document-html', files: { [DOCUMENT_FILE]: stripFramework(spec.html ?? '') }, downloads: {} };
  }
  if (row.kind !== 'deck') {
    throw new ArtifactError('INVALID_KIND', `artifact #${input.id} is a ${row.kind}; only decks and documents check out`);
  }
  const spec = row.spec as DeckSpec;
  const link = (url: string) => assetDownloadLink({ orgId: input.orgId, url });
  if (input.format === 'claude-slides') {
    const hexOf = (assetId: string) => {
      const a = spec.assets?.[assetId];
      return a ? createHash('sha256').update(a.url).digest('hex').slice(0, 32) : null;
    };
    const downloads: Record<string, string> = {};
    for (const [assetId, a] of Object.entries(spec.assets ?? {})) {
      const l = link(a.url);
      if (l) {
        downloads[`project/_blob/${hexOf(assetId)}`] = l;
      }
    }
    return { id: row.id, kind: 'deck', title: row.title, baseVersion: row.currentVersion, format: 'claude-slides/4', files: deckToClaudeSlides(spec, hexOf), downloads };
  }
  const downloads: Record<string, string> = {};
  const files = deckToFiles(spec, (assetId, a) => {
    const l = link(a.url);
    if (l) {
      downloads[assetId] = l;
    }
    return l;
  });
  return { id: row.id, kind: 'deck', title: row.title, baseVersion: row.currentVersion, format: 'vocion-deck/1', files, downloads };
}

export type CheckinResult
  = | { status: 'stale'; currentVersion: number; diff: string }
    | { status: 'unchanged'; version: number }
    | { status: 'written'; kind: 'deck'; artifact: ArtifactRow; version: number; outcome: DeckVerifyOutcome; spec: DeckSpec; warnings: string[] }
    | { status: 'written'; kind: 'document'; artifact: ArtifactRow; version: number; outcome: VerifyOutcome; warnings: string[] };

/**
 * The content of a version, for the staleness test — or null when it is gone.
 * @param orgId - The workspace.
 * @param row - The artifact.
 * @param version - Which version.
 */
async function specAt(orgId: string, row: ArtifactRow, version: number): Promise<Record<string, unknown> | null> {
  if (version === row.currentVersion) {
    return row.spec;
  }
  const v = await getArtifactVersion({ orgId, artifactId: row.id, version });
  return v?.spec ?? null;
}

/**
 * Write what came back as a new version, or refuse a stale one with the diff.
 * @param input - The deliverable, the version it was checked out at, the files, and new images.
 * @param input.orgId
 * @param input.id
 * @param input.baseVersion
 * @param input.files - Path → text.
 * @param input.assets - New images by asset id (or Claude blob hex): a URL or base64.
 * @param input.author
 * @param input.runId
 * @param input.tool - What edited it, for `origin.tool` ("Claude", "ChatGPT"…), as the caller said.
 * @param input.changeSummary
 * @param input.onProgress
 */
export async function checkinDeliverable(input: {
  orgId: string;
  id: number;
  baseVersion: number;
  files: Record<string, string>;
  assets?: Record<string, AssetSource>;
  author: Author;
  runId?: string | null;
  tool?: string;
  changeSummary?: string;
  onProgress?: (note: string) => void;
}): Promise<CheckinResult> {
  const row = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!row) {
    throw new ArtifactError('NOT_FOUND', `artifact #${input.id} not found`);
  }
  if (row.kind !== 'deck' && row.kind !== 'document') {
    throw new ArtifactError('INVALID_KIND', `artifact #${input.id} is a ${row.kind}; only decks and documents check in`);
  }
  if (input.baseVersion > row.currentVersion) {
    throw new ArtifactError('CONFLICT', `baseVersion ${input.baseVersion} is newer than the deliverable (v${row.currentVersion})`);
  }
  const base = await specAt(input.orgId, row, input.baseVersion);
  if (!base) {
    throw new ArtifactError('NOT_FOUND', `version ${input.baseVersion} of #${input.id} no longer exists; check it out again`);
  }
  const summary = input.changeSummary?.trim() || `Checked in${input.tool ? ` from ${input.tool}` : ''} (from v${input.baseVersion})`;

  if (row.kind === 'document') {
    const html = input.files[DOCUMENT_FILE];
    if (typeof html !== 'string') {
      throw new ArtifactError('INVALID_SPEC', `a document checks in as ${DOCUMENT_FILE}`);
    }
    const current = stripFramework((row.spec as Partial<DocumentSpec>).html ?? '');
    const moved = diffDocuments(stripFramework((base as Partial<DocumentSpec>).html ?? ''), current);
    if (!isEmptyDiff(moved)) {
      return { status: 'stale', currentVersion: row.currentVersion, diff: diffText(moved) };
    }
    if (isEmptyDiff(diffDocuments(current, html)) && current.trim() === html.trim()) {
      return { status: 'unchanged', version: row.currentVersion };
    }
    const { artifact, version, outcome } = await reviseDocument({ orgId: input.orgId, id: input.id, author: input.author, runId: input.runId ?? null, changeSummary: summary, html, ifVersion: row.currentVersion, verify: { onProgress: input.onProgress } });
    return { status: 'written', kind: 'document', artifact, version: version.version, outcome, warnings: [] };
  }

  const current = row.spec as DeckSpec;
  const moved = diffDecks(base as DeckSpec, current);
  if (!isEmptyDiff(moved)) {
    return { status: 'stale', currentVersion: row.currentVersion, diff: diffText(moved) };
  }
  const warnings: string[] = [];
  let incoming: Omit<DeckInput, 'assets'>;
  let wanted: string[];
  const sources: Record<string, AssetSource> = {};
  if (isClaudeSlides(input.files)) {
    const imported = claudeSlidesToDeck(input.files, current.title);
    warnings.push(...imported.warnings);
    incoming = { ...imported.spec, playbook: current.playbook };
    wanted = imported.blobs.map(blobAssetId);
    for (const hex of imported.blobs) {
      const id = blobAssetId(hex);
      const given = input.assets?.[hex] ?? input.assets?.[id];
      const inline = Object.entries(input.files).find(([p]) => p.endsWith(`_blob/${hex}`))?.[1];
      if (given) {
        sources[id] = given;
      } else if (inline) {
        sources[id] = { base64: inline };
      }
    }
    incoming.origin = { kind: 'checkout', tool: input.tool ?? 'Claude Slides', baseVersion: input.baseVersion };
  } else {
    if (typeof input.files[DECK_FILE] !== 'string') {
      throw new ArtifactError('INVALID_SPEC', `a deck checks in as ${DECK_FILE} plus slides/<id>.html (or a Claude Slides project)`);
    }
    const read = filesToDeck(input.files);
    warnings.push(...read.warnings);
    incoming = {
      title: read.title,
      order: read.order,
      slides: read.slides,
      ...(read.sections ? { sections: read.sections } : {}),
      ...(read.faces ? { faces: read.faces } : {}),
      ...(read.playbook ?? current.playbook ? { playbook: read.playbook ?? current.playbook } : {}),
      origin: { kind: 'checkout', ...(input.tool ? { tool: input.tool } : {}), baseVersion: input.baseVersion },
    };
    wanted = [...new Set([...read.assetIds, ...Object.values(read.slides).flatMap(h => assetRefs(h).ids)])];
    for (const [id, src] of Object.entries(input.assets ?? {})) {
      sources[id] = src;
    }
  }
  // Images: what came back new is stored; what was already Vocion's is kept by id.
  const ingested = Object.keys(sources).length ? await ingestDeckAssets(input.orgId, sources) : { assets: {}, errors: [] };
  warnings.push(...ingested.errors);
  const assets: NonNullable<DeckSpec['assets']> = {};
  for (const id of wanted) {
    const a = ingested.assets[id] ?? current.assets?.[id];
    if (a) {
      assets[id] = a;
    }
  }
  const deck: DeckInput = { ...incoming, ...(Object.keys(assets).length ? { assets } : {}) };
  if (isEmptyDiff(diffDecks(current, { ...current, ...deck })) && JSON.stringify(current.assets ?? {}) === JSON.stringify(deck.assets ?? {})) {
    return { status: 'unchanged', version: row.currentVersion };
  }
  const { artifact, version, outcome } = await reviseDeck({ orgId: input.orgId, id: input.id, author: input.author, runId: input.runId ?? null, changeSummary: summary, deck, ifVersion: row.currentVersion, verify: { onProgress: input.onProgress } });
  return { status: 'written', kind: 'deck', artifact, version: version.version, outcome, spec: artifact.spec as DeckSpec, warnings };
}
