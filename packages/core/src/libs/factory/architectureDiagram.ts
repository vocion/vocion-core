/**
 * THE ARCHITECTURE DIAGRAM, DRAWN BY THE PLATFORM FROM A TYPED GRAPH.
 *
 * After the Release seat has read a product's repositories, it hands over
 * the system as DATA — components, the edges between them, optional groups —
 * and code lays it out and draws it. The agent never draws: a model asked
 * for a picture produces a different picture each time, invents boxes the
 * tree does not contain, and writes text nothing in the app can render
 * (there is no Mermaid here; the page shows markdown and images). A drawing
 * derived from a typed graph cannot say anything the graph does not, and the
 * same graph draws the same bytes, so the store content-addresses it and a
 * remap that changed nothing files no new version.
 *
 * Same reasoning, same palette, as `proposalVisual.ts`: SVG in code,
 * deterministic, monochrome with one accent.
 *
 * WHAT IT DRAWS. A layered graph, left to right: sources (what people touch)
 * on the left, what they call to the right, what stores the data further
 * right. Layers are longest-path over the edge DAG, with cycles broken
 * deterministically so a graph that loops still draws. Within a layer, a
 * barycenter pass puts a node near what it is wired to, then the label
 * settles ties. Each kind has its own shape or glyph (a database is a
 * cylinder, a queue is rounded, an external system is dashed), the kind is
 * also printed, and the repository a node lives in is printed under it.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* The graph                                                           */
/* ------------------------------------------------------------------ */

export const NODE_KINDS = ['service', 'web', 'mobile', 'api', 'worker', 'database', 'queue', 'storage', 'external', 'package', 'infra'] as const;
export type NodeKind = typeof NODE_KINDS[number];

export const EDGE_KINDS = ['calls', 'reads', 'writes', 'publishes', 'deploys', 'depends'] as const;
export type EdgeKind = typeof EDGE_KINDS[number];

/** The product field `draw_architecture` writes and the product page reads. */
export const ARCHITECTURE_FIELD = 'architecture';

export const MAX_NODES = 24;
export const MAX_EDGES = 48;

export type ArchitectureNode = {
  id: string;
  label: string;
  kind: NodeKind;
  /** The `owner/name` repository this component lives in. */
  repo?: string;
  note?: string;
};

export type ArchitectureEdge = {
  from: string;
  to: string;
  label?: string;
  kind?: EdgeKind;
};

export type ArchitectureGroup = {
  id: string;
  label: string;
  nodes: string[];
};

export type ArchitectureGraph = {
  title: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  groups?: ArchitectureGroup[];
};

const idSchema = z.string().trim().min(1).max(60);

const nodeSchema = z.object({
  id: idSchema.describe('A short stable id, unique in the graph ("web", "api", "pg").'),
  label: z.string().trim().min(1).max(80).describe('What a person calls it ("Web app", "Orders API").'),
  kind: z.enum(NODE_KINDS).describe('What it is. Decides its shape.'),
  repo: z.string().trim().min(1).max(140).optional().describe('The repository it lives in, as owner/name. Omit for a managed service or an external system.'),
  note: z.string().trim().max(200).optional().describe('One line of what it does, for the summary table.'),
});

const edgeSchema = z.object({
  from: idSchema,
  to: idSchema,
  label: z.string().trim().max(40).optional().describe('Printed on the edge: "REST", "SQL", "events".'),
  kind: z.enum(EDGE_KINDS).optional(),
});

const groupSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(60),
  nodes: z.array(idSchema).min(1).max(MAX_NODES),
});

/**
 * The graph's shape alone — what a tool's JSON schema shows the model. The
 * cross-references are checked by {@link ArchitectureGraphSchema}, which a
 * handler runs so the refusal comes back as words rather than a thrown
 * schema error.
 */
export const ArchitectureGraphShape = z.object({
  title: z.string().trim().min(1).max(100).describe('The diagram\'s heading, usually the product name.'),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES, `at most ${MAX_NODES} nodes: fold the small ones into the component that owns them`),
  edges: z.array(edgeSchema).max(MAX_EDGES, `at most ${MAX_EDGES} edges: keep the ones a reader needs to follow the data`),
  groups: z.array(groupSchema).max(8).optional(),
});

/**
 * The graph as the model hands it over, with the mistakes a model makes
 * refused in words it can act on: an edge to a node it never declared, two
 * nodes with one id, more boxes than a page can read.
 */
