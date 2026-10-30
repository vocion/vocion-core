/**
 * The wiki's evidence graph (ADR 0012), as pure functions: what a page
 * claims and cites, what the sources say about each other, whether a claim's
 * evidence still holds, and how an agent walks it.
 *
 * No model call anywhere. The database side (`services/memory/
 * EvidenceGraphService.ts`) loads rows into these shapes and stores the
 * edges; the eval (`services/evals/wikiEvidence/`) builds the same graph from
 * made-up documents, so both read one implementation.
 *
 * Nodes are refs:
 *   `wiki:<slug>`          a wiki page
 *   `claim:<slug>#<n>`     the n-th cited sentence on a page (1-based)
 *   `doc:<id>`             a knowledge document
 *   `passage:<id>.<idx>`   one passage (`knowledge_chunk`) of a document
 */
import { createHash } from 'node:crypto';

/** The plugin that turns the graph on, with `wiki` under it. */
export const WIKI_EVIDENCE_PLUGIN = 'wiki-evidence';

export const EDGE_TYPES = ['cites', 'links_to', 'refers_to', 'supersedes', 'amends'] as const;
export type EdgeType = typeof EDGE_TYPES[number];

/** The name an edge reads by from its other end. Inverses are read, never stored. */
export const INVERSE: Record<EdgeType, string> = {
  cites: 'cited_by',
  links_to: 'linked_from',
  refers_to: 'referred_by',
  supersedes: 'superseded_by',
  amends: 'amended_by',
};

export type NodeKind = 'wiki' | 'claim' | 'doc' | 'passage';

/** One stored edge. `toHash`, `claim` and `excerpt` ride on `cites`. */
export type EvidenceEdge = {
  from: string;
  edge: EdgeType;
  to: string;
  /** The cited passage's hash when it was cited. */
  toHash?: string | null;
  /** The claim's sentence, without its tokens. */
  claim?: string | null;
  /** The cited passage's opening words when it was cited. */
  excerpt?: string | null;
  origin: 'wiki' | 'source';
};

/** A document as the graph needs it: its passages in order, or null when it is gone. */
export type SourceDoc = { id: number; title: string | null; uri: string | null; passages: string[] };

/** What a claim's evidence is now. */
export type Freshness = 'fresh' | 'changed' | 'superseded' | 'gone';

/* ------------------------------------------------------------------ */
/* Tokens, refs and hashes                                             */
/* ------------------------------------------------------------------ */

const CITE_RE = /\[src:(\d+)(?:\.(\d+))?\]/g;

/**
 * The token a page cites a passage (or a whole document) with.
 * @param docId - The knowledge document.
 * @param chunkIdx - The passage within it; omitted for the whole document.
 */
export function citeToken(docId: number, chunkIdx?: number | null): string {
  return chunkIdx === undefined || chunkIdx === null ? `[src:${docId}]` : `[src:${docId}.${chunkIdx}]`;
}

/**
 * Strip citation tokens from text a person or a model reads as prose.
 * @param text - Markdown with tokens.
 */
