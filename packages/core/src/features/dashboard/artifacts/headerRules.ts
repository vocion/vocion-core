/**
 * What an artifact header shows — which tabs, which verbs — as pure rules.
 *
 * There is ONE artifact header (`ArtifactHeader.tsx`) and three surfaces wear
 * it: the preview pane beside a conversation, the artifact's own page, and the
 * full-screen `/open` wrapper for a document. Before this, each assembled its
 * own title row, its own meta strip and its own affordances, so the same verb
 * was drawn three ways and two of the three were missing verbs the third had
 * (Chris, 2026-09-18: *"I don't have any way to switch back to View from
 * HTML"*, *"I want the ability to bring this into a chat window as an open
 * artifact — same as I would from preview pane"*).
 *
 * Design principle 6, one shape used everywhere: a surface that cannot support
 * a verb OMITS it; it never renders a different-looking version of it. That is
 * what `actionsFor` is — the omission list, in one place, testable without a
 * browser.
 */

import type { ArtifactKind } from '@/libs/cards/specs';

/** Where the header is being worn. */
export type ArtifactSurface
  /** Beside a conversation (`/dashboard/chat/<id>?artifact=<id>`) — closable, already in a chat. */
  = | 'pane'
  /** The artifact's own page (`/dashboard/artifacts/<id>`). */
    | 'page'
  /** The document at full screen (`/dashboard/artifacts/<id>/open`) — read-only. */
    | 'open';

export type ArtifactTabId = 'document' | 'html' | 'findings';

export type ArtifactTabDescriptor = {
  id: ArtifactTabId;
  label: string;
  /** The count on the tab, when it has one. `undefined` means no badge. */
  count?: number;
  /** Amber: something on this tab BLOCKS. Nothing else in the header is amber. */
  blocking?: boolean;
};

/** What the tab strip needs to know about the artifact in front of it. */
export type TabInput = {
  kind: ArtifactKind;
  /** Issues from the last render-verify. */
  issues?: number;
  /** Red-team findings worth acting on (`consider` already dropped). */
  findings?: number;
  /** Red-team findings that BLOCK. */
  blocks?: number;
  /** The verify verdict, when there is one. */
  verified?: boolean;
  /** Looking at an older version: it is read-only, so there is nothing to hand-edit. */
  historical?: boolean;
};

/**
 * The tabs this artifact shows, in order; the first is the default.
 *
 * Only a `document` has more than one view of itself — the rendered sheets,
 * the HTML behind them, and what the render-verify and the sceptical read
 * found. Every other kind is one view, so it gets no tab strip at all rather
 * than a strip with one tab in it, which would be chrome that decides nothing.
 *
 * Findings is always present for a document, empty or not: a strip whose tabs
 * come and go cannot be learned, and "nothing to answer" is a thing a person
 * wants to be able to check (design principle 10).
 * @param input - The artifact, and what the last verify and red team found.
 */
export function tabsFor(input: TabInput): ArtifactTabDescriptor[] {
  if (input.kind !== 'document') {
    return [];
  }
  const count = (input.issues ?? 0) + (input.findings ?? 0);
  const blocking = (input.blocks ?? 0) > 0 || input.verified === false;
  return [
    { id: 'document', label: 'Document' },
    ...(input.historical ? [] : [{ id: 'html' as const, label: 'HTML' }]),
    { id: 'findings', label: 'Findings', count, blocking },
  ];
}

/**
 * The tab to show, given what this browser last had open for this artifact and
 * what the artifact can actually show now. A remembered tab that no longer
 * exists (HTML, on a version you are reading historically) falls back to the
 * first — never to a blank panel.
 * @param tabs - What `tabsFor` returned.
 * @param remembered - What `readStoredTab` found, or null.
 */
export function resolveTab(tabs: ArtifactTabDescriptor[], remembered: ArtifactTabId | null): ArtifactTabId {
  const first = tabs[0]?.id ?? 'document';
  return remembered && tabs.some(t => t.id === remembered) ? remembered : first;
}

