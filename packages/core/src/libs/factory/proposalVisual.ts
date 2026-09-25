/**
 * THE PICTURE ON THE CARD, DRAWN BY THE PLATFORM.
 *
 * The Work board has carried `visuals.beforeArtifactIds` since the evidence
 * gate shipped, and a badge reading "no mock" on every row that had none. On
 * 2026-09-24 sixteen of twenty-five proposed outcomes carried that badge. A
 * gate that nothing can pass is not a gate, it is a complaint printed once per
 * row — and the page's own standard says a systemic gap is surfaced once, not
 * sprayed through the list.
 *
 * Chris, 2026-09-24: *"give me thumbnails in every work card… the platform
 * should be responsible for generating these in the plan step."* So the
 * picture stops being something an agent is asked for and becomes something
 * the platform draws, from what the record already says, every time the
 * record's meaning changes.
 *
 * Drawn as SVG, in code, deterministically. The alternative was the image
 * model, and it fails on all three counts that matter here: it costs a paid
 * call per plan on a board with twenty-five open rows, it draws different
 * pictures from the same facts, and it renders invented screen text that
 * would make the mock a claim about a product we have not built. A drawing
 * derived from the record cannot say anything the record does not.
 *
 * WHAT IT IS ALLOWED TO SAY. The thumbnail is ninety-six pixels of shape. It
 * carries no sentence, because a sentence is illegible at that size and an
 * illegible sentence is decoration. It carries STRUCTURE — which kind of
 * change this is, where it lands, and how much of it there is — and at most
 * one short word per box. Everything else about the outcome is one tap away
 * on the feature report, where the full Preview already lives.
 *
 * WHAT IT DOES NOT DO. It does not replace a designer's mockup. An artifact
 * filed against the request by a person or an agent takes precedence, because
 * a real picture of the real screen beats a true diagram of its shape; this
 * is the floor, not the ceiling.
 */

/** The panel, in a palette that reads on a light or a dark page behind it. */
const INK = '#3A362F';
const LINE = '#E4E0DA';
const MUTED = '#CFC9C0';
const PAPER = '#FFFFFF';
const CHROME = '#FAF8F5';
const FILL = '#F1EDE7';
/** What this change touches, in the same amber the board's "Decide" badge uses. */
const ACCENT = '#D97706';
const ACCENT_SOFT = '#FBE3C0';

/** The frame every shape is drawn inside. One to one with the rendered box. */
const W = 128;
const H = 80;

/**
 * Which drawing this outcome gets.
 *
 *   - `screen` — something a person looks at. A page frame, and the parts of
 *     it this work changes.
 *   - `mechanism` — the machine underneath. The components the plan says
 *     change, and the direction between them.
 *   - `unknown` — nobody has said yet. An empty frame, which is the honest
 *     drawing of "we do not know what this changes".
 */
export type VisualShape = 'screen' | 'mechanism' | 'unknown';

/** Everything the drawing is allowed to read. Nothing here is invented. */
export type ProposalVisualInput = {
  /** `request.surface`: ui, flow, data, infra, none — or absent at triage. */
  surface?: string | null;
  /** How many acceptance criteria the contract carries. */
  acceptanceCount?: number;
  /** The plan's "what changes, by component", one line per package or service. */
  components?: readonly string[];
  /** The plan's interfaces added or altered; drawn as the seam between boxes. */
  interfaceCount?: number;
};

/**
 * The shape this outcome is drawn as.
 *
 * `surface` is the field triage sets precisely to answer "does a person look
 * at this", so it is the field that decides. An outcome nobody has classified
 * is drawn as unknown rather than guessed at from its title: a drawing that
 * infers what the record refused to state is the drawing that will be wrong.
 * @param input - What the record says.
 */
export function visualShape(input: ProposalVisualInput): VisualShape {
  const surface = (input.surface ?? '').trim().toLowerCase();
  if (surface === 'ui' || surface === 'flow') {
    return 'screen';
  }
  if (surface === 'data' || surface === 'infra' || surface === 'none') {
    return 'mechanism';
  }
  return 'unknown';
}

/**
 * XML text, with the five characters that would end the document early removed.
 * @param raw
 */