export function stripCiteTokens(text: string): string {
  return text.replace(CITE_RE, '').replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * The hash a passage is recognised by: its words, whitespace folded.
 * @param text - The passage.
 */
export function passageHash(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

/**
 * The kind of a node ref, or null when it is not one.
 * @param ref - e.g. `doc:12`.
 */
export function kindOf(ref: string): NodeKind | null {
  const m = /^(wiki|claim|doc|passage):\S+$/.exec(ref);
  return m ? m[1] as NodeKind : null;
}

/**
 * Normalise what a model passes as a node: `12`, `[src:12.3]`, `doc 12`, `claim:x#1`.
 * @param raw - What was passed.
 */
export function normaliseRef(raw: string): string {
  const s = raw.trim();
  const token = /^\[src:(\d+)(?:\.(\d+))?\]$/.exec(s);
  if (token) {
    return token[2] === undefined ? `doc:${token[1]}` : `passage:${token[1]}.${token[2]}`;
  }
  if (/^\d+\.\d+$/.test(s)) {
    return `passage:${s}`;
  }
  if (/^\d+$/.test(s)) {
    return `doc:${s}`;
  }
  const spaced = /^(wiki|claim|doc|passage)(?::\s*|\s+)(\S+)$/i.exec(s);
  return spaced ? `${spaced[1]!.toLowerCase()}:${spaced[2]}` : s;
}

/**
 * The document and passage a passage ref names.
 * @param ref - `passage:<id>.<idx>`.
 */
export function parsePassageRef(ref: string): { docId: number; chunkIdx: number } | null {
  const m = /^passage:(\d+)\.(\d+)$/.exec(ref);
  return m ? { docId: Number(m[1]), chunkIdx: Number(m[2]) } : null;
}

/* ------------------------------------------------------------------ */
/* What a wiki page claims                                             */
/* ------------------------------------------------------------------ */

export type WikiClaim = { ref: string; n: number; text: string; cites: Array<{ docId: number; chunkIdx: number | null }> };

/**
 * Split markdown into sentences and list items, keeping each with its tokens.
 * A token after the full stop belongs to the sentence before it.
 * @param md - The page body.
 */
function sentencesOf(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split('\n')) {
    const text = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/^#{1,6}\s+/, '').trim();
    if (!text) {
      continue;
    }
    // Break after ". " when what follows is not a token, so "…days. [src:1.2]" stays whole,
    // and again after the tokens that close a sentence ("…days. [src:1.2] Next…").
    const parts = text.split(/(?<=[.!?](?:\s*\[src:[^\]]+\])*)\s+(?!\[src:)/);
    out.push(...parts.map(p => p.trim()).filter(Boolean));
  }
  return out;
}

/**
 * The claims a page makes: every sentence or list item that carries a citation token.
 * @param slug - The page.
 * @param md - Its body.
 */
export function claimsOf(slug: string, md: string): WikiClaim[] {
  const claims: WikiClaim[] = [];
  for (const sentence of sentencesOf(md)) {
    const cites = [...sentence.matchAll(CITE_RE)].map(m => ({ docId: Number(m[1]), chunkIdx: m[2] === undefined ? null : Number(m[2]) }));
    if (cites.length === 0) {
      continue;
    }
    const n = claims.length + 1;
    claims.push({ ref: `claim:${slug}#${n}`, n, text: stripCiteTokens(sentence), cites });
  }
  return claims;
}

const WIKI_LINK_RE = /\]\((?:\/wiki\/)?([a-z][a-z0-9-]{0,79})\.md(?:#[^)]*)?\)/gi;

/**
 * The wiki pages a page links to, by the mount path an agent writes (`/wiki/<slug>.md`).
 * @param md - The page body.
 */
export function wikiLinksOf(md: string): string[] {
  return [...new Set([...md.matchAll(WIKI_LINK_RE)].map(m => m[1]!.toLowerCase()))];
}

/**
 * The edges a wiki page contributes, and the citations that point nowhere.
 * @param page - The page.
 * @param page.slug - Its slug.
 * @param page.md - Its body.
 * @param passage - The passage a citation names, as it reads now; null when there is none.
 */
export function wikiEdges(page: { slug: string; md: string }, passage: (docId: number, chunkIdx: number | null) => string | null): { edges: EvidenceEdge[]; claims: WikiClaim[]; dropped: string[] } {
  const edges: EvidenceEdge[] = [];
  const dropped: string[] = [];
  const claims = claimsOf(page.slug, page.md);
  for (const claim of claims) {
    for (const c of claim.cites) {
      const text = passage(c.docId, c.chunkIdx);
      if (text === null) {
        dropped.push(citeToken(c.docId, c.chunkIdx));
        continue;
      }
      edges.push({
        from: claim.ref,
        edge: 'cites',
        to: c.chunkIdx === null ? `doc:${c.docId}` : `passage:${c.docId}.${c.chunkIdx}`,
        toHash: passageHash(text),
        claim: claim.text,
        excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 240),
        origin: 'wiki',
      });
    }
  }
  for (const slug of wikiLinksOf(page.md)) {
    if (slug !== page.slug) {
      edges.push({ from: `wiki:${page.slug}`, edge: 'links_to', to: `wiki:${slug}`, origin: 'wiki' });
    }
  }
  return { edges, claims, dropped };
}

/* ------------------------------------------------------------------ */
/* What the sources say about each other                               */
/* ------------------------------------------------------------------ */

/**
 * A title as references write it: lower case, quotes and punctuation folded.
 * @param title - The title.
 */
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const SUPERSEDES_RE = /\b(?:supersedes|replaces|takes\s+the\s+place\s+of)\s+(?:the\s+)?(.{3,140})/gi;
const AMENDS_RE = /\b(?:amends|changes|updates|modifies)\s+(?:section\s+[\w.]+\s+of\s+)?(?:the\s+)?(.{3,140})/gi;
const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

/**
 * The longest known title that the text after a cue starts with.
 * @param after - The words after "supersedes", "see", …
 * @param titles - Normalised title to document id, longest first.
 */
function titleAt(after: string, titles: ReadonlyArray<[string, number]>): number | null {
  const s = normaliseTitle(after);
  for (const [t, id] of titles) {
    if (s === t || s.startsWith(`${t} `)) {
      return id;
    }
  }
  return null;
}

/** A title shorter than this, or of one word, is too common to count as a reference when merely mentioned. */
const MIN_MENTION_CHARS = 8;
/** The longest title, in words, a mention is looked for. */
const MAX_TITLE_WORDS = 14;

/**
 * Typed edges between documents, read from their own words: "supersedes /
 * replaces <title>" supersedes it; "amends / updates <title>" amends it; a
 * link to another document's address, or a mention of its exact title,
 * refers to it. Exact on a normalised title, so a paraphrase makes no edge
 * rather than a wrong one. Linear in the text: titles are looked up by word
 * n-grams, not searched for one by one.
 * @param docs - The documents to read.
 * @param catalog - Every document a reference may point at; defaults to `docs`.
 */
export function sourceEdges(docs: readonly SourceDoc[], catalog: ReadonlyArray<Pick<SourceDoc, 'id' | 'title' | 'uri'>> = docs): EvidenceEdge[] {
  const titles: Array<[string, number]> = catalog
    .filter(d => d.title && normaliseTitle(d.title).length >= 4)
    .map(d => [normaliseTitle(d.title!), d.id] as [string, number])
    .sort((a, b) => b[0].length - a[0].length);
  const mentionable = new Map(titles.filter(([t]) => t.length >= MIN_MENTION_CHARS && t.includes(' ')));
  const byUri = new Map(catalog.filter(d => d.uri).map(d => [d.uri!.replace(/[/#?]+$/, ''), d.id]));
  const seen = new Set<string>();
  const out: EvidenceEdge[] = [];
  const add = (from: number, edge: EdgeType, to: number | null | undefined) => {
    if (to === null || to === undefined || to === from) {
      return;
    }
    const key = `${from}|${edge}|${to}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ from: `doc:${from}`, edge, to: `doc:${to}`, origin: 'source' });
    }
  };
  for (const doc of docs) {
    const text = doc.passages.join('\n');
    for (const m of text.matchAll(SUPERSEDES_RE)) {
      add(doc.id, 'supersedes', titleAt(m[1]!, titles));
    }
    for (const m of text.matchAll(AMENDS_RE)) {
      add(doc.id, 'amends', titleAt(m[1]!, titles));
    }
    const typed = new Set(out.filter(e => e.from === `doc:${doc.id}`).map(e => e.to));
    const mention = (to: number | undefined) => {
      if (to !== undefined && !typed.has(`doc:${to}`)) {
        add(doc.id, 'refers_to', to);
      }
    };
    for (const m of text.matchAll(URL_RE)) {
      mention(byUri.get(m[0].replace(/[/#?.,;:]+$/, '')));
    }
    const words = normaliseTitle(text).split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      let gram = '';
      for (let n = 0; n < MAX_TITLE_WORDS && i + n < words.length; n++) {
        gram = n === 0 ? words[i]! : `${gram} ${words[i + n]}`;
        const id = mentionable.get(gram);
        if (id !== undefined) {
          mention(id);
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Whether a claim's evidence still holds                              */
/* ------------------------------------------------------------------ */

/**
 * What a cited passage is now, read by hash: unchanged at its place, moved
 * within its document (still fresh), changed, or gone with its document.
 * Supersession is the graph's to add (`EvidenceGraph.freshness`).
 * @param edge - A `cites` edge.
 * @param passages - The cited document's passages now, or null when the document is gone.
 */
export function passageFreshness(edge: Pick<EvidenceEdge, 'to' | 'toHash'>, passages: readonly string[] | null): 'fresh' | 'changed' | 'gone' {
  if (passages === null) {
    return 'gone';
  }
  if (!edge.toHash) {
    return 'fresh';
  }
  const at = parsePassageRef(edge.to);
  if (at && passages[at.chunkIdx] !== undefined && passageHash(passages[at.chunkIdx]!) === edge.toHash) {
    return 'fresh';
  }
  if (!at && passageHash(passages.join('\n')) === edge.toHash) {
    return 'fresh';
  }
  return passages.some(p => passageHash(p) === edge.toHash) ? 'fresh' : 'changed';
}

/* ------------------------------------------------------------------ */
/* The graph an agent walks                                            */
/* ------------------------------------------------------------------ */

export type GraphPage = { slug: string; title: string; summary?: string | null };
export type GraphDoc = { id: number; title: string | null; uri: string | null };

/** Where the graph reads documents' passages from: memory in the eval, the database live. */
export type PassageLoader = (docId: number) => Promise<string[] | null>;

export type LocateHit = { ref: string; kind: NodeKind; label: string; score: number };

export type ExpandedEdge = {
  edge: string;
  ref: string;
  label: string;
  /** For a claim, whether its evidence holds; for a cited passage, the same seen from the passage. */
  freshness?: Freshness;
  /** The newer document, when the cited one was replaced. */
  supersededBy?: string | null;
  /** Documents that amend the cited one: the claim may hold only in part. */
  amendedBy?: string[];
  text?: string | null;
};

export type Expanded = {
  ref: string;
  kind: NodeKind;
  label: string;
  text?: string | null;
  edges: ExpandedEdge[];
  /** The path a multi-hop walk took, when it took one. */
  walked?: string[];
  /** Where the walk stopped and why. */
  stoppedAt?: string | null;
};

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'what', 'which', 'who', 'how', 'do', 'does', 'did', 'we', 'our', 'us', 'it', 'its', 'this', 'that', 'with', 'by', 'at', 'from', 'be', 'now', 'current', 'currently']);

/**
 * The words a query or a label is matched on.
 * @param text - Any text.
 */
export function termsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9$%]+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem))];
}

/**
 * Fold the plural, so "passwords" finds "password" and "rates" finds "rate".
 * @param word - A lower-case word.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * How many of the query's words a text holds, title words counting double.
 * @param query
 * @param label
 * @param body
 */
function overlap(query: readonly string[], label: string, body = ''): number {
  if (query.length === 0) {
    return 0;
  }
  const l = new Set(termsOf(label));
  const b = new Set(termsOf(body));
  let s = 0;
  for (const q of query) {
    s += l.has(q) ? 2 : b.has(q) ? 1 : 0;
  }
  return s / (2 * query.length);
}

/** How much of a document an expansion shows, in characters. */
const DOC_TEXT_CHARS = 2400;

/** Up to this many edges of one node are listed; the rest are counted. */
const MAX_EDGES_SHOWN = 24;

export class EvidenceGraph {
  private readonly out = new Map<string, EvidenceEdge[]>();
  private readonly in = new Map<string, EvidenceEdge[]>();
  private readonly pages: Map<string, GraphPage>;
  private readonly docs: Map<number, GraphDoc>;
  private readonly claims = new Map<string, string>();
  private readonly passageCache = new Map<number, Promise<string[] | null>>();

  constructor(input: { edges: readonly EvidenceEdge[]; pages: readonly GraphPage[]; docs: readonly GraphDoc[]; passages: PassageLoader }) {
    this.pages = new Map(input.pages.map(p => [p.slug, p]));
    this.docs = new Map(input.docs.map(d => [d.id, d]));
    this.load = input.passages;
    for (const e of input.edges) {
      this.out.set(e.from, [...(this.out.get(e.from) ?? []), e]);
      this.in.set(e.to, [...(this.in.get(e.to) ?? []), e]);
      if (e.edge === 'cites' && e.claim) {
        this.claims.set(e.from, e.claim);
      }
    }
  }

  private readonly load: PassageLoader;

  /**
   * A claim's `cites` edges.
   * @param claimRef - `claim:<slug>#<n>`.
   */
  citesOf(claimRef: string): EvidenceEdge[] {
    return (this.out.get(claimRef) ?? []).filter(e => e.edge === 'cites');
  }

  /** Every edge in the graph, as stored. */
  allEdges(): EvidenceEdge[] {
    return [...this.out.values()].flat();
  }

  /**
   * A document's passages now, read once per graph.
   * @param docId - The document.
   */
  passagesOf(docId: number): Promise<string[] | null> {
    let p = this.passageCache.get(docId);
    if (!p) {
      p = this.load(docId);
      this.passageCache.set(docId, p);
    }
    return p;
  }

  /**
   * The newest document that replaces this one, following `supersedes` back; null when none does.
   * @param docRef - `doc:<id>`.
   */
  newestReplacement(docRef: string): string | null {
    let at = docRef;
    const seen = new Set([at]);
    for (;;) {
      const by = (this.in.get(at) ?? []).find(e => e.edge === 'supersedes');
      if (!by || seen.has(by.from)) {
        break;
      }
      seen.add(by.from);
      at = by.from;
    }
    return at === docRef ? null : at;
  }

  /**
   * The documents that amend this one or the document that replaced it.
   * @param docRef - `doc:<id>`.
   */
  amendmentsOf(docRef: string): string[] {
    const at = this.newestReplacement(docRef) ?? docRef;
    return [...new Set([docRef, at].flatMap(ref => (this.in.get(ref) ?? []).filter(e => e.edge === 'amends').map(e => e.from)))];
  }

  /**
   * Whether a `cites` edge's evidence holds now.
   * @param edge - The edge.
   */
  async citeFreshness(edge: EvidenceEdge): Promise<{ freshness: Freshness; supersededBy: string | null }> {
    const docId = Number((parsePassageRef(edge.to)?.docId) ?? edge.to.replace(/^doc:/, ''));
    const passages = await this.passagesOf(docId);
    const base = passageFreshness(edge, passages);
    if (base !== 'fresh') {
      return { freshness: base, supersededBy: null };
    }
    const newer = this.newestReplacement(`doc:${docId}`);
    return newer ? { freshness: 'superseded', supersededBy: newer } : { freshness: 'fresh', supersededBy: null };
  }

  /**
   * A claim's freshness: the worst of its citations (gone, changed, superseded, fresh).
   * @param claimRef - `claim:<slug>#<n>`.
   */
  async claimFreshness(claimRef: string): Promise<{ freshness: Freshness; supersededBy: string | null }> {
    const order: Freshness[] = ['gone', 'changed', 'superseded', 'fresh'];
    let worst: { freshness: Freshness; supersededBy: string | null } = { freshness: 'fresh', supersededBy: null };
    for (const e of (this.out.get(claimRef) ?? []).filter(x => x.edge === 'cites')) {
      const f = await this.citeFreshness(e);
      if (order.indexOf(f.freshness) < order.indexOf(worst.freshness)) {
        worst = f;
      }
    }
    return worst;
  }

  /** Every claim with its page, words and freshness, in page order. */
  async claimStatuses(): Promise<Array<{ ref: string; slug: string; n: number; text: string; freshness: Freshness; supersededBy: string | null; cites: string[]; amendedBy: string[] }>> {
    const out = [];
    for (const [ref, text] of this.claims) {
      const m = /^claim:(.+)#(\d+)$/.exec(ref)!;
      const f = await this.claimFreshness(ref);
      const cites = (this.out.get(ref) ?? []).filter(e => e.edge === 'cites').map(e => e.to);
      const amendedBy = [...new Set(cites.flatMap((to) => {
        const id = parsePassageRef(to)?.docId ?? Number(to.replace(/^doc:/, ''));
        return this.amendmentsOf(`doc:${id}`);
      }))];
      out.push({ ref, slug: m[1]!, n: Number(m[2]), text, ...f, cites, amendedBy });
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug) || a.n - b.n);
  }

  /**
   * A node's human label.
   * @param ref - The node.
   */
  labelOf(ref: string): string {
    const kind = kindOf(ref);
    if (kind === 'wiki') {
      return this.pages.get(ref.slice(5))?.title ?? ref.slice(5);
    }
    if (kind === 'claim') {
      return this.claims.get(ref) ?? ref;
    }
    if (kind === 'doc') {
      return this.docs.get(Number(ref.slice(4)))?.title ?? ref;
    }
    const at = parsePassageRef(ref);
    if (at) {
      const title = this.docs.get(at.docId)?.title ?? `doc ${at.docId}`;
      return `${title}, passage ${at.chunkIdx}`;
    }
    return ref;
  }

  /**
   * Where to start: wiki pages, claims and documents whose words match the question's.
   * @param terms - The question, or its key words.
   * @param opts - `within`: a page slug or doc ref to stay inside; `limit`: how many.
   * @param opts.within - A page slug or doc ref to stay inside.
   * @param opts.limit - How many hits.
   */
  locate(terms: string, opts: { within?: string | null; limit?: number } = {}): LocateHit[] {
    const q = termsOf(terms);
    const hits: LocateHit[] = [];
    const within = opts.within ? normaliseRef(opts.within) : null;
    const inScope = (ref: string) => {
      if (!within) {
        return true;
      }
      if (within.startsWith('wiki:')) {
        return ref === within || ref.startsWith(`claim:${within.slice(5)}#`);
      }
      return ref === within;
    };
    for (const p of this.pages.values()) {
      const ref = `wiki:${p.slug}`;
      if (inScope(ref)) {
        hits.push({ ref, kind: 'wiki', label: p.title, score: overlap(q, p.title, p.summary ?? '') });
      }
    }
    for (const [ref, text] of this.claims) {
      if (inScope(ref)) {
        hits.push({ ref, kind: 'claim', label: text, score: overlap(q, '', text) });
      }
    }
    for (const d of this.docs.values()) {
      const ref = `doc:${d.id}`;
      if (inScope(ref)) {
        hits.push({ ref, kind: 'doc', label: d.title ?? ref, score: overlap(q, d.title ?? '') });
      }
    }
    return hits.filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
  }

  /**
   * One node's own text: a claim's sentence, a passage's words.
   * @param ref
   */
  private async textOf(ref: string): Promise<string | null> {
    const kind = kindOf(ref);
    if (kind === 'claim') {
      return this.claims.get(ref) ?? null;
    }
    if (kind === 'passage') {
      const at = parsePassageRef(ref)!;
      const passages = await this.passagesOf(at.docId);
      return passages?.[at.chunkIdx] ?? null;
    }
    if (kind === 'wiki') {
      return this.pages.get(ref.slice(5))?.summary ?? null;
    }
    if (kind === 'doc') {
      const id = Number(ref.slice(4));
      const passages = await this.passagesOf(id);
      if (!passages) {
        return '(this document is gone from the sources)';
      }
      const lines = passages.map((p, i) => `${citeToken(id, i)} ${p.replace(/\s+/g, ' ').trim()}`);
      const text = lines.join('\n');
      return text.length > DOC_TEXT_CHARS ? `${text.slice(0, DOC_TEXT_CHARS)}… (${passages.length} passages; open one with expand_evidence passage:${id}.<n>)` : text;
    }
    return null;
  }

  /**
   * The edges of one node, both directions, with freshness on citations.
   * @param ref
   * @param only
   */
  private async edgesOf(ref: string, only: ReadonlySet<string> | null): Promise<ExpandedEdge[]> {
    const out: ExpandedEdge[] = [];
    const kind = kindOf(ref);
    for (const e of this.out.get(ref) ?? []) {
      if (only && !only.has(e.edge)) {
        continue;
      }
      const row: ExpandedEdge = { edge: e.edge, ref: e.to, label: this.labelOf(e.to) };
      if (e.edge === 'cites') {
        const f = await this.citeFreshness(e);
        row.freshness = f.freshness;
        row.supersededBy = f.supersededBy;
        const cited = parsePassageRef(e.to)?.docId ?? Number(e.to.replace(/^doc:/, ''));
        const amended = this.amendmentsOf(`doc:${cited}`);
        if (amended.length > 0) {
          row.amendedBy = amended;
        }
        row.text = f.freshness === 'changed' ? `was: ${e.excerpt ?? ''}\n    now: ${(await this.textOf(e.to)) ?? '(no passage at that place)'}` : await this.textOf(e.to);
      }
      out.push(row);
    }
    for (const e of this.in.get(ref) ?? []) {
      const name = INVERSE[e.edge];
      if (only && !only.has(name) && !only.has(e.edge)) {
        continue;
      }
      const row: ExpandedEdge = { edge: name, ref: e.from, label: this.labelOf(e.from) };
      if (e.edge === 'cites') {
        row.freshness = (await this.citeFreshness(e)).freshness;
      }
      out.push(row);
    }
    // A wiki page reaches its claims, and a document its cited passages, through their refs.
    if (kind === 'wiki' && (!only || only.has('claims'))) {
      const slug = ref.slice(5);
      for (const c of this.claims.keys()) {
        if (c.startsWith(`claim:${slug}#`)) {
          const f = await this.claimFreshness(c);
          out.push({ edge: 'claims', ref: c, label: this.claims.get(c)!, freshness: f.freshness, supersededBy: f.supersededBy });
        }
      }
    }
    if (kind === 'doc' && (!only || only.has('passages'))) {
      const id = ref.slice(4);
      const cited = new Set([...this.in.keys()].filter(k => k.startsWith(`passage:${id}.`)));
      for (const p of cited) {
        out.push({ edge: 'passages', ref: p, label: this.labelOf(p) });
      }
    }
    return out;
  }

  /**
   * Open a node and list its typed edges, both ways. With `hops` above 1 and
   * one edge type, walk that edge while there is a single path and stop at a
   * branch, e.g. `supersedes` back to the current version of a document.
   * @param rawRef - The node, as the model wrote it.
   * @param opts - `edges`: only these types (or their inverses); `hops`: how far to walk.
   * @param opts.edges - Only these edge types, or their inverses.
   * @param opts.hops - How far to walk a single path.
   */
  async expand(rawRef: string, opts: { edges?: readonly string[] | null; hops?: number } = {}): Promise<Expanded | null> {
    let ref = normaliseRef(rawRef);
    const kind = kindOf(ref);
    if (!kind || !this.known(ref)) {
      return null;
    }
    const only = opts.edges?.length ? new Set(opts.edges) : null;
    const hops = Math.max(1, Math.min(opts.hops ?? 1, 6));
    const walked = [ref];
    let stoppedAt: string | null = null;
    if (hops > 1 && only && only.size === 1) {
      for (let i = 1; i < hops; i++) {
        const next = (await this.edgesOf(ref, only)).filter(e => !walked.includes(e.ref));
        if (next.length !== 1) {
          stoppedAt = next.length === 0 ? 'end of the path' : `a branch of ${next.length}`;
          break;
        }
        ref = next[0]!.ref;
        walked.push(ref);
      }
    }
    // At the end of a walk, the node is shown whole: where the walk led is what was asked for.
    const edges = await this.edgesOf(ref, walked.length > 1 ? null : only);
    return {
      ref,
      kind: kindOf(ref)!,
      label: this.labelOf(ref),
      text: await this.textOf(ref),
      edges: edges.slice(0, MAX_EDGES_SHOWN),
      ...(walked.length > 1 ? { walked, stoppedAt } : {}),
    };
  }

  /**
   * Whether the graph knows a node.
   * @param ref - The node.
   */
  known(ref: string): boolean {
    const kind = kindOf(ref);
    if (kind === 'wiki') {
      return this.pages.has(ref.slice(5));
    }
    if (kind === 'claim') {
      return this.claims.has(ref);
    }
    if (kind === 'doc') {
      return this.docs.has(Number(ref.slice(4)));
    }
    const at = parsePassageRef(ref);
    return Boolean(at && this.docs.has(at.docId));
  }
}

/* ------------------------------------------------------------------ */
/* What the agent reads                                                */
/* ------------------------------------------------------------------ */

const FRESHNESS_WORDS: Record<Freshness, string> = {
  fresh: 'holds',
  changed: 'SOURCE CHANGED since this was written',
  superseded: 'SOURCE REPLACED by a newer document',
  gone: 'SOURCE GONE',
};

/**
 * One expanded node as the agent reads it.
 * @param x - The expansion.
 * @param graph - For labels.
 */
export function renderExpanded(x: Expanded, graph: EvidenceGraph): string {
  const lines = [`${x.ref} · ${x.label}`];
  if (x.walked) {
    lines.push(`walked: ${x.walked.join(' → ')}${x.stoppedAt ? ` (stopped: ${x.stoppedAt})` : ''}`);
  }
  if (x.text && x.kind === 'doc') {
    lines.push(x.text);
  } else if (x.text && x.kind !== 'claim') {
    lines.push(`text: ${x.text.replace(/\s+/g, ' ').slice(0, 900)}`);
  }
  if (x.edges.length === 0) {
    lines.push('no edges');
  }
  for (const e of x.edges) {
    const f = (e.freshness && e.freshness !== 'fresh' ? ` [${FRESHNESS_WORDS[e.freshness]}${e.supersededBy ? `: ${e.supersededBy} ${graph.labelOf(e.supersededBy)}` : ''}]` : '')
      + (e.amendedBy?.length ? ` [AMENDED by ${e.amendedBy.map(a => `${a} ${graph.labelOf(a)}`).join('; ')}: read it before answering]` : '');
    const cite = e.ref.startsWith('passage:') ? ` cite ${citeToken(parsePassageRef(e.ref)!.docId, parsePassageRef(e.ref)!.chunkIdx)}` : e.ref.startsWith('doc:') ? ` cite ${citeToken(Number(e.ref.slice(4)))}` : '';
    const text = e.text ? `\n    ${e.text.split('\n').map(l => l.replace(/\s+/g, ' ').trim().slice(0, 600)).join('\n    ')}` : '';
    lines.push(`- ${e.edge} → ${e.ref} · ${e.label.replace(/\s+/g, ' ').slice(0, 160)}${cite}${f}${text}`);
  }
  return lines.join('\n');
}

/**
 * The claims on a page that need a check, as a note under the page an agent reads. Empty when every claim holds.
 * @param statuses - `claimStatuses()` for the page.
 * @param graph - For labels.
 */
export function renderClaimChecks(statuses: ReadonlyArray<{ ref: string; text: string; freshness: Freshness; supersededBy: string | null; amendedBy?: readonly string[] }>, graph: EvidenceGraph): string {
  const bad = statuses.filter(s => s.freshness !== 'fresh');
  const amended = statuses.filter(s => s.freshness === 'fresh' && (s.amendedBy?.length ?? 0) > 0);
  const amendNote = (s: { amendedBy?: readonly string[] }) => (s.amendedBy?.length ? `; its source is AMENDED by ${s.amendedBy.map(a => `${a} ${graph.labelOf(a)}`).join('; ')}` : '');
  if (bad.length === 0 && amended.length === 0) {
    return statuses.length ? `Evidence: all ${statuses.length} cited claims hold.` : '';
  }
  const lines = [];
  if (bad.length > 0) {
    lines.push(`Evidence: ${bad.length} of ${statuses.length} cited claims need a check. Do not repeat them as current without checking (expand_evidence on the claim):`);
    lines.push(...bad.map(s => `- ${s.ref} "${s.text.slice(0, 160)}" — ${FRESHNESS_WORDS[s.freshness]}${s.supersededBy ? `: ${s.supersededBy} ${graph.labelOf(s.supersededBy)}` : ''}${amendNote(s)}`));
  }
  if (amended.length > 0) {
    lines.push(`Evidence: ${amended.length} cited ${amended.length === 1 ? 'claim holds' : 'claims hold'} but ${amended.length === 1 ? 'its source has' : 'their sources have'} an amendment that may qualify ${amended.length === 1 ? 'it' : 'them'}:`);
    lines.push(...amended.map(s => `- ${s.ref} "${s.text.slice(0, 160)}"${amendNote(s)}`));
  }
  return lines.join('\n');
}

/**
 * The line a search hit carries when the evidence graph is on, so a page can cite exactly that passage.
 * @param docId - The hit's document.
 * @param chunkIdx - The hit's passage.
 */
export function citeLine(docId: number, chunkIdx: number | null | undefined): string {
  return `   cite: ${citeToken(docId, chunkIdx)}`;
}

/**
 * The note under one wiki page that says which of its claims need a check.
 * @param graph - The graph.
 * @param slug - The page.
 */
export async function pageChecks(graph: EvidenceGraph, slug: string): Promise<string> {
  const statuses = (await graph.claimStatuses()).filter(s => s.slug === slug);
  return renderClaimChecks(statuses, graph);
}

/**
 * The documents a graph is about: the ones some edge touches. The rest of
 * the library is search's, not the graph's.
 * @param edges - The graph's edges.
 */
export function docIdsIn(edges: readonly EvidenceEdge[]): number[] {
  const ids = new Set<number>();
  for (const e of edges) {
    for (const ref of [e.from, e.to]) {
      const doc = /^doc:(\d+)$/.exec(ref);
      const passage = parsePassageRef(ref);
      if (doc) {
        ids.add(Number(doc[1]));
      } else if (passage) {
        ids.add(passage.docId);
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** The prompt line that tells an agent the evidence graph is there and how to use it. */
export const EVIDENCE_PROMPT_LINE = 'EVIDENCE: wiki claims cite their sources with [src:<doc>.<passage>] tokens, and the workspace keeps a graph of them. read_wiki_page lists any claim whose source has since CHANGED, been REPLACED by a newer document, or GONE: never state such a claim as current; check it with expand_evidence and answer from the current source. For a question that crosses documents or asks what is current, locate_evidence finds where to start and expand_evidence follows typed edges (supersedes, amends, refers_to, cites, and their inverses). Cite what you use with its [src:…] token. When you write a wiki page, end each claim with the [src:…] token of the passage it rests on (search_knowledge shows it), and when a page you read has claims that need a check, offer the revision from the current source.';

/* ------------------------------------------------------------------ */
/* What a person reads (the Wiki evidence page)                        */
/* ------------------------------------------------------------------ */

export type OverviewDoc = { id: number; title: string; uri: string | null };

export type EvidenceOverview = {
  totals: { pages: number; claims: number; holding: number; needCheck: number; sourcesCited: number; sourceLinks: number };
  pages: Array<{ slug: string; title: string; claims: number; holding: number; needCheck: number }>;
  checks: Array<{ ref: string; slug: string; pageTitle: string; text: string; freshness: Exclude<Freshness, 'fresh'>; was: string | null; now: string | null; source: OverviewDoc | null; newer: OverviewDoc | null }>;
  replaced: Array<{ edge: 'supersedes' | 'amends'; newer: OverviewDoc; older: OverviewDoc }>;
};

/**
 * Everything the Wiki evidence page shows, read from a graph.
 * @param graph - The graph.
 * @param pages - The wiki's pages, for titles and for pages with no claims.
 * @param docs - The documents in the graph, for titles and links.
 */
export async function overviewOf(graph: EvidenceGraph, pages: readonly GraphPage[], docs: readonly GraphDoc[]): Promise<EvidenceOverview> {
  const docById = new Map(docs.map(d => [d.id, { id: d.id, title: d.title ?? `Document ${d.id}`, uri: d.uri }]));
  const docOf = (ref: string | null): OverviewDoc | null => {
    if (!ref) {
      return null;
    }
    const id = /^doc:\d+$/.test(ref) ? Number(ref.slice(4)) : parsePassageRef(ref)?.docId;
    return id === undefined ? null : docById.get(id) ?? { id, title: `Document ${id} (removed)`, uri: null };
  };
  const statuses = await graph.claimStatuses();
  const titleOf = new Map(pages.map(p => [p.slug, p.title]));
  const checks: EvidenceOverview['checks'] = [];
  for (const s of statuses) {
    if (s.freshness === 'fresh') {
      continue;
    }
    const cite = graph.citesOf(s.ref)[0] ?? null;
    let now: string | null = null;
    if (cite && s.freshness === 'changed') {
      const at = parsePassageRef(cite.to);
      const passages = at ? await graph.passagesOf(at.docId) : null;
      now = at && passages ? passages[at.chunkIdx] ?? null : null;
    }
    checks.push({
      ref: s.ref,
      slug: s.slug,
      pageTitle: titleOf.get(s.slug) ?? s.slug,
      text: s.text,
      freshness: s.freshness,
      was: cite?.excerpt ?? null,
      now,
      source: docOf(cite?.to ?? null),
      newer: docOf(s.supersededBy),
    });
  }
  const order: Freshness[] = ['gone', 'changed', 'superseded'];
  checks.sort((a, b) => order.indexOf(a.freshness) - order.indexOf(b.freshness) || a.slug.localeCompare(b.slug));
  const sourceEdgesNow = graph.allEdges().filter(e => e.origin === 'source');
  const replaced = sourceEdgesNow
    .filter((e): e is EvidenceEdge & { edge: 'supersedes' | 'amends' } => e.edge === 'supersedes' || e.edge === 'amends')
    .map(e => ({ edge: e.edge, newer: docOf(e.from)!, older: docOf(e.to)! }))
    .filter(r => r.newer && r.older);
  const cited = new Set(statuses.flatMap(s => s.cites.map(c => docOf(c)?.id)).filter((x): x is number => x !== undefined));
  const perPage = pages.map((p) => {
    const mine = statuses.filter(s => s.slug === p.slug);
    const holding = mine.filter(s => s.freshness === 'fresh').length;
    return { slug: p.slug, title: p.title, claims: mine.length, holding, needCheck: mine.length - holding };
  }).sort((a, b) => b.needCheck - a.needCheck || b.claims - a.claims || a.title.localeCompare(b.title));
  const holding = statuses.filter(s => s.freshness === 'fresh').length;
  return {
    totals: { pages: pages.length, claims: statuses.length, holding, needCheck: statuses.length - holding, sourcesCited: cited.size, sourceLinks: sourceEdgesNow.length },
    pages: perPage,
    checks,
    replaced,
  };
}
