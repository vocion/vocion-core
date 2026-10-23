/**
 * The deck engine — the deck twin of `DocumentEngine`.
 *
 * A `deck` artifact is a `vocion-deck/1` presentation (`docs/decks.md`). Every
 * create and every revision renders each slide at 1920×1080 in the shared
 * Chromium, audits it with DOM facts, screenshots it and prints the PDF, and
 * stores the verdict ON THE VERSION it verified (`spec.verification`), exactly
 * as a document does — so the pane, the Proposals board and the agent's
 * receipt read the same facts.
 *
 * Nothing here is a second history: every write is an `ArtifactService`
 * version (the one door), and the red team, the export gate, the PDF filing
 * and the file store are the deliverable layer documents use
 * (`services/deliverables/`). A slide change drops the red-team receipt — a
 * version nobody has read as the buyer carries none — and only a re-verify or
 * the red team's own write carries it forward.
 */

import type { Buffer } from 'node:buffer';
import type { DeckAsset, DeckSpec, DeckVerification, DocumentRedTeam } from '@/libs/cards/specs';
import type { MeasuredSlide } from '@/libs/decks/audit';
import type { DeckOp } from '@/libs/decks/edit';
import type { AssetLoader, DeckRenderProgress } from '@/libs/decks/render';
import type { ArtifactRecordScope, ArtifactRow, ArtifactVersionRow, Author } from '@/services/ArtifactService';
import type { RedTeamOutcome } from '@/services/documents/redTeam';
import { Buffer as NodeBuffer } from 'node:buffer';
import { DECK_FORMAT } from '@/libs/cards/specs';
import { deckVerificationReceipt, evaluateDeck, mergeSlideFacts, staticSlideFacts } from '@/libs/decks/audit';
import { applyDeckOps, DeckEditError, deckProblems } from '@/libs/decks/edit';
import { deckOutline } from '@/libs/decks/outline';
import { deckRenderNote, renderDeck } from '@/libs/decks/render';
import { normaliseSlideHtml } from '@/libs/decks/slides';
import { renderAvailable } from '@/libs/documents/render';
import { isExternalHttpUrl } from '@/libs/tools/artifacts/url';
import { fetchImageBytes } from '@/libs/tools/image/remote';
import { voiceRulesFor } from '@/libs/writing/loadVoiceRules';
import { ArtifactError, createArtifact, getArtifact, updateArtifact } from '@/services/ArtifactService';
import { filePdf, MAX_ASSET_BYTES, pdfFilename, readStoredFile, storeImageAsset, storePdf, storeScreenshot } from '@/services/deliverables/files';
import { lookAtSheets } from '@/services/documents/look';
import { prepareSlidesText, redTeamDocument, redTeamRecord } from '@/services/documents/redTeam';

export { DeckEditError, deckOutline };

export type DeckVerifyOptions = {
  /** Take per-slide screenshots and store them (default true). */
  screenshots?: boolean;
  /** Print the PDF and store it (default true). */
  pdf?: boolean;
  /** Run the vision pass over the slides (default false — it costs a model call). */
  look?: boolean;
  /** Where the verify has got to, for the running step line (`slide 7 of 12`). */
  onProgress?: (note: string) => void;
};

export type DeckVerifyOutcome = {
  verification: DeckVerification;
  /** The PDF bytes, when printed — for the export, so it does not render twice. */
  pdf?: Buffer;
  renderer: 'chromium' | 'unavailable';
  ms: number;
};

/** What a caller hands the engine to make a deck: the spec without what the engine writes. */
export type DeckInput = Omit<DeckSpec, 'format' | 'verification' | 'redTeam'> & { format?: typeof DECK_FORMAT };

/**
 * A stored `deck` spec from its parts — the one funnel every write goes
 * through. `redTeam` is passed ONLY by a write that did not change a slide
 * (a re-verify, the red team recording its read), which is the freshness
 * rule: any slide change drops it.
 * @param input - The deck.
 * @param verification - This version's verify.
 * @param redTeam - The last read as the buyer, when it is still these slides.
 */
