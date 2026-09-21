import type { ArtifactEntry } from './artifactReducer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The artifact pane's tab strip, in a real browser.
 *
 * What is being asserted is the thing the owner could not do: **leave**. The
 * HTML view was a one-way `beginEdit` button with no visible way back to the
 * rendered document (Chris, 2026-09-18: *"I don't have any way to switch back
 * to View from HTML"*), and the verify issues and the buyer's findings were
 * two amber blocks pushing the document down the pane rather than a tab you
 * open when you want them.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  // The header links out to a chat and to the full-screen document; a plain
  // anchor is all the strip needs to be tested.
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/artifacts/251',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { ArtifactPane } = await import('./ArtifactPane');

const HTML = '<!doctype html><html><head><title>Northwind — Proposal v1</title></head><body>'
  + '<div class="actions"><a href="#" onclick="window.print()">⤓ PDF</a></div>'
  + '<article class="sheet"><div class="strip"><span class="l">Cover</span></div><div class="body"><h1>Northwind starts here.</h1></div></article>'
  + '</body></html>';

function documentArtifact(over: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    id: 251,
    kind: 'document',
    title: 'Northwind — Proposal',
    version: 3,
    authorKind: 'agent',
    authorId: 'agent:revenue-lead',
    updatedAt: new Date().toISOString(),
    folder: null,
    conversationId: 132,
    messageId: null,
    spec: {
      title: 'Northwind — Proposal',
      html: HTML,
      sheets: 1,
      verification: {
        at: new Date().toISOString(),
        ok: true,
        footerAligned: true,
        sheets: [{ n: 1, label: 'Cover', footerY: 984, overflowPx: 0, clipped: [] }],
        issues: [],
        pdfPages: 7,
        pdf: '/api/artifacts/251/proposal.pdf',
        unresolvedAssets: [],
      },
      redTeam: {
        at: new Date().toISOString(),
        version: 3,
        model: 'test',
        sheets: 1,
        blocks: 1,
        fixes: 1,
        considers: 4,
        findings: [
          { sheet: 2, severity: 'block', rule: 'outcome promised', finding: 'The outcome is not named.', fix: 'Name the outcome and its owner.' },
          { sheet: 3, severity: 'fix', rule: 'price shown', finding: 'The price appears twice.', fix: 'Keep the table.' },
          { sheet: 4, severity: 'consider', rule: 'tone', finding: 'Reads a little formal.', fix: 'Loosen it.' },
        ],
      },
    },
    ...over,
  } as ArtifactEntry;
}

function forget() {
  try {
    localStorage.removeItem('vocion_artifact_tab:251');
  } catch {
    /* storage unavailable — the default tab is what we get, which is fine */
  }
}

describe('the artifact pane tab strip', () => {
  beforeEach(forget);

  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(name) });

  it('opens on the rendered document, with HTML and Findings beside it', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');
    await expect.element(tab('HTML')).toHaveAttribute('aria-selected', 'false');
    await expect.element(tab('Findings')).toHaveAttribute('aria-selected', 'false');
    // The document itself is what is on screen, in its own frame.
    expect(document.querySelector('[data-document-iframe]')).not.toBeNull();
  });

  it('counts the verify issues and the buyer findings that matter, and drops `consider`', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    // 2 actionable findings (the `consider` is not one), 0 verify issues.
    await expect.element(tab('Findings')).toHaveTextContent('2');
  });

  it('switches to HTML and back to Document — the way out the button never had', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    await tab('HTML').click();

    // The hand-edit view: the document's HTML in a textarea, Save in the header.
    await expect.element(page.getByRole('textbox', { name: 'Artifact body (markdown)' })).toBeVisible();
    await expect.element(tab('HTML')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-document-iframe]')).toBeNull();

    await tab('Document').click();

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-document-iframe]')).not.toBeNull();
  });

  it('puts the findings on their own tab instead of above the document', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    // Nothing amber is stacked over the document before you ask for it.
    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-document-findings]')).toBeNull();

    await tab('Findings').click();

    await expect.element(page.getByText('The outcome is not named.')).toBeVisible();
    expect(document.querySelector('[data-document-iframe]')).toBeNull();
  });

  it('says so plainly when there is nothing to answer', async () => {
    const clean = documentArtifact();
    (clean.spec as { redTeam?: unknown }).redTeam = { at: new Date().toISOString(), version: 3, model: 'test', sheets: 1, blocks: 0, fixes: 0, considers: 0, findings: [] };
    render(<ArtifactPane artifact={clean} surface="page" />);

    await tab('Findings').click();

    await expect.element(page.getByText('Nothing to answer.')).toBeVisible();
  });

  it('walks the strip with the arrow keys', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    (document.querySelector('[data-artifact-tab="document"]') as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(tab('HTML')).toHaveAttribute('aria-selected', 'true');
  });

  it('remembers the tab per artifact in this browser', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    await tab('Findings').click();

    await expect.element(tab('Findings')).toHaveAttribute('aria-selected', 'true');

    expect(localStorage.getItem('vocion_artifact_tab:251')).toBe('findings');
  });

  it('shows the quiet meta line — the sheet count and the verdict, nothing else', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-document-state]')?.textContent).toBe('1 sheet · verified');
    // The red-team chip is gone from the strip; it is the Findings badge now.
    expect(document.querySelector('[data-document-red-team]')).toBeNull();
    // And `PDF 7 pages` is the PDF action's tooltip, not a third chip.
    expect(document.body.textContent).not.toContain('PDF 7 pages');
  });

  it('offers "Open in chat" from the artifact page, pointed at the thread it came from', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" conversationId={132} />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-artifact-open-in-chat]')?.getAttribute('href')).toBe('/dashboard/chat/132?artifact=251');
  });

  it('starts a fresh chat when the artifact came out of no conversation', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="page" conversationId={null} />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-artifact-open-in-chat]')?.getAttribute('href')).toBe('/dashboard/chat?new=1');
  });

  it('never offers it from the pane, which IS a chat with this open beside it', async () => {
    render(<ArtifactPane artifact={documentArtifact()} surface="pane" conversationId={132} onClose={() => {}} />);

    await expect.element(tab('Document')).toHaveAttribute('aria-selected', 'true');

    expect(document.querySelector('[data-artifact-open-in-chat]')).toBeNull();
    // …and it keeps the verb a page cannot have.
    expect(document.querySelector('[aria-label="Close the artifact"]')).not.toBeNull();
  });
});

