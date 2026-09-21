import type { ChatMessage } from './types';
import type { ArtifactEntry } from '@/features/dashboard/artifacts/artifactReducer';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import '@/styles/global.css';

/**
 * The transcript, on a phone, in a real browser at a real phone width.
 *
 * The bug this guards (the owner's screenshot, Safari on an iPhone,
 * 2026-09-19): the page was scrolled sideways and stuck there, so every line
 * was cut at BOTH edges — assistant prose starting mid-word, a tool step with
 * no end, the person's own bubble clipped on the right, the thumbs-down half
 * off-screen. The composer was the only thing that looked right.
 *
 * Three independent causes, each with its own answer, and all three are
 * asserted here rather than described:
 *
 * 1. **The stacked split had no column.** `ConversationSplit`'s grid fell back
 *    to an implicit `auto` track, whose floor is the widest item's min-content
 *    — and the transcript's min-content is its own `max-w-3xl` MEASURE plus
 *    its gutters, i.e. 800px. Both panes were laid out 800px wide inside a
 *    390px viewport.
 * 2. **Long unbroken strings.** A URL, an inline id — one word, no break
 *    opportunity, no wrapping rule.
 * 3. **A table.** It cannot wrap: its width is the sum of its columns. So it
 *    scrolls inside its own box instead of pushing the page.
 *
 * `document.scrollingElement.scrollWidth <= clientWidth` is the guard. It is
 * asserted on the document rather than on a wrapper on purpose: the app's page
 * gutter is `overflow-hidden` on this route, which hides the symptom in
 * Chromium while still cutting the content, so a test that measured a wrapper
 * would have gone green on the bug it was written for.
 *
 * `overflow-x: hidden` is deliberately NOT the fix anywhere in this change —
 * it would make this assertion pass while the lines stayed cut.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat/49',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { MessageList } = await import('./MessageList');
const { ConversationSplit } = await import('@/features/dashboard/artifacts/ConversationSplit');
const { ArtifactPane } = await import('@/features/dashboard/artifacts/ArtifactPane');

/** One word, 74 characters, no break opportunity in it anywhere. */
const UNBROKEN = 'NORTHWIND_SEND_BY_EMAIL_FEATURE_PROMISE_ROW_20_PERCENT_SCREENER_2026_Q4';
/** A pasted URL: also one word as far as line breaking is concerned. */
const URL = 'https://northwind.example/product/features/send-by-email?utm_source=proposal&utm_campaign=northwind-hiring-agents-q4-2026&ref=data-room-third-call';
/** A step label the way a search tool actually writes one. */
const STEP_LABEL = 'Searched "Send email document send by email feature promises page third block screener throughput twenty percent"';

const actor = { id: 'lead', kind: 'lead' as const, name: 'Proposal Writer' };

const TRANSCRIPT: ChatMessage[] = [
  {
    role: 'user',
    content: `It's called "send" I really think that should be a clearer word, and check what the product actually promises first — the page is ${URL}`,
  },
  {
    role: 'assistant',
    id: 9002,
    content: '',
    runs: [{
      type: 'text',
      text: [
        `Let me check the product's written promises before I answer. The identifier for that promise row is \`${UNBROKEN}\` and it is stable across versions.`,
        '',
        `Reading the features page, which is where the 20% for the screener sheet came from: ${URL}`,
        '',
        '| Promise | Where it is written | Percent | Identifier |',
        '|---|---|---|---|',
        `| Screener throughput | Features page, third block | 20% | ${UNBROKEN} |`,
      ].join('\n'),
    }],
    trace: [
      { id: 's1', actor, kind: 'search', status: 'done', label: STEP_LABEL, detail: `knowledge_document · ${UNBROKEN}`, tool: 'search_knowledge' },
      { id: 's2', actor, kind: 'tool', status: 'done', label: `Fetched ${URL}`, detail: `200 · text/html · 184 KB · ${UNBROKEN}`, tool: 'fetch_url' },
    ],
    artifacts: [{ id: 52, title: 'Northwind - Hiring Agents Proposal (Metacto) v1.0', kind: 'document', version: 6 }],
  },
];

function documentArtifact(): ArtifactEntry {
  return {
    id: 52,
    kind: 'document',
    title: 'Northwind - Hiring Agents Proposal (Metacto) v1.0',
    version: 6,
    authorKind: 'agent',
    authorId: 'agent:proposal-writer',
    updatedAt: new Date('2026-09-17T10:00:00Z').toISOString(),
    folder: null,
    conversationId: 49,
    messageId: null,
    createdAt: new Date('2026-09-17T09:00:00Z').toISOString(),
    spec: {
      title: 'Northwind - Hiring Agents Proposal (Metacto) v1.0',
      html: '<!doctype html><html><head><title>Northwind — Proposal</title></head><body>'
        + '<article class="sheet"><div class="body"><h1>Northwind starts here.</h1></div></article></body></html>',
      sheets: 5,
    },
  } as ArtifactEntry;
}

