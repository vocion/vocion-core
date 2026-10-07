import type { ArchitectureGraph } from './architectureDiagram';
import { describe, expect, it } from 'vitest';
import { architectureDiagramSvg, ArchitectureGraphSchema, architectureSummaryMarkdown, esc, layerNodes, placeNodes, wrapText } from './architectureDiagram';
import { SEND } from './architectureDiagram.fixture';

/**
 * The drawing is the platform's claim about a product's shape, so what it
 * says and refuses is argued with here rather than looked at in a browser.
 * Fixtures are fictional: Northwind's "Send".
 */

function graph(over: Partial<ArchitectureGraph>): ArchitectureGraph {
  return { title: 'T', nodes: [], edges: [], ...over };
}

describe('the schema refuses what the drawing could not honour', () => {
  it('accepts the fixture whole', () => {
    expect(ArchitectureGraphSchema.safeParse(SEND).success).toBe(true);
  });

  it('names the edge end that points at no node', () => {
    const out = ArchitectureGraphSchema.safeParse(graph({ nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [{ from: 'a', to: 'ghost' }] }));

    expect(out.success).toBe(false);
    expect(out.error?.issues.map(i => `${i.path.join('.')}: ${i.message}`)).toEqual(['edges.0.to: edge to "ghost" names no node; declare it in nodes or drop the edge']);
  });

  it('refuses two nodes with one id, a self edge, and a group member that is not a node', () => {
    const out = ArchitectureGraphSchema.safeParse(graph({
      nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'a', label: 'A again', kind: 'service' }],
      edges: [{ from: 'a', to: 'a' }],
      groups: [{ id: 'g', label: 'G', nodes: ['a', 'nope'] }],
    }));

    expect(out.success).toBe(false);

    const messages = out.error?.issues.map(i => i.message) ?? [];

    expect(messages).toContain('node id "a" is used twice; ids must be unique');
    expect(messages).toContain('edge from "a" to itself says nothing; drop it');
    expect(messages).toContain('group "g" names node "nope", which is not in nodes');
  });

  it('caps the graph at what a page can read, and says so in words the model can act on', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service' as const }));
    const out = ArchitectureGraphSchema.safeParse(graph({ nodes }));

    expect(out.success).toBe(false);
    expect(out.error?.issues[0]?.message).toMatch(/at most 24 nodes/);
  });

  it('refuses a kind it has no shape for', () => {
    expect(ArchitectureGraphSchema.safeParse(graph({ nodes: [{ id: 'a', label: 'A', kind: 'blockchain' as never }] })).success).toBe(false);
  });
});

describe('layering', () => {
  it('puts each node one layer past the furthest thing that reaches it', () => {
    const { layer } = layerNodes(graph({
      nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, kind: 'service' })),
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }],
    }));

    expect([...layer.entries()]).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
  });

  it('breaks a cycle deterministically and keeps drawing', () => {
    const cyclic = graph({
      nodes: ['a', 'b', 'c'].map(id => ({ id, label: id, kind: 'service' })),
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    });
    const { layer, backEdges } = layerNodes(cyclic);

    expect([...backEdges]).toEqual([2]);
    expect([...layer.values()]).toEqual([0, 1, 2]);

    const svg = architectureDiagramSvg(cyclic);

    expect(svg).toContain('<svg');
    // The loop-closing edge is still drawn.
    expect(svg.match(/marker-end="url\(#arrow\)"/g)).toHaveLength(3);
  });

  it('leaves a node nothing reaches in the first layer', () => {
    const { layer } = layerNodes(graph({ nodes: [{ id: 'lone', label: 'Lone', kind: 'infra' }, { id: 'a', label: 'A', kind: 'service' }, { id: 'b', label: 'B', kind: 'service' }], edges: [{ from: 'a', to: 'b' }] }));

    expect(layer.get('lone')).toBe(0);
  });

  it('orders a layer by what it is wired to, then by label', () => {
    const { placed } = placeNodes(SEND);
    const column = (n: number) => placed.filter(p => p.layer === n).sort((a, b) => a.order - b.order).map(p => p.id);

    // Clients first; the API they both call next; then what the API reaches.
    expect(column(0)).toEqual(expect.arrayContaining(['web', 'ios', 'infra']));
    expect(column(1)).toContain('api');
    expect(placed.find(p => p.id === 'pg')!.layer).toBeGreaterThan(placed.find(p => p.id === 'api')!.layer);
    // Columns go left to right.
    expect(placed.find(p => p.id === 'api')!.x).toBeGreaterThan(placed.find(p => p.id === 'web')!.x);
  });
});

/**
 * Every tag's attributes pair up as name="value": what is left of a tag once
 * they are stripped is nothing. A quote inside a value (a font name) is what
 * this catches, and what a browser reports as a page that does not render.
 * @param svg - The document.
 */
function malformedTags(svg: string): string[] {
  return [...svg.matchAll(/<[^>]*>/g)].map(m => m[0]).filter((tag) => {
    const rest = tag.replace(/^<\/?[\w:-]+/, '').replace(/\s[\w:-]+="[^"<>]*"/g, '').replace(/\s*\/?>$/, '');
    return rest.trim() !== '';
  });
}

