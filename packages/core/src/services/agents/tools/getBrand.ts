/**
 * get_brand — the workspace's brand guide, in the shape a document uses.
 *
 * A client-facing document has to look like the seller and read like the
 * seller. Both live in `brand.yaml` (`libs/workspace/brand.ts`): palette as
 * CSS tokens, fonts, logos as data URIs, voice rules. This tool hands the
 * agent all of it in one read, so the framework's `:root` is the brand's and
 * the strip's logo is the real mark rather than a remembered path. With no
 * `brand.yaml`, it says so and points at `brand_lookup` to seed one from the
 * company's own site.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { brandForAgent, readWorkspaceBrand } from '@/libs/workspace/brand';

export function getBrandTool(_ctx: RuntimeContext) {
  return tool(
    async () => {
      const { brand, issues } = readWorkspaceBrand();
      if (!brand) {
        return issues.length
          ? `brand.yaml could not be read: ${issues.map(i => i.message).join('; ')}. Fix it in the workspace; until then use the framework's default palette and say the document is unbranded.`
          : 'This workspace has no brand.yaml. Run brand_lookup on the seller\'s own site to seed one (palette, logo, descriptor), hand the YAML to a person to commit under the workspace root, and use the framework\'s default palette meanwhile — never invent brand colours.';
      }
      const note = issues.length ? `\n\nNote: ${issues.map(i => i.message).join('; ')}` : '';
      return brandForAgent(brand) + note;
    },
    {
      name: 'get_brand',
      description: 'Read the workspace brand guide — palette as CSS tokens for the document :root, fonts, the logo mark and wordmark as data URIs to inline, and the voice rules — before writing any client-facing document. One read; paste the tokens, inline the logos exactly, apply the rules.',
      schema: z.object({}),
    },
  );
}