export function deckSpec(input: DeckInput | DeckSpec, verification?: DeckVerification, redTeam?: DocumentRedTeam): DeckSpec {
  const { verification: _v, redTeam: _r, ...rest } = input as DeckSpec;
  const slides = Object.fromEntries(Object.entries(rest.slides).map(([id, html]) => [id, normaliseSlideHtml(html)]));
  return {
    ...rest,
    format: DECK_FORMAT,
    title: rest.title.trim(),
    slides,
    ...(verification ? { verification } : {}),
    ...(redTeam ? { redTeam } : {}),
  };
}

/**
 * Reads a deck's images for the renderer, straight from the file store.
 * @param orgId - The workspace.
 * @param spec - The deck, for its asset table.
 */
export function deckAssetLoader(orgId: string, spec: Pick<DeckSpec, 'assets'>): AssetLoader {
  return async (id) => {
    const a = spec.assets?.[id];
    return a ? readStoredFile(orgId, a.url) : null;
  };
}

/**
 * Render and audit a deck, storing the slide PNGs and the PDF as served
 * files. Never throws for a deck problem; a renderer that cannot launch comes
 * back as a verification that says so, with the static audit still in it.
 * @param orgId - The workspace.
 * @param spec - The deck.
 * @param opts - What to produce.
 */
export async function verifyDeckSpec(orgId: string, spec: DeckSpec, opts: DeckVerifyOptions = {}): Promise<DeckVerifyOutcome> {
  const started = Date.now();
  const facts = staticSlideFacts(spec);
  const available = await renderAvailable();
  if (!available.ok) {
    return {
      verification: evaluateDeck({
        slides: facts.map(f => mergeSlideFacts(f)),
        pdfPages: null,
        extraIssues: [`Renderer unavailable (${available.reason}). The deck was saved but not render-verified — install Playwright's Chromium on this host.`],
      }),
      renderer: 'unavailable',
      ms: Date.now() - started,
    };
  }
  const note = (text: string) => {
    try {
      opts.onProgress?.(text);
    } catch {
      // The receipt is the product; the commentary is not.
    }
  };
  const rendered = await renderDeck(spec, {
    loadAsset: deckAssetLoader(orgId, spec),
    screenshots: opts.screenshots !== false,
    pdf: opts.pdf !== false,
    onProgress: (p: DeckRenderProgress) => note(deckRenderNote(p)),
  });
  note('storing the slides');
  const slides: MeasuredSlide[] = await Promise.all(facts.map(async (f, i) => {
    const dom = rendered.slides[i] ?? null;
    const image = dom?.png ? await storeScreenshot(orgId, dom.png) : undefined;
    return mergeSlideFacts(f, dom, image);
  }));
  const pdfUrl = rendered.pdf ? (await storePdf(orgId, rendered.pdf)).url : undefined;
  const verification = evaluateDeck({ slides, pdfPages: rendered.pdfPages, ...(pdfUrl ? { pdf: pdfUrl } : {}) });
  if (opts.look) {
    const withPng = rendered.slides.filter(s => s.png).map(s => ({ n: s.n, label: facts[s.n - 1]?.label ?? '', png: s.png! }));
    note(`looking at ${withPng.length} ${withPng.length === 1 ? 'slide' : 'slides'}`);
    try {
      const look = await lookAtSheets(orgId, withPng);
      if (look.status === 'looked') {
        for (const f of look.findings) {
          verification.issues.push(`look: slide ${f.sheet} — ${f.finding}`);
        }
      } else {
        verification.reports.push(`look: skipped — ${look.reason}`);
      }
    } catch (err) {
      verification.reports.push(`look: failed — ${(err as Error).message.split('\n')[0]}`);
    }
    verification.issues = verification.issues.slice(0, 40);
    verification.ok = verification.issues.length === 0;
  }
  return { verification, ...(rendered.pdf ? { pdf: rendered.pdf } : {}), renderer: 'chromium', ms: Date.now() - started };
}