export const ArchitectureGraphSchema = ArchitectureGraphShape.superRefine((graph, ctx) => {
  const ids = new Set<string>();
  graph.nodes.forEach((n, i) => {
    if (ids.has(n.id)) {
      ctx.addIssue({ code: 'custom', path: ['nodes', i, 'id'], message: `node id "${n.id}" is used twice; ids must be unique` });
    }
    ids.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!ids.has(e[end])) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, end], message: `edge ${end} "${e[end]}" names no node; declare it in nodes or drop the edge` });
      }
    }
    if (e.from === e.to) {
      ctx.addIssue({ code: 'custom', path: ['edges', i], message: `edge from "${e.from}" to itself says nothing; drop it` });
    }
  });
  const groupIds = new Set<string>();
  (graph.groups ?? []).forEach((g, i) => {
    if (groupIds.has(g.id)) {
      ctx.addIssue({ code: 'custom', path: ['groups', i, 'id'], message: `group id "${g.id}" is used twice` });
    }
    groupIds.add(g.id);
    g.nodes.forEach((id, j) => {
      if (!ids.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['groups', i, 'nodes', j], message: `group "${g.id}" names node "${id}", which is not in nodes` });
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** The panel, in the palette the proposal visual uses. */
const INK = '#3A362F';
const INK_SOFT = '#6B655C';
const LINE = '#E4E0DA';
const MUTED = '#CFC9C0';
const PAPER = '#FFFFFF';
const CHROME = '#FAF8F5';
const FILL = '#F1EDE7';
const ACCENT = '#D97706';

// Single quotes inside: every attribute is written double-quoted.
const FONT = 'ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const NODE_W = 172;
const NODE_H = 68;
/** Horizontal room between layers, where the edges and their labels live. */
const LAYER_GAP = 96;
/** Vertical room between nodes in one layer. */
const NODE_GAP = 28;
const MARGIN = 32;
const TITLE_H = 44;
const LEGEND_H = 28;
/** Breathing room a group rectangle keeps around its nodes. */
const GROUP_PAD = 14;
const GROUP_LABEL_H = 18;

type Placed = ArchitectureNode & { layer: number; order: number; x: number; y: number };

/**
 * Longest-path layering over the edges, read as a DAG. Cycles are broken
 * the same way every time — depth-first in node order, an edge that closes
 * a loop is ignored for layering — so a graph with a loop in it still draws,
 * and draws the same.
 * @param graph - A validated graph.
 * @returns Each node's layer, and the edges that were ignored to get there.
 */
export function layerNodes(graph: ArchitectureGraph): { layer: Map<string, number>; backEdges: Set<number> } {
  const ids = graph.nodes.map(n => n.id);
  const out = new Map<string, number[]>(ids.map(id => [id, []]));
  graph.edges.forEach((e, i) => {
    if (out.has(e.from) && out.has(e.to) && e.from !== e.to) {
      out.get(e.from)!.push(i);
    }
  });

  // DFS with colours: an edge into a grey node closes a cycle.
  const state = new Map<string, 0 | 1 | 2>();
  const backEdges = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id)!) {
      const to = graph.edges[i]!.to;
      const s = state.get(to) ?? 0;
      if (s === 1) {
        backEdges.add(i);
      } else if (s === 0) {
        visit(to);
      }
    }
    state.set(id, 2);
  };
  for (const id of ids) {
    if ((state.get(id) ?? 0) === 0) {
      visit(id);
    }
  }

  // Longest path from any source, over the forward edges only.
  const forward = graph.edges.map((e, i) => ({ ...e, i })).filter(e => !backEdges.has(e.i) && out.has(e.from) && out.has(e.to) && e.from !== e.to);
  const indeg = new Map<string, number>(ids.map(id => [id, 0]));
  for (const e of forward) {
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const layer = new Map<string, number>(ids.map(id => [id, 0]));
  const queue = ids.filter(id => indeg.get(id) === 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of forward) {
      if (e.from !== id) {
        continue;
      }
      layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(id)! + 1));
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) {
        queue.push(e.to);
      }
    }
  }
  return { layer, backEdges };
}

/**
 * The nodes placed: layers as columns, left to right; within a column a
 * barycenter pass puts each node beside what it is wired to, and the label
 * settles what the wiring cannot. Deterministic.
 * @param graph - A validated graph.
 */