/**
 * The surface as the route composes it: the stacked split, the transcript in
 * one pane and the artifact in the other.
 * @param withArtifact - Whether the artifact pane is open beside the transcript.
 */
async function renderSurface(withArtifact: boolean) {
  await render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="flex h-svh min-h-0 flex-col px-4 pt-6">
        <ConversationSplit
          conversation={(
            <div className="flex min-h-0 flex-1 flex-col">
              <MessageList messages={TRANSCRIPT} agentName="Proposal Writer" onFeedback={() => {}} />
            </div>
          )}
          pane={withArtifact ? <ArtifactPane artifact={documentArtifact()} /> : null}
        />
      </div>
    </NextIntlClientProvider>,
  );
}

function overflow() {
  const se = document.scrollingElement!;
  return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
}

describe('the transcript on a phone', () => {
  for (const [w, h] of [[390, 844], [360, 800]] as const) {
    it(`does not scroll the page sideways at ${w}×${h} with the artifact open`, async () => {
      await page.viewport(w, h);
      await renderSurface(true);

      await expect.element(page.getByTestId('message-feedback')).toBeInTheDocument();

      const { scrollWidth, clientWidth } = overflow();

      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      // The two panes stack into ONE column, and the column is the viewport.
      for (const sel of ['[data-conversation-column]', '[data-artifact-pane]']) {
        const el = document.querySelector(sel)!;

        expect(el, sel).not.toBeNull();
        expect(Math.round(el.getBoundingClientRect().width), sel).toBeLessThanOrEqual(clientWidth);
      }
    });

    it(`does not scroll the page sideways at ${w}×${h} with the artifact closed`, async () => {
      await page.viewport(w, h);
      await renderSurface(false);

      await expect.element(page.getByTestId('message-feedback')).toBeInTheDocument();

      const { scrollWidth, clientWidth } = overflow();

      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      // The artifact chip's title is long by nature, and the chip's own
      // `truncate` span is `nowrap` — so without `min-w-0` the chip reported
      // the whole title as the row's min-content and the row grew past the
      // transcript. The transcript's scroller absorbs that, which is why the
      // document-level guard above cannot see it.
      const chips = document.querySelector('[data-artifact-chips]')!;

      expect(chips).not.toBeNull();
      expect(chips.scrollWidth).toBeLessThanOrEqual(chips.clientWidth);
    });
  }

  it('breaks a long unbroken string rather than letting it set the width', async () => {
    await page.viewport(390, 844);
    await renderSurface(false);

    await expect.element(page.getByTestId('message-feedback')).toBeInTheDocument();

    const { clientWidth } = overflow();
    // Every element that holds one of the unbreakable words stays inside the
    // viewport — the words break, so nothing is cut and nothing pushes.
    const holders = [...document.querySelectorAll('p, code, li, div')]
      .filter(el => el.children.length === 0 && (el.textContent ?? '').includes(UNBROKEN));

    expect(holders.length).toBeGreaterThan(0);

    for (const el of holders) {
      expect(Math.round(el.getBoundingClientRect().right)).toBeLessThanOrEqual(clientWidth);
    }
  });

  it('gives a wide table its own scroller instead of pushing the page', async () => {
    await page.viewport(390, 844);
    await renderSurface(false);

    await expect.element(page.getByTestId('message-feedback')).toBeInTheDocument();

    const table = document.querySelector('.prose table')!;

    expect(table).not.toBeNull();

    const box = table.parentElement!;

    expect(getComputedStyle(box).overflowX).toBe('auto');
    expect(Math.round(box.getBoundingClientRect().width)).toBeLessThanOrEqual(overflow().clientWidth);
  });

  it('keeps the per-turn feedback controls fully on screen', async () => {
    await page.viewport(360, 800);
    await renderSurface(true);
    const feedback = page.getByTestId('message-feedback');

    await expect.element(feedback).toBeInTheDocument();

    const row = document.querySelector('[data-testid="message-feedback"]')!;
    const { clientWidth } = overflow();

    for (const button of row.querySelectorAll('button')) {
      const r = button.getBoundingClientRect();

      expect(Math.round(r.left), button.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(0);
      expect(Math.round(r.right), button.getAttribute('aria-label') ?? '').toBeLessThanOrEqual(clientWidth);
    }
  });
});