/**
 * Throw the deck's structure problems as one `INVALID_SPEC`, so a tool can hand the sentence back.
 * @param spec - A candidate deck.
 */
function assertWritable(spec: DeckSpec): void {
  const problems = deckProblems(spec);
  if (problems.length > 0) {
    throw new ArtifactError('INVALID_SPEC', `the deck cannot be written:\n- ${problems.join('\n- ')}`);
  }
}

export type CreateDeckInput = {
  orgId: string;
  conversationId?: number | null;
  author: Author;
  visibility?: 'user' | 'system';
  folder?: string | null;
  record?: ArtifactRecordScope | null;
  deck: DeckInput;
  verify?: DeckVerifyOptions;
  changeSummary?: string;
};

/**
 * Create a deck artifact: check, verify, then persist v1 carrying the verdict.
 * Throws `ArtifactError('INVALID_SPEC')` naming every structure problem.
 * @param input - The deck and where it belongs.
 */
export async function createDeck(input: CreateDeckInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; outcome: DeckVerifyOutcome }> {
  const draft = deckSpec(input.deck);
  assertWritable(draft);
  const outcome = await verifyDeckSpec(input.orgId, draft, input.verify);
  const spec = deckSpec(draft, outcome.verification);
  const { artifact, version } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'deck',
    title: spec.title,
    spec,
    folder: input.folder ?? null,
    record: input.record ?? null,
    author: input.author,
    visibility: input.visibility ?? 'user',
    changeSummary: input.changeSummary ?? `Created · ${spec.order.length} ${spec.order.length === 1 ? 'slide' : 'slides'}`,
  });
  return { artifact, version, outcome };
}

/**
 * The deck a row holds, or a plain error.
 * @param orgId - The workspace.
 * @param id - The artifact.
 */
export async function loadDeck(orgId: string, id: number): Promise<{ row: ArtifactRow; spec: DeckSpec }> {
  const row = await getArtifact({ orgId, id });
  if (!row) {
    throw new ArtifactError('NOT_FOUND', `artifact #${id} not found`);
  }
  if (row.kind !== 'deck') {
    throw new ArtifactError('INVALID_KIND', `artifact #${id} is a ${row.kind}, not a deck`);
  }
  return { row, spec: row.spec as DeckSpec };
}

export type ReviseDeckInput = {
  orgId: string;
  id: number;
  author: Author;
  runId?: string | null;
  changeSummary: string;
  /** Either a whole new deck… */
  deck?: DeckInput;
  /** …or ops applied to the current one, all or none. */
  ops?: readonly DeckOp[];
  ifVersion?: number;
  verify?: DeckVerifyOptions;
};

/**
 * Change a deck in place: apply the ops (or take the new deck), verify, and
 * write the next version with its verdict. Throws `ArtifactError` for a
 * missing artifact, a conflict or an unwritable deck, `DeckEditError` for a
 * bad op.
 * @param input - What changes.
 */
export async function reviseDeck(input: ReviseDeckInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; outcome: DeckVerifyOutcome; applied: string[] }> {
  const { spec: current } = await loadDeck(input.orgId, input.id);
  let next: DeckSpec = input.deck ? deckSpec({ ...input.deck, playbook: input.deck.playbook ?? current.playbook }) : deckSpec(current);
  let applied: string[] = input.deck ? ['replaced the whole deck'] : [];
  if (input.ops && input.ops.length > 0) {
    const edited = applyDeckOps(next, input.ops);
    next = edited.spec;
    applied = [...applied, ...edited.applied];
  }
  assertWritable(next);
  const outcome = await verifyDeckSpec(input.orgId, next, input.verify);
  const spec = deckSpec(next, outcome.verification);
  const { artifact, version } = await updateArtifact({
    orgId: input.orgId,
    id: input.id,
    title: spec.title !== current.title ? spec.title : null,
    spec,
    author: input.author,
    changeSummary: input.changeSummary,
    runId: input.runId ?? null,
    ...(input.ifVersion === undefined ? {} : { ifVersion: input.ifVersion }),
    noCollapse: true,
  });
  return { artifact, version, outcome, applied };
}