export function placeNodes(graph: ArchitectureGraph): { placed: Placed[]; backEdges: Set<number>; layers: number } {
  const { layer, backEdges } = layerNodes(graph);
  const layerCount = Math.max(...[...layer.values()]) + 1;
  const byLabel = (a: ArchitectureNode, b: ArchitectureNode) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const columns: ArchitectureNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of [...graph.nodes].sort(byLabel)) {
    columns[layer.get(n.id)!]!.push(n);
  }

  const neighbours = new Map<string, string[]>(graph.nodes.map(n => [n.id, []]));
  for (const e of graph.edges) {
    if (neighbours.has(e.from) && neighbours.has(e.to)) {
      neighbours.get(e.from)!.push(e.to);
      neighbours.get(e.to)!.push(e.from);
    }
  }
  const position = new Map<string, number>();
  const settle = () => columns.forEach(col => col.forEach((n, i) => position.set(n.id, i)));
  settle();
  // Four sweeps, down then up, is enough for a graph this size to stop moving.
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 === 0 ? columns.keys() : [...columns.keys()].reverse();
    for (const c of order) {
      const col = columns[c]!;
      const bary = new Map<string, number>();
      for (const n of col) {
        const adj = neighbours.get(n.id)!.filter(id => layer.get(id) === (sweep % 2 === 0 ? c - 1 : c + 1));
        bary.set(n.id, adj.length === 0 ? position.get(n.id)! : adj.reduce((s, id) => s + position.get(id)!, 0) / adj.length);
      }
      col.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || byLabel(a, b));
      settle();
    }
  }

  const tallest = Math.max(...columns.map(c => c.length));
  // A group's label sits above its first node, so a graph with groups
  // starts its rows that much lower than the title.
  const headroom = (graph.groups?.length ?? 0) > 0 ? GROUP_PAD + GROUP_LABEL_H : 0;
  const placed: Placed[] = [];
  columns.forEach((col, c) => {
    // Each column is centred on the tallest one.
    const top = MARGIN + TITLE_H + headroom + ((tallest - col.length) * (NODE_H + NODE_GAP)) / 2;
    col.forEach((n, i) => {
      placed.push({ ...n, layer: c, order: i, x: MARGIN + c * (NODE_W + LAYER_GAP), y: top + i * (NODE_H + NODE_GAP) });
    });
  });
  return { placed, backEdges, layers: layerCount };
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

/**
 * XML text, with the five characters that would end the document early removed.
 * @param raw - The text as written.
 */
