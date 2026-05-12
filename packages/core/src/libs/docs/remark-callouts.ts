import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * remark-callouts — turns `remark-directive` container directives
 * (`:::note`, `:::tip`, `:::warning`, `:::danger`) into styled HTML
 * divs the DocViewer's `prose` styles + global.css callout rules pick
 * up.
 *
 * Pair with `remark-directive` upstream in the pipeline:
 *
 *   .use(remarkDirective)
 *   .use(remarkCallouts)
 *
 * Example markdown:
 *
 *   :::warning Heads up
 *   This is a warning callout.
 *   :::
 *
 * Renders as `<div class="callout callout-warning"><div class="callout-title">Heads up</div>…body…</div>`.
 */
const KNOWN_KINDS = new Set(['note', 'tip', 'warning', 'danger']);

type ContainerDirective = {
  type: 'containerDirective';
  name: string;
  children: Array<{ type: string; data?: Record<string, unknown> } & Record<string, unknown>>;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  attributes?: Record<string, string>;
};

export const remarkCallouts: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, (node: unknown) => {
      const directive = node as ContainerDirective | undefined;
      if (!directive || directive.type !== 'containerDirective') {
        return;
      }
      if (!KNOWN_KINDS.has(directive.name)) {
        return;
      }
      const data = (directive.data ??= {});
      data.hName = 'div';
      data.hProperties = {
        className: ['callout', `callout-${directive.name}`],
      };
      // First child may be a "directiveLabel" paragraph — the bit after
      // `:::warning` on the opening line. Render it as a title.
      const firstChild = directive.children[0];
      if (firstChild && (firstChild as { data?: { directiveLabel?: boolean } }).data?.directiveLabel) {
        const labelData = ((firstChild as { data?: Record<string, unknown> }).data ??= {});
        labelData.hName = 'div';
        labelData.hProperties = { className: ['callout-title'] };
      }
    });
  };
};