describe('the drawing', () => {
  it('is well-formed XML: every attribute is a quoted pair, nothing dangles', () => {
    expect(malformedTags(architectureDiagramSvg(SEND))).toEqual([]);
    expect(malformedTags('<text font-family="a, "b", c">')).toHaveLength(1);
  });

  it('is deterministic, which is what lets the store content-address it', () => {
    expect(architectureDiagramSvg(SEND)).toBe(architectureDiagramSvg(structuredClone(SEND)));
  });

  it('draws every node with its kind, its label and its repository', () => {
    const svg = architectureDiagramSvg(SEND);
    for (const n of SEND.nodes) {
      expect(svg).toContain(`data-node="${n.id}" data-kind="${n.kind}"`);
      expect(svg).toContain(esc(n.label));
    }

    expect(svg).toContain('northwind/send-api');
    expect(svg).toContain('>WEB<');
    expect(svg).toContain('>DATABASE<');
  });

  it('gives each kind its own shape: a cylinder, a rounded pill, a dashed box', () => {
    const svg = architectureDiagramSvg(SEND);

    expect(svg).toContain('<ellipse');
    expect(svg).toContain(`rx="34"`);
    expect(svg).toContain('stroke-dasharray="5 4"');
  });

  it('draws groups behind their nodes, labelled', () => {
    const svg = architectureDiagramSvg(SEND);

    expect(svg).toContain('data-group="clients"');
    expect(svg).toContain('>CLIENTS<');
    expect(svg.indexOf('data-group="clients"')).toBeLessThan(svg.indexOf('data-node="web"'));
  });

  it('prints the edge labels and the legend for the shapes on the page', () => {
    const svg = architectureDiagramSvg(SEND);

    expect(svg).toContain('>REST<');
    expect(svg).toContain('>opened events<');
    expect(svg).toContain('database — cylinder');
    expect(svg).toContain('dashed — depends on');
    expect(svg).toContain('<title>Send — architecture</title>');
  });

  it('escapes every character that would end the document early', () => {
    const svg = architectureDiagramSvg(graph({
      title: 'Tom & Jerry <"quoted">',
      nodes: [{ id: 'a', label: '<script>alert(\'x\')</script>', kind: 'service', repo: 'o/r&d', note: 'a < b' }],
    }));

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(&apos;x&apos;)&lt;/script&gt;');
    expect(svg).toContain('Tom &amp; Jerry &lt;&quot;quoted&quot;&gt;');
    expect(svg).toContain('o/r&amp;d');
  });

  it('sizes itself from the layout', () => {
    const small = architectureDiagramSvg(graph({ nodes: [{ id: 'a', label: 'A', kind: 'service' }] }));
    const big = architectureDiagramSvg(SEND);
    const width = (svg: string) => Number(/ width="(\d+(?:\.\d+)?)"/.exec(svg)![1]);

    expect(width(big)).toBeGreaterThan(width(small));
    expect(width(big)).toBeLessThanOrEqual(1400);
  });

  it('skips an edge to a node the graph lost rather than drawing to nowhere', () => {
    const svg = architectureDiagramSvg(graph({ nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [{ from: 'a', to: 'ghost' }] }));

    expect(svg).not.toContain('marker-end');
  });
});

describe('text fitting', () => {
  it('wraps at words and ellipses what runs over', () => {
    expect(wrapText('Send web app', 22, 2)).toEqual(['Send web app']);
    expect(wrapText('A very long component name that will not fit in two lines of a box', 22, 2)).toEqual(['A very long component', 'name that will not…']);
  });

  it('cuts one word longer than a line', () => {
    expect(wrapText('supercalifragilisticexpialidocious', 10, 1)).toEqual(['supercali…']);
  });
});

describe('the summary', () => {
  it('is a table of components and a list of relationships search can read', () => {
    const md = architectureSummaryMarkdown(SEND, 'Send lets a person upload a file and know when it was opened.');

    expect(md).toContain('# Send — architecture');
    expect(md).toContain('Send lets a person upload a file');
    expect(md).toContain('| Component | Kind | Repository | Note |');
    expect(md).toContain('| Send API | api | `northwind/send-api` | REST; auth, uploads, links |');
    expect(md).toContain('| Postgres | database | — | — |');
    expect(md).toContain('- Send API → Redis queue (publishes): opened events');
    expect(md).toContain('- **Clients**: Send web app, Send for iPhone');
  });

  it('keeps a pipe in a note from breaking the row', () => {
    const md = architectureSummaryMarkdown(graph({ nodes: [{ id: 'a', label: 'A', kind: 'service', note: 'x | y' }] }), '');

    expect(md).toContain('| A | service | — | x \\| y |');
  });
});

describe('esc, the one gate every text node passes', () => {
  it('escapes the five XML specials and drops the control characters XML forbids', () => {
    expect(esc('a<b>&"c\'')).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
    expect(esc('bell\u0007 tab\t nl\n esc\u001B')).toBe('bell tab\t nl\n esc');
  });
});
