/**
 * The live check's browser tools — QA looks at a shipped release on the live
 * product the way a person would, in the style of Playwright MCP: open a page,
 * read its accessibility snapshot (each element with its role, name, state and
 * a ref), act by ref, screenshot what proves a line, read the responses the
 * page got. Every answer carries an id; `record_live_check` cites them.
 * Granted-only (`harness.grantTools: [browser]`). The session is
 * `services/factory/liveBrowser.ts`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** The grant that puts the browser tools on a seat's belt. */
export const BROWSER_GRANT = 'browser';

export function liveBrowserTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes(BROWSER_GRANT)) {
    return [];
  }
  const svc = () => import('@/services/factory/liveBrowser');
  const key = async () => (await svc()).browserSessionKey({ orgId: ctx.orgId, missionRunId: ctx.missionRunId ?? null, conversationId: ctx.conversationId ?? null });
  const who = { author: { kind: 'agent' as const, id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null }, provenance: { agentSlug: ctx.agentSlug ?? null, missionRunId: ctx.missionRunId ?? null } };
  const answer = (v: unknown) => JSON.stringify(v);
  return [
    tool(
      async args => answer(await (await svc()).browserOpen(await key(), ctx.orgId, { releaseId: args.release_id, target: args.url_or_path, signedIn: args.signed_in, viewport: args.viewport, demoForRequest: args.demo_for_request, say: args.say })),
      {
        name: 'browser_open',
        description: 'Open a page of the release\'s live product in this run\'s browser and return its accessibility snapshot: each element with its role, name, state ([disabled], [checked], [expanded]) and a ref (e5) to act on. '
          + 'Signed in as the product\'s QA account by default (its stored sign-in; you never see the password), or as a visitor with signed_in false. Only the product\'s own addresses open. '
          + 'The first open also lists each shipped request\'s acceptance lines, numbered: the lines record_live_check records. Every answer carries an id to cite as evidence. '
          + 'With demo_for_request, it opens that request\'s demo tab instead: a separate recording, filed on that request as its feature demo, in which every say is spoken and holds the screen.',
        schema: z.object({
          release_id: z.number().int().positive().describe('The release being checked (the event\'s releaseId).'),
          url_or_path: z.string().trim().min(1).max(2000).describe('A path on the product (/documents/new) or a full address on one of its own origins.'),
          signed_in: z.boolean().optional().describe('Default true: as the product\'s QA account. false: a visitor with no session.'),
          viewport: z.enum(['desktop', 'phone']).optional().describe('Default desktop.'),
          demo_for_request: z.number().int().positive().optional().describe('Record this shipped request\'s feature demo in its own tab: the happy path, end to end, as a user would use it. Leave out for the check.'),
          say: z.string().trim().max(300).optional().describe('What you tell the viewer as the page opens, in one plain sentence. In a demo tab the screen holds while it is said.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserSnapshot(await key(), {}, { find: args.find ?? null })),
      {
        name: 'browser_snapshot',
        description: 'The open page\'s accessibility snapshot again (address, title, each element with its state and ref), with an id to cite. Use it after the page changes by itself. A long page is cut at 12,000 characters from the top; pass find with words written on the section you need (a heading, a label) and the snapshot shows the page around them, so its refs can be acted on.',
        schema: z.object({
          find: z.string().trim().min(2).max(120).optional().describe('Words on the part of a long page to show, e.g. "Expiry". Case does not matter.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserClick(await key(), args.ref, {}, args.say)),
      {
        name: 'browser_click',
        description: 'Click an element by its ref from the last snapshot. A disabled element is not clicked: the answer says "disabled" at once. Returns the new snapshot and an id to cite.',
        schema: z.object({
          ref: z.string().trim().min(1).max(20).describe('The element\'s ref, e.g. e5.'),
          say: z.string().trim().max(300).optional().describe('In a demo: what you tell the viewer once it is clicked, one plain sentence; the screen holds while it is said.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserType(await key(), { ref: args.ref, text: args.text, submit: args.submit, say: args.say })),
      {
        name: 'browser_type',
        description: 'Type into a field by its ref, replacing what it held (an empty text clears it); submit presses Enter after. A disabled or read-only field is reported, not typed into. Returns the new snapshot and an id.',
        schema: z.object({
          ref: z.string().trim().min(1).max(20),
          text: z.string().max(2000),
          submit: z.boolean().optional(),
          say: z.string().trim().max(300).optional().describe('In a demo: what you tell the viewer once it is typed, one plain sentence; the screen holds while it is said.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserUpload(await key(), { ref: args.ref, name: args.name, megabytes: args.megabytes, say: args.say })),
      {
        name: 'browser_upload',
        description: 'Put a file into the page: a generated one-page sample PDF of about `megabytes`, named `name`. The ref is a file input, or the control that opens the file chooser (an Upload button, a drop zone\'s button). Use it wherever the feature starts with a file — a demo of a product that takes files has to put one in. Returns the new snapshot and an id to cite.',
        schema: z.object({
          ref: z.string().trim().min(1).max(20).describe('The file input, or what opens the chooser, by its ref from the last snapshot.'),
          name: z.string().trim().min(1).max(120).optional().describe('The file name the product will show, e.g. "Northwind board deck.pdf".'),
          megabytes: z.number().min(0.001).max(64).optional().describe('About how big; 1 when left out.'),
          say: z.string().trim().max(300).optional().describe('In a demo: what you tell the viewer once the file is in, one plain sentence; the screen holds while it is said.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserPress(await key(), args.key, {}, args.say)),
      {
        name: 'browser_press',
        description: 'Press a key on the open page (Enter, Escape, Tab, ArrowDown…). Returns the new snapshot and an id.',
        schema: z.object({
          key: z.string().trim().min(1).max(40),
          say: z.string().trim().max(300).optional().describe('In a demo: what you tell the viewer once it is pressed, one plain sentence; the screen holds while it is said.'),
        }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserSay(await key(), args.text, {}, args.ref ?? null)),
      {
        name: 'browser_say',
        description: 'Say one line to the viewer of the demo with nothing done on the page: the opening words, the closing words, or what is already on screen. In a demo tab the screen holds while it is said; the line is spoken in the recording at this moment. When the line is about something on screen (a mark, a row, a message), give its ref: the cursor rests on it and it is outlined while the line is said, so the viewer knows where to look.',
        schema: z.object({ text: z.string().trim().min(2).max(300).describe('One plain sentence, present tense, for someone who has never seen the feature.'), ref: z.string().trim().max(20).optional().describe('The ref (from the last snapshot) of what the line is about, so it is pointed at and outlined while said.') }),
      },
    ),
    tool(
      async args => answer(await (await svc()).browserScreenshot(await key(), args.caption, who)),
      {
        name: 'browser_screenshot',
        description: 'Screenshot the open page and file it on the release as a live shot, captioned with what it shows. Returns {id, url}: cite the id as the evidence for the line it proves.',
        schema: z.object({ caption: z.string().trim().min(1).max(300).describe('What the picture shows, in a person\'s words.') }),
      },
    ),
    tool(
      async args => answer((await svc()).browserResponses(await key(), args.path_contains)),
      {
        name: 'browser_responses',
        description: 'The network responses the pages received in this run\'s browser (method, address, status, signed in or not), newest last, each with an id: the evidence for a line about an API.',
        schema: z.object({ path_contains: z.string().trim().max(300).optional().describe('Only responses whose address contains this.') }),
      },
    ),
  ];
}