/**
 * Re-verify the deck as it stands and record the verdict as a system
 * version. The words did not change, so the buyer's read still stands.
 * @param input - Which deck, and how.
 * @param input.orgId
 * @param input.id
 * @param input.agentSlug
 * @param input.verify
 */
export async function verifyDeckArtifact(input: { orgId: string; id: number; agentSlug?: string | null; verify?: DeckVerifyOptions }): Promise<{ artifact: ArtifactRow; outcome: DeckVerifyOutcome }> {
  const { spec: prior } = await loadDeck(input.orgId, input.id);
  const outcome = await verifyDeckSpec(input.orgId, prior, input.verify);
  const spec = deckSpec(prior, outcome.verification, prior.redTeam);
  const n = outcome.verification.issues.length;
  const { artifact } = await updateArtifact({
    orgId: input.orgId,
    id: input.id,
    title: null,
    spec,
    author: { kind: 'system', id: input.agentSlug ? `agent:${input.agentSlug}` : null },
    changeSummary: outcome.verification.ok ? 'Render-verified · no issues' : `Render-verified · ${n} ${n === 1 ? 'issue' : 'issues'}`,
    noCollapse: true,
  });
  return { artifact, outcome };
}

/**
 * Read the deck as the sceptical buyer — every slide's text AND its notes —
 * and record the read on the version that was read, as a document does. A
 * review that could not run records nothing.
 * @param input - Which deck, the house rubric and what the seller knows.
 * @param input.orgId
 * @param input.id
 * @param input.agentSlug
 * @param input.rubric
 * @param input.context
 * @param input.onProgress
 */
export async function redTeamDeckArtifact(input: { orgId: string; id: number; agentSlug?: string | null; rubric?: string | null; context?: string | null; onProgress?: (note: string) => void }): Promise<{ artifact: ArtifactRow; outcome: RedTeamOutcome; record: DocumentRedTeam | null }> {
  const { row, spec: prior } = await loadDeck(input.orgId, input.id);
  const bannedPhrases = (await voiceRulesFor(input.orgId).catch(() => null))?.never.map(r => (typeof r.pattern === 'string' ? r.pattern : r.pattern.source)) ?? [];
  const outcome = await redTeamDocument(input.orgId, { units: prepareSlidesText(prior), noun: 'slide', rubric: input.rubric ?? null, context: input.context ?? null, bannedPhrases, onProgress: input.onProgress });
  if (outcome.status !== 'reviewed') {
    return { artifact: row, outcome, record: null };
  }
  const record = redTeamRecord(outcome, row.currentVersion);
  const spec = deckSpec(prior, prior.verification, record);
  const { artifact } = await updateArtifact({
    orgId: input.orgId,
    id: input.id,
    title: null,
    spec,
    author: { kind: 'system', id: input.agentSlug ? `agent:${input.agentSlug}` : null },
    changeSummary: record.blocks > 0
      ? `Read as the buyer · ${record.blocks} blocking`
      : `Read as the buyer · ${record.findings.length === 0 ? 'no findings' : `${record.fixes} to fix · ${record.considers} to consider`}`,
    noCollapse: true,
  });
  return { artifact, outcome, record };
}

/**
 * Print the deck — one 1920×1080 page per slide, backgrounds on — and file it
 * beside the deck as a `file` artifact named from the title.
 * @param input - Which deck, who printed it.
 * @param input.orgId
 * @param input.id
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 * @param input.onProgress
 */