function esc(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * A component line reduced to the one word that fits in a box.
 *
 * The plan writes a sentence per component — "packages/core: the page layer
 * resolves artifact ids to served urls". At this size only the subject fits,
 * so the subject is what is drawn: the first path segment, package or service
 * name, up to eight characters. A longer name is cut rather than ellipsed,
 * because an ellipsis costs a character the name could have used.
 * @param line - One line of the plan's component list.
 */
export function componentLabel(line: string): string {
  const head = line.split(/[:—–-]/, 1)[0]!.trim();
  const last = head.split('/').filter(Boolean).pop() ?? head;
  return last.replace(/[^\w.@-]+/g, ' ').trim().slice(0, 8);
}

/**
 * A rounded rect.
 * @param x
 * @param y
 * @param w
 * @param h
 * @param r
 * @param fill
 * @param stroke
 */
function rect(x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string): string {
  const s = stroke === undefined ? '' : ` stroke="${stroke}"`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${s}/>`;
}

/**
 * A page, and the parts of it this work changes.
 *
 * The chrome bar and the rail are the constants that make it read as a screen
 * at a glance. The content bars are the VARIABLE, and they are the acceptance
 * criteria: a contract with four things that must be true is drawn as four
 * changed rows, and a proposal with no contract at all is drawn as a page with
 * nothing highlighted — which is exactly what "no criteria" means and is
 * already the sentence on the row beneath.
 *
 * `flow` gets the same page with a step chain across it, because a flow is a
 * path between places rather than one place.
 * @param input - What the record says.
 */
function screenShape(input: ProposalVisualInput): string {
  const flow = (input.surface ?? '').trim().toLowerCase() === 'flow';
  const changed = Math.min(Math.max(input.acceptanceCount ?? 0, 0), 4);
  const out: string[] = [
    rect(1, 1, W - 2, H - 2, 6, PAPER, LINE),
    rect(1, 1, W - 2, 14, 6, CHROME),
    `<path d="M1 15 H${W - 1}" stroke="${LINE}"/>`,
    `<circle cx="10" cy="8" r="2" fill="${MUTED}"/><circle cx="17" cy="8" r="2" fill="${MUTED}"/><circle cx="24" cy="8" r="2" fill="${MUTED}"/>`,
    rect(32, 5, 88, 6, 3, FILL),
  ];
  if (flow) {
    // A flow is a path between places, so the PATH is what the change is
    // drawn as. The criteria are not mapped onto the steps here: a contract
    // with four criteria is not a journey with four screens, and drawing it
    // that way would invent a step count nothing recorded.
    const xs = [26, 64, 102];
    out.push(`<path d="M${xs[0]! + 9} 34 H${xs[1]! - 9} M${xs[1]! + 9} 34 H${xs[2]! - 9}" stroke="${ACCENT}" stroke-width="1.5"/>`);
    for (const cx of xs) {
      out.push(rect(cx - 9, 25, 18, 18, 4, ACCENT_SOFT, ACCENT));
    }
    for (let i = 0; i < 3; i++) {
      out.push(rect(20, 53 + i * 8, i === 0 ? 88 : 62, 4, 2, MUTED));
    }
    return out.join('');
  }
  // A page: the rail on the left, the content on the right, and the rows this
  // work changes drawn in the accent.
  out.push(rect(6, 20, 26, H - 26, 3, FILL));
  for (let i = 0; i < 4; i++) {
    out.push(rect(10, 25 + i * 9, 18, 4, 2, MUTED));
  }
  out.push(rect(38, 20, 84, 8, 3, INK));
  for (let i = 0; i < 4; i++) {
    const on = i < changed;
    out.push(rect(38, 33 + i * 11, on ? 84 : 66, 8, 3, on ? ACCENT_SOFT : FILL, on ? ACCENT : undefined));
    if (on) {
      out.push(rect(41, 35.5 + i * 11, 3, 3, 1.5, ACCENT));
    }
  }
  return out.join('');
}

/**
 * The machine, and the direction through it.
 *
 * A change a person never sees still has a shape a person can check: which
 * components it touches and in what order. That is what the plan's
 * `components` list records, so that is what is drawn — up to three boxes,
 * named, with the flow between them. The seam is drawn in the accent when the
 * plan says an interface changes there, because an altered interface is the
 * part of a machine change that something outside it already depends on.
 *
 * With no plan yet there is nothing recorded to name, so one unlabelled box
 * is drawn: a machine change whose blast radius nobody has written down.
 * @param input - What the record and its plan say.
 */
function mechanismShape(input: ProposalVisualInput): string {
  const seam = (input.interfaceCount ?? 0) > 0;
  const out: string[] = [rect(1, 1, W - 2, H - 2, 6, PAPER, LINE)];
  const raw = (input.components ?? []).map(componentLabel).filter(l => l !== '').slice(0, 3);
  if (raw.length === 0) {
    out.push(rect(43, 28, 42, 24, 4, FILL, LINE));
    out.push(`<path d="M52 40 H76" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    return out.join('');
  }
  // The box has to hold the word. A monospace glyph is about 0.6em wide, so
  // the label is cut to what fits rather than left to run over the edge —
  // which is what "worker" did in a three-box row at nine point.
  const { boxW, gap, size } = raw.length === 1
    ? { boxW: 56, gap: 0, size: 9 }
    : raw.length === 2
      ? { boxW: 44, gap: 16, size: 9 }
      : { boxW: 32, gap: 14, size: 8 };
  const fit = Math.floor((boxW - 6) / (size * 0.6));
  let x = Math.round((W - (raw.length * boxW + (raw.length - 1) * gap)) / 2);
  raw.forEach((label, i) => {
    // EVERY box is drawn as changing, because every line of the plan's
    // component list is a component that changes. Highlighting only the first
    // would rank them, and the plan states no rank.
    out.push(rect(x, 26, boxW, 28, 4, ACCENT_SOFT, ACCENT));
    out.push(`<text x="${x + boxW / 2}" y="${40 + size / 3}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${size}" fill="${INK}">${esc(label.slice(0, fit))}</text>`);
    if (i < raw.length - 1) {
      const from = x + boxW;
      const to = from + gap;
      // The seam reads in the accent only when the plan says an interface
      // changes there: an altered interface is the part of a machine change
      // that something outside it already depends on.
      const stroke = seam ? ACCENT : MUTED;
      out.push(`<path d="M${from + 3} 40 H${to - 5}" stroke="${stroke}" stroke-width="1.5"/>`);
      out.push(`<path d="M${to - 7} 37 L${to - 3} 40 L${to - 7} 43" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    x += boxW + gap;
  });
  return out.join('');
}

/**
 * Nobody has said what this changes.
 *
 * Drawn as an empty dashed frame, and that is the point: this is the only
 * drawing on the board that reports a MISSING fact, and it reports it by
 * being empty rather than by printing a complaint. A row whose surface nobody
 * set is a row nobody has triaged, and the card beside it already says so.
 */
function unknownShape(): string {
  return [
    `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="6" fill="${PAPER}" stroke="${LINE}" stroke-dasharray="4 4"/>`,
    `<path d="M50 40 H78" stroke="${MUTED}" stroke-width="1.5" stroke-linecap="round"/>`,
  ].join('');
}

/**
 * The proposal visual for one outcome, as an SVG document.
 *
 * Deterministic: the same record draws the same bytes, which is what lets the
 * store content-address it and the step skip a rewrite when nothing changed.
 * @param input - What the record and its plan say.
 * @returns The SVG source, and which shape it drew.
 */
export function proposalVisualSvg(input: ProposalVisualInput): { svg: string; shape: VisualShape } {
  const shape = visualShape(input);
  const body = shape === 'screen' ? screenShape(input) : shape === 'mechanism' ? mechanismShape(input) : unknownShape();
  // `role="img"` with a title: the drawing is the content, and a reader who
  // cannot see it gets the sentence rather than the filename.
  const label = shape === 'screen'
    ? 'Proposed change, drawn as the screen it lands on'
    : shape === 'mechanism'
      ? 'Proposed change, drawn as the components it touches'
      : 'Nothing recorded yet about what this changes';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${body}</svg>`;
  return { svg, shape };
}