export function esc(raw: string): string {
  // eslint-disable-next-line no-control-regex -- XML forbids these; a model that emits one must not break the picture
  return raw.replace(/[\x00-\x08\v\f\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Text broken into at most `lines` lines of about `width` characters, the
 * last one cut with an ellipsis when the words run on. Word boundaries
 * first; a single word longer than a line is cut.
 * @param text - What to fit.
 * @param width - Characters per line.
 * @param lines - Lines allowed.
 */
export function wrapText(text: string, width: number, lines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > width ? `${w.slice(0, Math.max(1, width - 1))}…` : w;
    if (cur === '') {
      cur = word;
    } else if (cur.length + 1 + word.length <= width) {
      cur = `${cur} ${word}`;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) {
    out.push(cur);
  }
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    const last = kept[lines - 1]!;
    if (last.length < width) {
      kept[lines - 1] = `${last}…`;
    } else {
      // No room for the mark: drop the last word when enough of the line
      // survives that, else cut mid-word.
      const atWord = last.lastIndexOf(' ');
      kept[lines - 1] = atWord > width / 2 ? `${last.slice(0, atWord)}…` : `${last.slice(0, width - 1)}…`;
    }
    return kept;
  }
  return out;
}

/**
 * A line cut to `width` characters with an ellipsis.
 * @param text - The line.
 * @param width - Characters allowed.
 */
function ellipsis(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}

function text(x: number, y: number, s: string, opts: { size: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; mono?: boolean; upper?: boolean; spacing?: number }): string {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${opts.mono ? MONO : FONT}"`,
    `font-size="${opts.size}"`,
    `fill="${opts.fill ?? INK}"`,
    opts.anchor ? `text-anchor="${opts.anchor}"` : '',
    opts.weight ? `font-weight="${opts.weight}"` : '',
    opts.spacing ? `letter-spacing="${opts.spacing}"` : '',
  ].filter(Boolean).join(' ');
  return `<text ${attrs}>${esc(opts.upper ? s.toUpperCase() : s)}</text>`;
}

/**
 * The node's outline, by kind. Every shape fills the same box so the edges
 * can aim at its middle without knowing what it is.
 * @param n - The placed node.
 */
function nodeShape(n: Placed): string {
  const { x, y } = n;
  switch (n.kind) {
    case 'database': {
      // A cylinder: the body, the bottom curve, and the top ellipse.
      const ry = 7;
      return [
        `<path d="M${x} ${y + ry} V${y + NODE_H - ry} A${NODE_W / 2} ${ry} 0 0 0 ${x + NODE_W} ${y + NODE_H - ry} V${y + ry}" fill="${FILL}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<ellipse cx="${x + NODE_W / 2}" cy="${y + ry}" rx="${NODE_W / 2}" ry="${ry}" fill="${CHROME}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
      ].join('');
    }
    case 'queue':
      return `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="${NODE_H / 2}" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`;
    case 'external':
      return `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${PAPER}" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="5 4"/>`;
    case 'storage':
      // A drawer: the box and a lid line.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${FILL}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<path d="M${x} ${y + 12} H${x + NODE_W}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
      ].join('');
    case 'web':
      // A browser frame: the bar with its three dots.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<path d="M${x} ${y + 12} H${x + NODE_W}" stroke="${LINE}" stroke-width="1"/>`,
        `<circle cx="${x + 9}" cy="${y + 6}" r="1.6" fill="${MUTED}"/><circle cx="${x + 15}" cy="${y + 6}" r="1.6" fill="${MUTED}"/><circle cx="${x + 21}" cy="${y + 6}" r="1.6" fill="${MUTED}"/>`,
      ].join('');
    case 'mobile':
      // A phone: rounded, a notch at the top.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="14" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<rect x="${x + NODE_W / 2 - 14}" y="${y + 3}" width="28" height="4" rx="2" fill="${MUTED}"/>`,
      ].join('');
    case 'package':
      // A parcel: the box and the tape across its top.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${CHROME}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<path d="M${x + NODE_W / 2} ${y} V${y + 10}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
      ].join('');
    case 'infra':
      // Hardware: the box with a doubled left edge.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="3" fill="${CHROME}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<path d="M${x + 5} ${y + 4} V${y + NODE_H - 4}" stroke="${MUTED}" stroke-width="1.2"/>`,
      ].join('');
    case 'worker':
      // A worker: the box and the accent tick of something that runs on its own.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<path d="M${x + NODE_W - 22} ${y + 8} l5 6 l-5 6 M${x + NODE_W - 15} ${y + 8} l5 6 l-5 6" fill="none" stroke="${ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
      ].join('');
    case 'api':
      // An API: the box and the braces of an interface.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        text(x + NODE_W - 10, y + 18, '{ }', { size: 11, fill: ACCENT, anchor: 'end', mono: true }),
      ].join('');
    default:
      // A service: the box and a dot — the plainest shape, for the commonest thing.
      return [
        `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.2"/>`,
        `<circle cx="${x + NODE_W - 12}" cy="${y + 12}" r="3" fill="${ACCENT}"/>`,
      ].join('');
  }
}

/** The one-line legend, in words, for the shapes on this page. */
const LEGEND: Record<NodeKind, string> = {
  service: 'service — box with a dot',
  web: 'web — browser bar',
  mobile: 'mobile — phone',
  api: 'api — braces',
  worker: 'worker — chevrons',
  database: 'database — cylinder',
  queue: 'queue — rounded',
  storage: 'storage — drawer',
  external: 'external — dashed',
  package: 'package — taped box',
  infra: 'infra — doubled edge',
};

function nodeSvg(n: Placed): string {
  const cx = n.x + NODE_W / 2;
  // The label has to leave room for the kind above it and the repo below it.
  const labelLines = wrapText(n.label, 22, 2);
  // Kind caption at the top, label in the middle, repo at the bottom; a
  // two-line label takes the room between the other two.
  const labelTop = n.y + (labelLines.length === 1 ? (n.repo ? 38 : 41) : 32);
  const out: string[] = [`<g data-node="${esc(n.id)}" data-kind="${n.kind}">`];
  if (n.note) {
    out.push(`<title>${esc(`${n.label}: ${n.note}`)}</title>`);
  }
  out.push(nodeShape(n));
  // The cylinder's rim takes the top few pixels, so its caption sits lower.
  out.push(text(n.x + 10, n.y + (n.kind === 'database' ? 23 : 18), n.kind, { size: 8.5, fill: INK_SOFT, upper: true, spacing: 0.8, weight: 600 }));
  labelLines.forEach((line, i) => {
    out.push(text(cx, labelTop + i * 14, line, { size: 12.5, anchor: 'middle', weight: 600 }));
  });
  if (n.repo) {
    out.push(text(cx, n.y + NODE_H - 10, ellipsis(n.repo, 26), { size: 9.5, fill: INK_SOFT, anchor: 'middle', mono: true }));
  }
  out.push('</g>');
  return out.join('');
}