export async function exportDeckPdf(input: { orgId: string; id: number; author: Author; conversationId?: number | null; visibility?: 'user' | 'system'; onProgress?: (note: string) => void }): Promise<{ file: ArtifactRow; url: string; filename: string; pages: number | null; bytes: number }> {
  const { row, spec } = await loadDeck(input.orgId, input.id);
  const rendered = await renderDeck(spec, {
    loadAsset: deckAssetLoader(input.orgId, spec),
    screenshots: false,
    pdf: true,
    onProgress: (p) => {
      try {
        input.onProgress?.(deckRenderNote(p));
      } catch {
        // Best-effort.
      }
    },
  });
  if (!rendered.pdf) {
    throw new ArtifactError('INVALID_SPEC', 'the PDF could not be printed');
  }
  const filename = pdfFilename(spec.title || row.title);
  const { file, url, bytes } = await filePdf({ orgId: input.orgId, source: row, pdf: rendered.pdf, filename, author: input.author, conversationId: input.conversationId ?? null, visibility: input.visibility ?? 'user' });
  return { file, url, filename, pages: rendered.pdfPages, bytes };
}

/** An image to store as a deck asset: a URL to fetch, base64 bytes, or a data: URI. */
export type AssetSource = { url?: string; base64?: string; name?: string; contentType?: string };

/**
 * Store incoming images as deck assets — the bytes are fetched or decoded,
 * checked to be an image from the bytes themselves, and written to the file
 * store. A source that fails is named in `errors`; the rest still land.
 * @param orgId - The workspace.
 * @param sources - Asset id → where its bytes come from.
 * @param fetcher - How a URL is fetched (the guarded image fetch; injected for tests).
 */
export async function ingestDeckAssets(orgId: string, sources: Record<string, AssetSource>, fetcher: (url: string, opts: { maxFetchBytes?: number }) => Promise<{ bytes: Buffer }> = fetchImageBytes): Promise<{ assets: Record<string, DeckAsset>; errors: string[] }> {
  const assets: Record<string, DeckAsset> = {};
  const errors: string[] = [];
  for (const [id, src] of Object.entries(sources)) {
    try {
      let bytes: Buffer | null = null;
      const data = /^data:[^;,]+;base64,([\s\S]*)$/.exec(src.url ?? src.base64 ?? '');
      if (data) {
        bytes = NodeBuffer.from(data[1]!, 'base64');
      } else if (src.base64) {
        bytes = NodeBuffer.from(src.base64, 'base64');
      } else if (src.url && isExternalHttpUrl(src.url)) {
        // Public addresses only, on every redirect hop, body capped while read.
        bytes = (await fetcher(src.url, { maxFetchBytes: MAX_ASSET_BYTES })).bytes;
      } else if (src.url) {
        const stored = await readStoredFile(orgId, src.url);
        if (!stored) {
          throw new Error('the URL is neither an http(s) link nor a file of this workspace');
        }
        bytes = stored.body;
      }
      if (!bytes) {
        throw new Error('give a url or base64 bytes');
      }
      assets[id] = await storeImageAsset(orgId, bytes, src.name);
    } catch (err) {
      errors.push(`asset ${id}: ${(err as Error).message}`);
    }
  }
  return { assets, errors };
}

/**
 * The receipt a tool hands the model after a write: the outline, the audit
 * with the slide images, then what to do about it.
 * @param spec - The deck as stored.
 * @param outcome - Its verify.
 * @param opts - Whether to list the screenshots (default yes).
 * @param opts.images
 */
export function deckReceipt(spec: DeckSpec, outcome: DeckVerifyOutcome, opts: { images?: boolean } = {}): string {
  const lines = [deckOutline(spec), '', `Render-verify (${outcome.renderer}, ${Math.round(outcome.ms / 100) / 10}s): ${deckVerificationReceipt(outcome.verification, { images: opts.images ?? true })}`];
  if (!outcome.verification.ok && outcome.renderer === 'chromium') {
    lines.push('', 'Fix what is listed with edit_deck (replace_slide / replace_text / set_notes), then read the new receipt. Cut words on a crowded slide rather than shrinking them; one idea per slide. A deck is not done until this reads "no issues".');
  }
  return lines.join('\n');
}