export type ArtifactActionId
  /** The version menu. */
  = | 'history'
  /** Write the pending edit as the next version. */
    | 'save'
  /** Export as a workspace page. */
    | 'export'
  /** Copy link / share audience. */
    | 'share'
  /** Open the conversation this came out of, with the artifact beside it. */
    | 'chat'
  /** The PDF the renderer printed. */
    | 'pdf'
  /** The document at full screen. */
    | 'open'
  /** Give the column back. */
    | 'close';

export type ActionInput = {
  kind: ArtifactKind;
  /** There is an unsaved edit. */
  dirty?: boolean;
  /** The renderer printed a PDF for this version. */
  hasPdf?: boolean;
  /** The surface gave us something to close back to. */
  closable?: boolean;
};

/**
 * The verbs this surface shows for this artifact, in the order they are drawn.
 *
 * The omissions are the content of this function:
 *
 * - **`chat` is not on the pane** — the pane IS a conversation with the
 *   artifact open beside it. A button that puts you where you are standing is
 *   a lie about what it does.
 * - **`close` is only on the pane** — a page has no column to give back; the
 *   browser's Back is the way out of a page.
 * - **`pdf` / `open` are the document's**, on every surface that has one,
 *   because they are the two things a person does with a finished document.
 * - **`open` is not on `/open`** — that is the surface it opens.
 * - **`history`, `save`, `export`, `share` need the pane's state**, which
 *   `/open` does not have: it is a read of one version at full screen, and
 *   offering Save there would mean building a second editor.
 * @param surface - Where the header is being worn.
 * @param input - The artifact, and what it can do right now.
 */
export function actionsFor(surface: ArtifactSurface, input: ActionInput): ArtifactActionId[] {
  const isDocument = input.kind === 'document';
  if (surface === 'open') {
    return [
      'chat',
      ...(isDocument && input.hasPdf ? (['pdf'] as const) : []),
    ];
  }
  return [
    ...(input.dirty ? (['save'] as const) : []),
    'history',
    ...(surface === 'page' ? (['chat'] as const) : []),
    ...(isDocument && input.hasPdf ? (['pdf'] as const) : []),
    ...(isDocument ? (['open'] as const) : []),
    'export',
    'share',
    ...(surface === 'pane' && input.closable ? (['close'] as const) : []),
  ];
}

/**
 * Where "Open in chat" goes, from any surface.
 *
 * The artifact's own conversation when it has one — the route already exists
 * and already opens the artifact beside the transcript. When it has none (a
 * mission file, an import, a thread that was deleted) the same verb starts a
 * FRESH chat with the artifact as its subject, carried in the
 * `stashChatAbout` handoff the preview pane's "Chat about this" already uses.
 * One verb, one label, one icon, two destinations — never two buttons.
 * @param artifactId
 * @param conversationId - The conversation the artifact came out of, or null.
 */
export function openInChatTarget(artifactId: number, conversationId: number | null | undefined): { href: string; stashAbout: boolean } {
  return conversationId
    ? { href: `/dashboard/chat/${conversationId}?artifact=${artifactId}`, stashAbout: false }
    : { href: '/dashboard/chat?new=1', stashAbout: true };
}

const TAB_STORAGE_PREFIX = 'vocion_artifact_tab:';

/**
 * What this browser last had open for this artifact. Storage can throw
 * outright (a private window, a thumbnail capture, site data blocked), so
 * every read and write is guarded and an unavailable store simply means the
 * default tab.
 * @param artifactId
 */
export function readStoredTab(artifactId: number): ArtifactTabId | null {
  try {
    const raw = localStorage.getItem(`${TAB_STORAGE_PREFIX}${artifactId}`);
    return raw === 'document' || raw === 'html' || raw === 'findings' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Remember the tab for this artifact.
 * @param artifactId
 * @param tab
 */
export function writeStoredTab(artifactId: number, tab: ArtifactTabId): void {
  try {
    localStorage.setItem(`${TAB_STORAGE_PREFIX}${artifactId}`, tab);
  } catch {
    /* storage unavailable — the tab is simply not remembered */
  }
}
