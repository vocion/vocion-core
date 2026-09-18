/**
 * The ONE function every agent-surface entry point goes through
 * (agent-chat-surface.md §6): the hotkey, a titlebar control, the rail, and
 * a record page's own affordances all call `requestAgentSurface()` instead of
 * reaching for a particular surface. A page that already carries a surface
 * (the dock on a record page, the shell on /dashboard/chat, the floating
 * bubble elsewhere) claims the request by cancelling the event and focuses
 * itself; an unclaimed request means no surface is mounted and the caller
 * falls back to navigating to the everything-scoped chat page.
 *
 * R4 (act from context): a request may carry INTENT — a prompt to prefill,
 * the page/record context it is about, and whether to send at once. The
 * detail rides on the same event; a surface that claims it reads
 * `event.detail` and does the prefill/attach/send. `openAgentSurface()` is
 * the convenience wrapper that also handles the unclaimed case by stashing a
 * handoff and navigating, so an "Ask about this" button never needs to know
 * which surface is on the page.
 */

import type { ContextRef } from './types';
import type { PageContext } from '@/services/chat/pageContext';

export const AGENT_SURFACE_EVENT = 'vocion:open-agent-surface';

/** sessionStorage key the chat page reads on mount to start a handoff chat. */
export const CHAT_HANDOFF_KEY = 'vocion_chat_handoff';

/** The handoff the full-page chat consumes when no surface was mounted to claim a request. */
export type ChatHandoff = {
  question: string;
  contextTitle: string;
  context: string;
  /** Optional highlighted excerpt the question is specifically about. */
  excerpt?: string;
  /** Agent to answer — the record's team lead when the caller knows it. */
  agentSlug?: string;
  /** Structured context, carried so the first turn is filed with it (R4). */
  pageContext?: PageContext;
};

export type AgentSurfaceRequest = {
  /** Text to prefill the composer with. */
  prompt?: string;
  /** Where the request came from — attached to the next turn as `page_context`. */
  context?: PageContext;
  /** Send `prompt` immediately instead of leaving it in the composer. */
  send?: boolean;
  /** Prefer this agent for the turn (a briefing's team lead, a team's lead). */
  agentSlug?: string;
  /**
   * Composer tags the affordance armed — today `@change`, from the selection
   * control on a page with a sequence draft in view. The surface adds them
   * as chips, exactly as if the person had typed the word: one mechanism, two
   * ways in (Manifesto §19, and `composerTags.ts`).
   */
  tags?: ContextRef[];
  /**
   * Start over: the surface forgets the current thread and the next send
   * opens a fresh one — ⌘⇧O, `/new`, the palette's New chat, the ⋯ menu.
   * Unclaimed, the caller navigates to `/dashboard/chat?new=1`.
   */
  newChat?: boolean;
  /**
   * Treat the request as a toggle: a mounted surface that is already open,
   * and has no intent to apply, collapses instead of re-focusing. The
   * titlebar control sends this so one button both opens and closes the rail
   * (the same semantics as ⌘J). A surface that IS the page (the full-page
   * chat) ignores it — there is nothing to collapse.
   */
  toggle?: boolean;
  /**
   * What the drawer is scoped to, in the person's own words: *Ask about
   * brief*, *Editing Send 2*, *Discuss recommendation*
   * (`docs/specs/personalization-v2.md`).
   *
   * Scope is not a second panel and not a second conversation — it is one
   * line in the rail's header naming the subject, so "make this less salesy"
   * has an unambiguous referent instead of the person hoping the model knows
   * which of three artifacts they meant. It is cleared by the turn that
   * consumes it, exactly as the rest of the intent is.
   */
  scope?: { label: string };
  /**
   * Long-form text the fallback path carries into the first message when no
   * surface claims the request (the briefing body today). A mounted surface
   * ignores it — the model reaches the record through `page_context`.
   */
  fallbackContext?: string;
};

/**
 * Ask whatever agent surface is mounted on this page to open and take focus,
 * optionally with a prompt and the context it is about.
 * @param opts - Intent for the surface; omit to just open it.
 * @returns true when a mounted surface claimed the request; false when the
 * caller should navigate to /dashboard/chat instead.
 */
export function requestAgentSurface(opts?: AgentSurfaceRequest): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const event = new CustomEvent<AgentSurfaceRequest>(AGENT_SURFACE_EVENT, { cancelable: true, detail: opts ?? {} });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Read the intent off a claimed request. Surfaces call this in their
 * `AGENT_SURFACE_EVENT` listener; a plain (legacy) request yields `{}`.
 * @param e - The event the listener received.
 */
export function agentSurfaceRequestOf(e: Event): AgentSurfaceRequest {
  const detail = (e as CustomEvent<AgentSurfaceRequest | undefined>).detail;
  return detail && typeof detail === 'object' ? detail : {};
}

/**
 * Open the agent surface with intent, wherever the person is. A mounted
 * surface claims it synchronously (the event is cancelable, so there is
 * nothing to wait for); otherwise the request is stashed as a handoff and
 * the caller's `navigate` takes the person to the full-page chat, which
 * reads the stash on mount and starts the turn — the pre-R4 path, kept.
 * @param opts - Intent.
 * @param navigate - Router push, injected so this stays hook-free.
 * @returns 'claimed' when a surface took it, 'navigated' when we fell back.
 */
export function openAgentSurface(opts: AgentSurfaceRequest, navigate: (href: string) => void): 'claimed' | 'navigated' {
  if (requestAgentSurface(opts)) {
    return 'claimed';
  }
  const question = opts.prompt?.trim() ?? '';
  const handoff: ChatHandoff = {
    question,
    contextTitle: opts.context?.record?.label ?? opts.context?.title ?? '',
    context: opts.fallbackContext ?? '',
    excerpt: opts.context?.selection?.text,
    agentSlug: opts.agentSlug,
    pageContext: opts.context,
  };
  try {
    if (question || handoff.context || handoff.pageContext) {
      sessionStorage.setItem(CHAT_HANDOFF_KEY, JSON.stringify(handoff));
    }
  } catch {
    /* storage unavailable — the prompt still travels on the URL */
  }
  const params = new URLSearchParams();
  if (opts.agentSlug) {
    params.set('agent', opts.agentSlug);
  }
  if (question && !opts.send) {
    params.set('prompt', question);
  }
  const qs = params.toString();
  navigate(`/dashboard/chat${qs ? `?${qs}` : ''}`);
  return 'navigated';
}

/**
 * Focus the agent composer inside a container (every surface marks its
 * textarea with `data-agent-composer`). Retries across a few frames because
 * a surface that just opened (the bubble's panel, an un-collapsed dock) may
 * not have rendered its composer on the first one.
 * @param container - The surface's root element, or null to search the page.
 */
export function focusAgentComposer(container: HTMLElement | null): void {
  let attempts = 12;
  const tryFocus = () => {
    const el = (container ?? document).querySelector<HTMLTextAreaElement>('[data-agent-composer]');
    if (el) {
      el.focus();
      return;
    }
    attempts -= 1;
    if (attempts > 0) {
      requestAnimationFrame(tryFocus);
    }
  };
  requestAnimationFrame(tryFocus);
}