/**
 * A mission's YAML and a playbook's SKILL.md wear the same pane a document
 * does (`libs/workspace/source.ts`): a person edits the FILE in place, every
 * save is a version, and highlighting a passage offers Ask and Change.
 */
const MISSION_YAML = 'slug: keep-main-releasable\nname: Keep main releasable\ngoal: Every merge to main ships.\nagent: release-lead\nsuccessCriteria:\n  - main is green at 09:00\n';

function missionArtifact(): ArtifactEntry {
  return {
    id: 252,
    kind: 'mission',
    title: 'Keep main releasable',
    version: 1,
    authorKind: 'system',
    authorId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    folder: 'workspace/missions',
    conversationId: null,
    messageId: null,
    recordType: 'mission',
    recordId: 'keep-main-releasable',
    recordRole: 'source',
    spec: { slug: 'keep-main-releasable', yaml: MISSION_YAML },
  } as ArtifactEntry;
}

function markdownArtifact(): ArtifactEntry {
  return {
    id: 253,
    kind: 'markdown',
    title: 'Notes',
    version: 1,
    authorKind: 'agent',
    authorId: 'agent:revenue-lead',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    folder: null,
    conversationId: null,
    messageId: null,
    spec: { md: '# Notes\n\nA plan the agent wrote, long enough to highlight a passage of.' },
  } as ArtifactEntry;
}

/**
 * Highlight the text of one element the way a person's drag would, and let
 * the selection watcher see it (it listens for mouseup on the document).
 * @param el
 */
async function highlight(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await new Promise(r => requestAnimationFrame(() => r(null)));
}

describe('a mission or a playbook in the artifact pane', () => {
  it('renders the charter from the YAML and offers Edit — but not Rename, since the title is the file\'s name', async () => {
    render(<ArtifactPane artifact={missionArtifact()} surface="page" />);

    await expect.element(page.getByText('Every merge to main ships.')).toBeVisible();

    expect(document.querySelector('[data-mission-card="charter"]')).not.toBeNull();
    expect(document.querySelector('[data-artifact-edit]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Rename this artifact"]')).toBeNull();
  });

  it('Edit opens the file itself in the plain editor, and Save appears', async () => {
    render(<ArtifactPane artifact={missionArtifact()} surface="page" />);

    await page.getByRole('button', { name: 'Edit in place' }).click();

    const box = page.getByRole('textbox', { name: 'Mission file (YAML)' });

    await expect.element(box).toBeVisible();
    await expect.element(box).toHaveValue(MISSION_YAML);
    await expect.element(page.getByText(/applies the workspace/)).toBeVisible();
    // The way in is gone while there is something to save; the way out is Esc.
    expect(document.querySelector('[data-artifact-edit]')).toBeNull();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByText('Every merge to main ships.')).toBeVisible();
  });

  it('gives markdown the same door — it had an editor and no way into it', async () => {
    render(<ArtifactPane artifact={markdownArtifact()} surface="page" />);

    await page.getByRole('button', { name: 'Edit in place' }).click();

    await expect.element(page.getByRole('textbox', { name: 'Artifact body (markdown)' })).toBeVisible();
  });

  it('highlighting a passage offers Ask and Change', async () => {
    render(<ArtifactPane artifact={missionArtifact()} surface="page" />);

    await expect.element(page.getByText('Every merge to main ships.')).toBeVisible();

    await highlight(document.querySelector('[data-mission-card="charter"] section p')!);

    const toolbar = page.getByRole('toolbar', { name: 'Selected passage' });

    await expect.element(toolbar).toBeVisible();
    await expect.element(toolbar.getByRole('button', { name: 'Ask' })).toBeVisible();
    await expect.element(toolbar.getByRole('button', { name: 'Change' })).toBeVisible();
  });
});