/**
 * One edge, from the right side of its source to the left side of its
 * target when it runs forward across layers; a curve under the nodes when
 * it runs backwards or sideways, so a loop reads as a loop. Dashed when it
 * only declares a dependency, dotted when it deploys.
 * @param e - The edge.
 * @param from - Its source, placed.
 * @param to - Its target, placed.
 * @param back - Whether layering ignored it.
 */
function edgeSvg(e: ArchitectureEdge, from: Placed, to: Placed, back: boolean): string {
  const dash = e.kind === 'depends' ? ' stroke-dasharray="4 3"' : e.kind === 'deploys' ? ' stroke-dasharray="1.5 3"' : '';
  const stroke = e.kind === 'depends' ? MUTED : INK_SOFT;
  let d: string;
  let lx: number;
  let ly: number;
  if (to.layer > from.layer) {
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x - 6;
    const y2 = to.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
    lx = mid;
    ly = (y1 + y2) / 2 - 5;
  } else {
    // Backwards or within the layer: out of the bottom, under, into the bottom.
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + NODE_H;
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y + NODE_H + 6;
    const drop = Math.max(y1, y2) + 26 + (back ? 10 : 0);
    d = `M${x1} ${y1} C${x1} ${drop} ${x2} ${drop} ${x2} ${y2}`;
    lx = (x1 + x2) / 2;
    ly = drop - 8;
  }
  const out = [`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.3"${dash} marker-end="url(#arrow)"/>`];
  const label = e.label ?? (e.kind && e.kind !== 'calls' ? e.kind : null);
  if (label) {
    const shown = ellipsis(label, 18);
    const w = shown.length * 6 + 10;
    out.push(`<rect x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="13" rx="3" fill="${PAPER}" fill-opacity="0.92"/>`);
    out.push(text(lx, ly + 1, shown, { size: 9.5, fill: INK_SOFT, anchor: 'middle' }));
  }
  return out.join('');
}

function groupSvg(g: ArchitectureGroup, members: Placed[]): string {
  if (members.length === 0) {
    return '';
  }
  const x = Math.min(...members.map(m => m.x)) - GROUP_PAD;
  const y = Math.min(...members.map(m => m.y)) - GROUP_PAD - GROUP_LABEL_H;
  const r = Math.max(...members.map(m => m.x)) + NODE_W + GROUP_PAD;
  const b = Math.max(...members.map(m => m.y)) + NODE_H + GROUP_PAD;
  return [
    `<g data-group="${esc(g.id)}">`,
    `<rect x="${x}" y="${y}" width="${r - x}" height="${b - y}" rx="10" fill="${CHROME}" stroke="${LINE}" stroke-width="1"/>`,
    text(x + 10, y + 13, ellipsis(g.label, 40), { size: 9.5, fill: INK_SOFT, upper: true, spacing: 0.8, weight: 600 }),
    '</g>',
  ].join('');
}

/**
 * Legend items joined with separators, broken into lines of about `width`
 * characters; an item is never split.
 * @param items - Each "kind — shape" phrase.
 * @param width - Characters per line.
 */
function wrapLegend(items: string[], width: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const item of items) {
    const next = cur === '' ? item : `${cur}  ·  ${item}`;
    if (cur !== '' && next.length > width) {
      lines.push(cur);
      cur = item;
    } else {
      cur = next;
    }
  }
  if (cur !== '') {
    lines.push(cur);
  }
  return lines;
}

/**
 * The architecture diagram, as an SVG document.
 *
 * Deterministic: the same graph draws the same bytes. The input is expected
 * to have passed {@link ArchitectureGraphSchema}; an edge or group member
 * that names no node is skipped rather than drawn to nowhere.
 * @param graph - The typed graph.
 */
export function architectureDiagramSvg(graph: ArchitectureGraph): string {
  const { placed, backEdges, layers } = placeNodes(graph);
  const byId = new Map(placed.map(p => [p.id, p]));
  const groups = graph.groups ?? [];

  const hasBackOrSideways = graph.edges.some((e) => {
    const f = byId.get(e.from);
    const t = byId.get(e.to);
    return f && t && t.layer <= f.layer;
  });
  const width = MARGIN * 2 + layers * NODE_W + (layers - 1) * LAYER_GAP;
  const bodyBottom = Math.max(...placed.map(p => p.y)) + NODE_H + (hasBackOrSideways ? 44 : 0) + (groups.length > 0 ? GROUP_PAD : 0);

  // The legend names only the shapes on this page, wrapped to its width.
  const kinds = [...new Set(placed.map(p => p.kind))].sort((a, b) => NODE_KINDS.indexOf(a) - NODE_KINDS.indexOf(b));
  const edgeKinds = [...new Set(graph.edges.map(e => e.kind).filter((k): k is EdgeKind => k === 'depends' || k === 'deploys'))].sort();
  const legendItems = [...kinds.map(k => LEGEND[k]), ...edgeKinds.map(k => (k === 'depends' ? 'dashed — depends on' : 'dotted — deploys'))];
  const legendLines = wrapLegend(legendItems, Math.floor((width - MARGIN * 2) / 5.4));
  const height = bodyBottom + MARGIN / 2 + LEGEND_H + (legendLines.length - 1) * 14;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(`${graph.title}: architecture, ${placed.length} components`)}">`,
    `<title>${esc(`${graph.title} — architecture`)}</title>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="${INK_SOFT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${PAPER}"/>`,
    text(MARGIN, MARGIN + 6, ellipsis(graph.title, 60), { size: 16, weight: 600 }),
    text(MARGIN, MARGIN + 24, `${placed.length} component${placed.length === 1 ? '' : 's'}, ${graph.edges.length} connection${graph.edges.length === 1 ? '' : 's'}${groups.length > 0 ? `, ${groups.length} group${groups.length === 1 ? '' : 's'}` : ''}`, { size: 10.5, fill: INK_SOFT }),
  ];
  for (const g of groups) {
    parts.push(groupSvg(g, g.nodes.map(id => byId.get(id)).filter((p): p is Placed => Boolean(p))));
  }
  graph.edges.forEach((e, i) => {
    const f = byId.get(e.from);
    const t = byId.get(e.to);
    if (f && t && f !== t) {
      parts.push(edgeSvg(e, f, t, backEdges.has(i)));
    }
  });
  for (const p of placed) {
    parts.push(nodeSvg(p));
  }
  legendLines.forEach((line, i) => {
    parts.push(text(MARGIN, height - 12 - (legendLines.length - 1 - i) * 14, line, { size: 9.5, fill: INK_SOFT }));
  });
  parts.push('</svg>');
  return parts.join('');
}

/* ------------------------------------------------------------------ */
/* The summary, as markdown                                            */
/* ------------------------------------------------------------------ */

/**
 * A markdown table cell: pipes and line breaks would break the row.
 * @param s - The cell's text, if any.
 */
function cell(s: string | undefined): string {
  return (s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * The same graph as prose and a table, so `search_knowledge` and a reader
 * without the picture get the components, what each is, where it lives and
 * what talks to what.
 * @param graph - The typed graph.
 * @param summary - What the system is, in a paragraph.
 */
export function architectureSummaryMarkdown(graph: ArchitectureGraph, summary: string): string {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const lines: string[] = [`# ${graph.title} — architecture`, ''];
  if (summary.trim()) {
    lines.push(summary.trim(), '');
  }
  lines.push('## Components', '', '| Component | Kind | Repository | Note |', '|---|---|---|---|');
  for (const n of [...graph.nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    lines.push(`| ${cell(n.label)} | ${n.kind} | ${n.repo ? `\`${cell(n.repo)}\`` : '—'} | ${cell(n.note) || '—'} |`);
  }
  if (graph.edges.length > 0) {
    lines.push('', '## Relationships', '');
    for (const e of graph.edges) {
      const verb = e.kind ?? 'calls';
      lines.push(`- ${cell(name(e.from))} → ${cell(name(e.to))} (${verb})${e.label ? `: ${cell(e.label)}` : ''}`);
    }
  }
  if (graph.groups && graph.groups.length > 0) {
    lines.push('', '## Groups', '');
    for (const g of graph.groups) {
      lines.push(`- **${cell(g.label)}**: ${g.nodes.map(name).map(cell).join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
