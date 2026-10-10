'use client';

import type { TurnOutcome } from './queueReducer';
import type { AgentOption, AgentRun, ChatAttachment, ChatMessage, ChatMessageArtifact, ContextRef, ConversationAutonomy, DecisionAnswerReceipt, IndexedDocument, PendingUpload, RecommendedAction, SelfUpdateReceipt, StreamingPhase, TraceNode, TurnEffort, TurnModel } from './types';
import type { VersionWritten } from '@/features/dashboard/versions/versionEvents';
import type { ConversationTitleSource } from '@/libs/chat/threadTitle';
import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import type { DoneReceipt } from '@/libs/decisions/receipt';
import type { TurnRecord } from '@/libs/factory/liveStatus';
import type { EffortLevel, ModelPrefs } from '@/libs/llm/modelPrefs';
import type { RoutingDecision } from '@/services/agents/router';
import type { PageContext, RecordRef } from '@/services/chat/pageContext';
import type { TurnStatus } from '@/services/chat/turnStatus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONNECT_SYSTEMS_FINISHED_EVENT, startConnectSystems } from '@/features/dashboard/connect-systems/launch';
import { announceSetupChanged } from '@/features/dashboard/setupChanged';
import { announceVersionWritten } from '@/features/dashboard/versions/versionEvents';
import { openPreview } from '@/features/preview/previewState';
import { useLastViewedConversation } from '@/hooks/useLastViewedConversation';
import { mergeSelfUpdate } from '@/libs/actions/selfUpdate';
import { MAX_ATTACHMENTS, refusalFor } from '@/libs/chat/attachmentFormats';
import { deliverableFromRefs, isArtifactTag } from '@/libs/chat/deliverable';
import { linkRecordMentions } from '@/libs/chat/recordMentions';
import { firstMessageTitle } from '@/libs/chat/threadTitle';
import { nounCode } from '@/libs/codes';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { answerLine, decisionAnswerWire, decisionKey } from '@/libs/decisions/decision';
import { readDoneReceipt } from '@/libs/decisions/receipt';
import { DEFAULT_MODEL_PREFS, readModelPrefs } from '@/libs/llm/modelPrefs';
import { client } from '@/libs/Orpc';
import { shrinkImage, uploadAttachments } from './attachmentUpload';
import { DEFAULT_AUTONOMY } from './autonomyOptions';
import { opensPreviewOnItsOwn } from './autoOpen';
import { isIntentTag } from './composerTags';
import { decideResume, readSessionConversation, writeSessionConversation } from './resumeRule';
import { agentDisplayName, defaultAgentSlug, hasWorkspaceAgents, parseSearchCommand, routeTurn, SEARCH_ONLY_SLUG, workspaceChips } from './routing';
import { failToolNode, finalizeTrace, liveStepLabel, mergeTraceNode, noteToolProgress } from './traceReducer';
import { useSendQueue } from './useSendQueue';
import { describeToolCall } from './WorkTimeline';

/* ----------------------------------------------------------------- */
/* Active-conversation persistence                                     */
/*                                                                     */
/* The conversation itself is persisted server-side (Postgres is the   */
/* system of record). To RESUME it after navigating away and back we   */
/* only need to remember WHICH thread was active. That pointer lives   */
/* in two places on purpose:                                           */
/*                                                                     */
/*   - localStorage, per agent — synchronous, so the boot sequence can  */
/*     decide what to show without waiting on the network.             */
/*   - the `chat_widget_state` row (see useLastViewedConversation) —    */
/*     one pointer per user, so the floating bubble and the full page   */
/*     resume the same thread, and so a different browser or device     */
/*     picks up where the last one left off.                           */
/*                                                                     */
/* Both are RECENT pointers, not the current thread (§9, 2026-09-15): a  */
/* surface opens a NEW conversation unless this browser session was     */
/* already in one (sessionStorage) or the URL names one. See           */
/* resumeRule.ts. The pointers still seed the agent and the history.   */
/* ----------------------------------------------------------------- */

const ACTIVE_CONVERSATION_KEY = 'vocion:chat:active:';

function writeActiveConversation(agentSlug: string, id: number): void {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY + agentSlug, String(id));
  } catch (error) {
    // private mode / storage disabled — resume just won't persist
    console.warn('useChatSession: could not save the active conversation to localStorage', error);
  }
}

function clearActiveConversation(agentSlug: string): void {
  try {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY + agentSlug);
  } catch (error) {
    console.warn('useChatSession: could not clear the active conversation in localStorage', error);
  }
}

/**
 * Active mid-turn stream (resumable): survives refresh so we can replay
 *  missed events + re-attach live via /rpc/agent/stream/resume.
 */
const STREAM_STASH_KEY = 'vocion:chat:activestream';

/**
 * `conversationId` is what a remount matches on. The agent slug alone missed
 * (#201's dock, 2026-09-29): the dock sends as the workspace lead, the server
 * routes the turn to the product manager, and the returning dock boots as the
 * product manager — the slugs differ and the running answer was dropped.
 */
type StreamStash = { streamId: string; agentSlug: string; count: number; conversationId?: number | null };

function readStreamStash(): StreamStash | null {
  try {
    const raw = sessionStorage.getItem(STREAM_STASH_KEY);
    return raw ? JSON.parse(raw) as StreamStash : null;
  } catch (error) {
    console.warn('useChatSession: could not read the resumable stream handle', error);
    return null;
  }
}

function writeStreamStash(stash: StreamStash | null): void {
  try {
    if (stash) {
      sessionStorage.setItem(STREAM_STASH_KEY, JSON.stringify(stash));
    } else {
      sessionStorage.removeItem(STREAM_STASH_KEY);
    }
  } catch (error) {
    console.warn('useChatSession: could not save the resumable stream handle', error);
  }
}

/**
 * The autonomy rung the person last chose — carried into the NEXT new
 * conversation so the choice survives "New chat" (0094).
 */
const AUTONOMY_KEY = 'vocion:chat:autonomy';

function readPreferredAutonomy(): ConversationAutonomy {
  try {
    const stored = localStorage.getItem(AUTONOMY_KEY);
    // Either rung the person chose stands; nothing stored means the default
    // (done for you since 2026-09-18 — the old code read a missing value as
    // 'ask' and every fresh thread vetoed the done-for-you policy).
    return stored === 'ask' || stored === 'act-within-bounds' ? stored : DEFAULT_AUTONOMY;
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

function writePreferredAutonomy(a: ConversationAutonomy): void {
  try {
    localStorage.setItem(AUTONOMY_KEY, a);
  } catch {
    /* storage unavailable */
  }
}

/** One persisted conversation row, as the conversations router returns it. */
type PersistedMessageRow = {
  id?: number;
  /** `decision`: a person's answer to a Decision given on its card — drawn as a receipt, never as their words. */
  role: 'user' | 'assistant' | 'decision';
  content: string;
  runsJson: unknown;
  documentsJson: unknown;
  traceJson?: unknown;
  confidence: ChatMessage['confidence'];
  /** How the turn ended (`services/chat/turnStatus.ts`); null on a row written before that vocabulary. */
  status?: string | null;
  /** Why it ended that way, in the runtime's own words; null on an ordinary turn. */
  statusReason?: string | null;
  feedbackRating?: string | null;
  feedbackNote?: string | null;
  /** Files attached to a user turn, as the conversations router resolves them. */
  attachments?: ChatAttachment[];
  /** Artifacts the turn produced, as the conversations router resolves them — the chips. */
  artifacts?: ChatMessageArtifact[];
  /** Which agent spoke an assistant turn, as the runtime stamped it (backlog 009); null before the column existed. */
  agentSlug?: string | null;
};

/**
 * Rebuilds the in-memory transcript from persisted rows, and collects the
 * cited sources so inline `[n]` citations still resolve and the Sources
 * drawer repopulates after a reload.
 * @param rows - Persisted message rows, oldest first.
 * @param nameOf
 */
function hydrateTranscript(rows: PersistedMessageRow[], nameOf: (slug: string) => string): { messages: ChatMessage[]; documents: IndexedDocument[] } {
  const documents: IndexedDocument[] = [];
  const messages: ChatMessage[] = rows.map((row) => {
    const runsRaw = Array.isArray(row.runsJson) ? (row.runsJson as AgentRun[]) : [];
    const runs = runsRaw.length > 0
      // A stored `state` wins: a step that failed must still read as failed
      // after a reload. Only a step that stored none is assumed to have landed.
      ? runsRaw.map(run => (run.type === 'tool' ? { ...run, state: run.state ?? ('done' as const) } : run))
      : (row.role === 'assistant' && row.content ? [{ type: 'text' as const, text: row.content }] : undefined);
    const docs = Array.isArray(row.documentsJson) ? (row.documentsJson as IndexedDocument[]) : undefined;
    if (docs) {
      documents.push(...docs);
    }
    const trace = Array.isArray(row.traceJson) ? (row.traceJson as TraceNode[]) : undefined;
    const rating = row.feedbackRating === 'up' || row.feedbackRating === 'down' ? row.feedbackRating : null;
    // The cards a turn put up come back from the row (backlog 025): a card
    // is not a client-side ornament that a reload forgets.
    const recommendations: RecommendedAction[] = runsRaw
      .filter((r): r is Extract<AgentRun, { type: 'card' }> => r.type === 'card' && typeof r.label === 'string' && r.label.length > 0 && typeof r.actionId === 'string')
      .map(r => ({ ...(r.id ? { id: r.id } : {}), actionId: r.actionId, input: r.input ?? {}, label: r.label, ...(r.runId !== undefined ? { runId: r.runId } : {}), ...(typeof r.href === 'string' && r.href.startsWith('/') ? { href: r.href } : {}), state: (r.state as RecommendedAction['state']) ?? (r.runId !== undefined ? 'filed' : 'proposed') }));
    // A Decision's answer comes back as the receipt it was, on the person's
    // side: a card's answer is a row of its own with no words; typed words
    // that answered keep their bubble and carry the line beneath it.
    const answered = runsRaw.find((r): r is Extract<AgentRun, { type: 'decision_answer' }> => r.type === 'decision_answer');
    const decisionAnswer: DecisionAnswerReceipt | undefined = answered
      ? { id: answered.id, question: answered.question, line: answered.line, kind: answered.answer.kind, via: answered.via ?? (row.role === 'decision' ? 'card' : 'composer') }
      : undefined;
    // What the turn did inside the trust bar, said once, with honest Undo.
    const receipts: DoneReceipt[] = runsRaw
      .filter((r): r is Extract<AgentRun, { type: 'receipt' }> => r.type === 'receipt')
      .map(r => readDoneReceipt(r.receipt))
      .filter((r): r is DoneReceipt => r !== null);
    // The follow-ups the turn ended with, drawn again after a reload.
    const suggested = runsRaw.find((r): r is Extract<AgentRun, { type: 'suggestions' }> => r.type === 'suggestions');
    // A brief read aloud rides its message: the player is drawn under it.
    const audio = runsRaw.find((r): r is Extract<AgentRun, { type: 'audio' }> => r.type === 'audio' && r.ref?.type === 'briefing' && typeof r.ref.id === 'number');
    if (row.role === 'decision') {
      return {
        ...(typeof row.id === 'number' ? { id: row.id } : {}),
        role: 'user' as const,
        content: '',
        ...(decisionAnswer ? { decisionAnswer } : {}),
      };
    }
    return {
      ...(typeof row.id === 'number' ? { id: row.id } : {}),
      role: row.role,
      content: row.content ?? '',
      ...(decisionAnswer && row.role === 'user' ? { decisionAnswer } : {}),
      ...(receipts.length > 0 && row.role === 'assistant' ? { receipts } : {}),
      ...(suggested && suggested.items.length > 0 && row.role === 'assistant' ? { suggestions: suggested.items } : {}),
      ...(audio && row.role === 'assistant' ? { listen: audio.ref } : {}),
      ...(row.role === 'assistant' && (rating || row.feedbackNote) ? { feedback: { rating, note: row.feedbackNote ?? null } } : {}),
      ...(runs ? { runs } : {}),
      ...(recommendations.length > 0 ? { recommendations } : {}),
      ...(docs && docs.length > 0 ? { documents: docs } : {}),
      ...(trace && trace.length > 0 ? { trace } : {}),
      ...(row.confidence ? { confidence: row.confidence } : {}),
      // How the turn ended has to survive the reload — a fragment looks like
      // an answer otherwise, and a refusal looks like a fault (#114).
      ...(row.status ? { status: row.status as TurnStatus } : {}),
      ...(row.statusReason ? { statusReason: row.statusReason } : {}),
      ...(row.attachments && row.attachments.length > 0 ? { attachments: row.attachments } : {}),
      ...(row.artifacts && row.artifacts.length > 0 ? { artifacts: row.artifacts } : {}),
      // Who spoke, from the row — so "via <specialist>" survives a reload and
      // says the same thing it said live (backlog 009).
      ...(row.role === 'assistant' && row.agentSlug ? { agentSlug: row.agentSlug, agentName: nameOf(row.agentSlug) } : {}),
    };
  });
  return { messages, documents };
}

/** The browser's IANA zone, or undefined where Intl cannot say (the server then uses the workspace's). */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export type UseChatSessionOptions = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Pre-fills the composer without sending. */
  initialComposerValue?: string;
  /** Files already uploaded (a share from the phone, `?attach=`) that start in the composer as chips. */
  initialAttachments?: ChatAttachment[];
  /** Workspace-scoped empty-state chips, used while no specific agent is picked. */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Empty-state greeting: org eyebrow + "Ask <workspace>". */
  greeting?: { eyebrow?: string; workspace: string };
  /**
   * Scopes the session to one record (CRM mirror ref, e.g. `contacts:9412`) —
   * the dock's mode. Scoped sessions resume the current user's latest
   * conversation FOR THIS RECORD instead of the global last-viewed pointer,
   * create conversations carrying the scope, and never write the global
   * pointers, so the dock and the full-page chat cannot steal each other's
   * threads.
   */
  scopeRef?: string;
  /**
   * Where the person is when they ask (058): the everything-scoped dock off a
   * record page sends the route and its title with each turn, so an
   * unqualified question is answered about the page. A scoped session never
   * sets this; the scope already says what the conversation is about.
   */
  pageContext?: PageContext;
  /**
   * A thread the URL names (`?conversation=<id>`): the one case besides a
   * same-session return where a surface resumes instead of starting fresh
   * (§9). Null/undefined = decide from the session alone.
   */
  resumeConversationId?: number | null;
  /**
   * Extension seam for other surfaces (the canvas's `artifact` event, for
   * one): called with every SSE event BEFORE the built-in reducer. Return
   * true to claim the event and skip the default handling. `api` exposes the
   * same primitives the built-in cases use, so an extension can fold state
   * into the latest assistant message without editing this file.
   */
  onEvent?: (evt: { type: string; [k: string]: unknown }, api: ChatSessionEventApi) => boolean | undefined;
};

/** What an `onEvent` extension may do to the transcript. */
export type ChatSessionEventApi = {
  /** Replace the latest assistant message (no-op when the last message is the user's). */
  appendToLatestAgent: (mutate: (m: ChatMessage) => ChatMessage) => void;
  /** Fold any buffered text/trace deltas into state first, to keep ordering. */
  flushDeltas: () => void;
  /** Set the live activity line ("Rendering table…"); null clears it. */
  setActivity: (text: string | null) => void;
  /** The turn under way carried an upload: nothing it makes opens by itself (`autoOpen.ts`). */
  fromUpload: boolean;
};

/**
 * Chat session state + streaming logic, shared by the full-page `ChatShell`
 * and the dock (`ChatDock`, on every other page) so both surfaces behave
 * identically — same SSE reducer, same resumable streams, same activity trace
 * — and resume the same conversation.
 *
 * Owns: the transcript, the SSE wire to `/rpc/agent/stream` (plus the
 * mid-turn resume endpoint), the boot sequence that restores the last agent
 * and thread, the per-agent suggestion chips, and the two conversation
 * pointers described above. Callers render; they don't reach into any of it.
 * @param root0 - Hook options.
 * @param root0.agents - Agents available to pick from. The caller guarantees at least one entry.
 * @param root0.initialComposerValue - Pre-fills the composer without sending.
 * @param root0.initialAttachments - Uploaded files that start in the composer.
 * @param root0.suggestions - Workspace-scoped empty-state chips.
 * @param root0.greeting - Empty-state greeting: org eyebrow + workspace name.
 * @param root0.scopeRef
 * @param root0.pageContext
 * @param root0.resumeConversationId
 * @param root0.onEvent
 */
export function useChatSession({
  agents,
  initialComposerValue,
  initialAttachments,
  suggestions = [],
  greeting,
  scopeRef,
  pageContext,
  resumeConversationId = null,
  onEvent,
}: UseChatSessionOptions) {
  // Read at send time through a ref so a route change between turns is
  // reflected without rebuilding `sendMessage`.
  const pageContextRef = useRef(pageContext);
  pageContextRef.current = pageContext;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const { state: lastViewed, loading: lastViewedLoading, persist, persistRail } = useLastViewedConversation();

  // Scoped mode: resolve the user's latest conversation for the record before
  // boot decides anything. `loading` holds the skeleton exactly like the
  // last-viewed pointer does for the global surfaces.
  const [scopedBoot, setScopedBoot] = useState<{ loading: boolean; conv: { id: number; agentSlug: string } | null }>(
    () => ({ loading: Boolean(scopeRef), conv: null }),
  );
  const scopedResumeIdRef = useRef<number | null>(null);
  // The everything-scoped thread the boot decided to resume (§9), if any.
  const pendingResumeIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!scopeRef) {
      return;
    }
    let cancelled = false;
    client.conversations.latestForScope({ scopeRef })
      .then((conv) => {
        if (!cancelled) {
          setScopedBoot({ loading: false, conv: conv ? { id: conv.id, agentSlug: conv.agentSlug } : null });
        }
      })
      .catch((error) => {
        console.warn('useChatSession: scoped resume lookup failed', error);
        if (!cancelled) {
          setScopedBoot({ loading: false, conv: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scopeRef]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState(initialComposerValue ?? '');
  // Captured pasted material — a chip beside the composer, not a flood in it
  // (032 §2.1 rule 5). Travels with the next message, then clears.
  const [pastedText, setPastedText] = useState<string | null>(null);
  // Files attached to the next message — already uploaded, already artifacts;
  // these are the chips. `pendingUploads` are the ones still going up, each a
  // chip with a progress bar; Send waits for them to land.
  const [attachments, setAttachments] = useState<ChatAttachment[]>(initialAttachments ?? []);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // Keys the person dismissed (×) while their batch was still going up.
  const dismissedUploadsRef = useRef(new Set<string>());
  const uploadBatchesRef = useRef(new Map<string, { keys: string[]; abort: AbortController }>());
  const uploading = pendingUploads.length;
  // Read by `attachFiles` to keep a message under the file cap without
  // re-creating the callback on every chip.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const pendingRef = useRef(pendingUploads);
  pendingRef.current = pendingUploads;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamingPhase>('idle');
  // The Decisions this conversation is waiting on, oldest first — the first
  // is docked above the composer (`decisions/DecisionDock.tsx`).
  const [openDecisions, setOpenDecisions] = useState<DecisionView[]>([]);
  // A connect walk that finished answered the Decision that started it: it
  // leaves the dock now, as a reload would read it.
  const openDecisionsRef = useRef<DecisionView[]>([]);
  useEffect(() => {
    openDecisionsRef.current = openDecisions;
  }, [openDecisions]);
  useEffect(() => {
    const onFinished = (e: Event) => {
      const detail = (e as CustomEvent<{ decisionId?: number; summary?: string }>).detail;
      const id = detail?.decisionId;
      if (typeof id !== 'number') {
        return;
      }
      const asked = openDecisionsRef.current.find(d => d.id === id);
      setOpenDecisions(prev => prev.filter(d => d.id !== id));
      // The receipt on the person's side, as the stored row will draw it.
      if (asked && detail?.summary) {
        setMessages(prev => [...prev, { role: 'user', content: '', decisionAnswer: { id, question: asked.question, line: `Start: ${detail.summary}`, kind: 'option', via: 'card' } }]);
      }
    };
    window.addEventListener(CONNECT_SYSTEMS_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(CONNECT_SYSTEMS_FINISHED_EVENT, onFinished);
  }, []);
  // The Decision whose answer is on its way, and why the last one did not land.
  const [answeringDecisionId, setAnsweringDecisionId] = useState<number | null>(null);
  /** Answers given while a turn was still running, sent in order once it lands. */
  const heldAnswersRef = useRef<Array<{ view: DecisionView; answer: DecisionAnswer }>>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  // Bumped to read the open Decisions again (an answer that did not land).
  const [decisionsTick, setDecisionsTick] = useState(0);
  // WHAT ELSE WAITS ON THIS PERSON (`decisions.waiting`): questions a mission
  // or automation put on Needs you and proposals filed from no conversation.
  // They queue in the dock behind this conversation's own — the decision
  // queue the old "Waiting on you" stack of cards became.
  const [waitingDecisions, setWaitingDecisions] = useState<DecisionView[]>([]);
  // What an answer from the queue did, said once in the dock (no turn follows it).
  const [dockNotice, setDockNotice] = useState<{ line: string; receipt?: DoneReceipt } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusCitation, setFocusCitation] = useState<number | null>(null);
  const [allDocuments, setAllDocuments] = useState<IndexedDocument[]>([]);
  // Citation numbers the assistant answers actually reference (`[n]`) — drives
  // the drawer's "Cited" tab vs. the full retrieved "All" set.
  const citedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const message of messages) {
      if (message.role !== 'assistant') {
        continue;
      }
      const text = (message.runs ?? [])
        .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
        .map(run => run.text)
        .join('\n') || message.content || '';
      for (const match of text.matchAll(/\[(\d{1,3})\](?!\()/g)) {
        set.add(Number(match[1]));
      }
    }
    return [...set];
  }, [messages]);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>(undefined);
  // Live activity line — what the team is doing RIGHT NOW during a long turn
  // (retrieval, subagent delegation, tool runs). Cleared once text streams.
  const [activity, setActivity] = useState<string | null>(null);
  // Boot gate — a reload used to flash through 4 states (default agent →
  // skeleton chips → chips → transcript). We hold a single stable skeleton
  // until the restore-agent + resume-conversation sequence settles, then
  // reveal the final view (transcript OR empty state) in one transition.
  // `resuming` = a stored conversation will hydrate, so don't show the empty
  // state's chips at all — show a transcript skeleton straight to transcript.
  const [booted, setBooted] = useState(false);
  const [resuming, setResuming] = useState(false);

  // Recent conversations for the current agent — powers the history pickers
  // (the ⋯ menu on the page, the history panel in the bubble). Refreshed on
  // agent switch and when the list could be stale.
  const [recentChats, setRecentChats] = useState<Array<{ id: number; title: string; titleSource?: ConversationTitleSource }>>([]);
  // The open thread's name as last read from the server (resume, pick) or
  // written here (first send, rename). The recent list wins when it holds the
  // thread, since it is refetched after every turn; this covers a thread too
  // old to be in it.
  const [threadMeta, setThreadMeta] = useState<{ id: number; title: string; titleSource: ConversationTitleSource } | null>(null);
  // Bumped to refetch the recent list while a new thread's generated name is
  // on its way (it is written in the background after the first reply).
  const [titleTick, setTitleTick] = useState(0);
  // How recommended actions behave in this thread (0094). Starts from the
  // person's last choice; a resumed thread brings its own.
  const [autonomy, setAutonomyState] = useState<ConversationAutonomy>(DEFAULT_AUTONOMY);
  // How strong a model, how much it thinks — per thread, like autonomy.
  const [modelPrefs, setModelPrefsState] = useState<ModelPrefs>(DEFAULT_MODEL_PREFS);
  const modelPrefsRef = useRef(modelPrefs);
  modelPrefsRef.current = modelPrefs;
  // A level for the next message only — set by Dig deeper, cleared once sent.
  const effortOnceRef = useRef<EffortLevel | null>(null);
  // The roster, readable from effects and event handlers without re-running
  // them: it names the agent a persisted or streamed turn was spoken by.
  const rosterRef = useRef(agents);
  rosterRef.current = agents;
  const nameOfAgent = useCallback((slug: string, fallback?: string) => agentDisplayName(slug, rosterRef.current, fallback), []);
  // Records the person pointed this turn at with `@` — sent as `context_refs`
  // beside the message and cleared after the send.
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);

  // Callers guarantee at least one entry — the virtual SEARCH_ONLY_AGENT is
  // always appended. `agentSlug` defaults to the workspace lead; if it ever
  // resolves to a missing/deleted agent the `?? agents[0]` fallback keeps the
  // surface pointed at a real agent.
  const agent = (currentSlug ? agents.find(a => a.slug === currentSlug) : undefined) ?? agents[0]!;
  // ONE identity (§9.10): the surface speaks as the WORKSPACE — "Ask Revenue"
  // — implemented as the lead's config plus its delegation roster. There is
  // no picked agent; specialists appear only as attribution. `__search__` is
  // reachable through the `/search` command, never as a persona.
  const isSearchOnly = agent.slug === '__search__';
  const workspaceName = agents.find(a => a.workspaceName)?.workspaceName ?? greeting?.workspace ?? 'your workspace';
  // Chips: the server's workspace set when it sent one, else the lead's own
  // suggestions plus one per team lead, capped — no agent names.
  const emptyChips = suggestions.length > 0 ? suggestions : workspaceChips(agents);
  const emptyChipsLoading = false;
  const emptyGreeting = greeting ?? { workspace: workspaceName };
  // Neutral composer (the ChatComposer default, "Ask anything…") — and, with
  // this conversation's own Decision docked above it, the other way to answer:
  // in their own words. What waits elsewhere is not read from the composer
  // (only this conversation's own is, `answersFirst`), so it never says so.
  const composerPlaceholder = openDecisions.length > 0 ? 'Or reply directly…' : undefined;
  const isStreaming = phase !== 'idle';
  /**
   * The same answer as `isStreaming`, readable SYNCHRONOUSLY.
   *
   * ⌘⏎ stops the turn and sends in one handler; `isStreaming` is still the
   * pre-stop value in that closure, so a guard reading it would refuse the
   * send. The ref is set at the three moments the turn's liveness actually
   * changes, so both readers agree.
   */
  const streamingRef = useRef(false);
  // The turn under way carried an upload: what it makes shows as a chip and opens on a tap (`autoOpen.ts`).
  const turnFromUploadRef = useRef(false);
  // True while waiting for a reply with no stream to attach to (`waitForReply`); Stop ends it.
  const waitingRef = useRef(false);
  /**
   * How the last turn ENDED — what the send queue flushes on. Only
   * `completed` releases queued messages; `stopped` and `error` hold them and
   * tell the person they were not sent (queueReducer.ts).
   */
  const [turnOutcome, setTurnOutcome] = useState<TurnOutcome>('idle');
  /**
   * The controller `handleStop` already finalized, so the aborted fetch's
   * catch block does not close a DIFFERENT assistant message: ⌘⏎ pushes the
   * next turn's rows the moment it stops this one, and `appendToLatestAgent`
   * would otherwise rewrite that new empty row with the stopped turn's tail.
   * Held as the controller, not a boolean, because the next turn starts before
   * the aborted one's catch runs.
   */
  const stoppedControllerRef = useRef<AbortController | null>(null);

  /* --------------------------------------------------------------- */
  /* SSE event reducer — folds streaming events into the messages    */
  /* array on the latest assistant message.                          */
  /* --------------------------------------------------------------- */

  const appendToLatestAgent = useCallback((mutate: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') {
        return prev;
      }
      return [...prev.slice(0, -1), mutate(last)];
    });
  }, []);

  /* --------------------------------------------------------------- */
  /* Delta batching — token deltas arrive far faster than the screen  */
  /* refreshes. Accumulate them in refs and fold into React state at  */
  /* most once per animation frame, so a 1000-token reply costs ~60   */
  /* renders instead of ~1000. Ordering with non-delta events (tool   */
  /* runs, documents) is preserved by flushing synchronously before   */
  /* any other message mutation.                                      */
  /* --------------------------------------------------------------- */

  const pendingResponseRef = useRef('');
  const pendingThinkingRef = useRef('');
  const flushFrameRef = useRef<number | null>(null);
  // Typed trace nodes accumulate here (merged by id, reason deltas appended)
  // and fold into message.trace on the same animation frame as text deltas —
  // reason tokens arrive as fast as response tokens, so they need batching too.
  const pendingTraceRef = useRef<Map<string, TraceNode>>(new Map());
  const traceDirtyRef = useRef(false);
  // Where in the answer we are, for `TraceNode.anchor`: how many text runs
  // have started this turn, and whether the newest run is one of them (so the
  // next delta extends it rather than opening another). Mirrors the reducer's
  // own extend-or-append rule without reading React state mid-event, and the
  // same count the server's RunCollector stamps — so the live transcript and
  // the reloaded one interleave the same way.
  const textRunsRef = useRef(0);
  const lastRunIsTextRef = useRef(false);

  const flushDeltas = useCallback(() => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
    const responseText = pendingResponseRef.current;
    const thinkingText = pendingThinkingRef.current;
    const traceDirty = traceDirtyRef.current;
    if (!responseText && !thinkingText && !traceDirty) {
      return;
    }
    pendingResponseRef.current = '';
    pendingThinkingRef.current = '';
    traceDirtyRef.current = false;
    if (responseText && !lastRunIsTextRef.current) {
      textRunsRef.current += 1;
      lastRunIsTextRef.current = true;
    }
    const trace = traceDirty ? [...pendingTraceRef.current.values()] : null;
    appendToLatestAgent((m) => {
      let next = m;
      if (thinkingText) {
        next = { ...next, thinkingText: (next.thinkingText ?? '') + thinkingText };
      }
      if (trace) {
        next = { ...next, trace };
      }
      if (responseText) {
        const runs = next.runs ?? [];
        const last = runs[runs.length - 1];
        next = last && last.type === 'text'
          ? { ...next, runs: [...runs.slice(0, -1), { type: 'text', text: last.text + responseText }] }
          : { ...next, runs: [...runs, { type: 'text', text: responseText }] };
      }
      return next;
    });
  }, [appendToLatestAgent]);

  const scheduleFlush = useCallback(() => {
    if (flushFrameRef.current === null) {
      flushFrameRef.current = requestAnimationFrame(flushDeltas);
    }
  }, [flushDeltas]);

  // Unmount mid-stream: drop the pending frame (state is gone anyway).
  useEffect(() => () => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
    }
  }, []);

  const handleEvent = useCallback((evt: { type: string; [k: string]: unknown }) => {
    // Extension seam first (R2/R3): a claimed event skips the built-in cases.
    // Strict `=== true`: an extension that only observes returns undefined.
    if (onEventRef.current?.(evt, { appendToLatestAgent, flushDeltas, setActivity, fromUpload: turnFromUploadRef.current }) === true) {
      return;
    }
    switch (evt.type) {
      case 'routed': {
        // The workspace chose the agent (`route: true`): attribute the turn to
        // it the way an `@mention` does, and keep the reason on the message.
        const routed = evt as unknown as { agent: { slug: string; name: string }; routing: RoutingDecision };
        appendToLatestAgent(m => ({ ...m, agentSlug: routed.agent.slug, agentName: nameOfAgent(routed.agent.slug, routed.agent.name), routing: routed.routing }));
        return;
      }
      case 'turn_agent': {
        // Who speaks this turn, from the runtime — the same slug the row is
        // stamped with, so live and reloaded transcripts agree (backlog 009).
        const spoken = evt as unknown as { agent: { slug: string; name: string } };
        appendToLatestAgent(m => ({ ...m, agentSlug: spoken.agent.slug, agentName: nameOfAgent(spoken.agent.slug, spoken.agent.name) }));
        setActivity(`${nameOfAgent(spoken.agent.slug, spoken.agent.name)} is thinking…`);
        return;
      }
      case 'turn_restarted': {
        // The app restarted while this turn was being answered, and it is
        // being answered again from where it stood (backlog 056). What was on
        // screen was the first attempt; what follows is the whole answer.
        pendingTraceRef.current = new Map();
        traceDirtyRef.current = false;
        textRunsRef.current = 0;
        lastRunIsTextRef.current = false;
        appendToLatestAgent(m => ({ ...m, content: '', runs: [], trace: undefined, status: undefined, statusReason: undefined }));
        setPhase('thinking');
        setActivity('The app restarted — picking the answer back up…');
        return;
      }
      case 'run_meta': {
        // Which model answers this turn — the footer's fact, never a guess.
        const meta = evt as unknown as TurnModel & { type: 'run_meta'; effort?: TurnEffort };
        appendToLatestAgent(m => ({ ...m, model: { model: meta.model, provider: meta.provider, strength: meta.strength ?? 'balanced', thinking: meta.thinking ?? 'off' }, ...(meta.effort ? { effort: meta.effort } : {}) }));
        return;
      }
      case 'effort_result': {
        // What the level bought — the turn's line ("Standard · 6s") and its Dig deeper.
        const r = evt as unknown as TurnEffort & { type: 'effort_result' };
        appendToLatestAgent(m => ({ ...m, effort: { level: r.level, chosenBy: r.chosenBy, reason: r.reason, elapsedMs: r.elapsedMs, ceilingHit: r.ceilingHit ?? null, next: r.next ?? null } }));
        return;
      }
      case 'thinking':
        setPhase('thinking');
        // Keep "<agent> is thinking…" when the turn already named its speaker.
        setActivity(prev => (prev?.endsWith(' is thinking…') ? prev : 'Thinking…'));
        return;
      case 'thinking_delta': {
        // Chain-of-thought token (Anthropic extended thinking).
        // Accumulate into the message's thinkingText — WorkTimeline
        // renders the live tail while streaming and the full text after.
        setActivity('Reasoning…');
        pendingThinkingRef.current += String(evt.delta ?? '');
        scheduleFlush();
        return;
      }
      case 'trace_node': {
        // Typed hierarchical trace — merge by id (reason deltas append to
        // text), batched onto the animation frame like the other deltas.
        const node = evt as unknown as TraceNode & { delta?: string };
        const map = pendingTraceRef.current;
        // A NEW step is anchored to its place in the answer. Flush first so a
        // passage still in the buffer counts as started — it precedes the step.
        if (!map.has(node.id)) {
          if (pendingResponseRef.current) {
            flushDeltas();
          }
          node.anchor = textRunsRef.current;
        }
        const merged = mergeTraceNode(map.get(node.id), node);
        map.set(node.id, merged);
        traceDirtyRef.current = true;
        setActivity(liveStepLabel(merged));
        scheduleFlush();
        return;
      }
      case 'step_progress': {
        // A long call saying where it has got to — "sheet 7 of 12". It rides
        // the step line that is already there; it never adds a row.
        const name = String(evt.tool ?? 'tool');
        const note = String(evt.note ?? '').trim();
        if (!note) {
          return;
        }
        const map = pendingTraceRef.current;
        const next = noteToolProgress([...map.values()], name, note);
        const touched = next.find(n => n.tool === name && n.progress === note);
        if (!touched) {
          return;
        }
        map.set(touched.id, touched);
        traceDirtyRef.current = true;
        setActivity(liveStepLabel(touched));
        scheduleFlush();
        return;
      }
      case 'answering':
        setPhase('answering');
        return;
      case 'status':
        // The server says what it is doing, in words; the line shows exactly that.
        setActivity(String((evt as { label?: string }).label ?? '') || null);
        return;
      case 'retrieval_progress': {
        const stage = String(evt.stage ?? 'searching');
        const meta = (evt.meta as { candidates?: number }) ?? {};
        setActivity(stage === 'reranking'
          ? `Searching — ranking ${meta.candidates ?? ''} candidates…`
          : 'Searching connected sources…');
        return;
      }
      case 'subagent_start':
        // Subagent names are deepagents plumbing ("general-purpose") — the
        // timeline's Delegated step carries the friendly specialist name.
        setActivity('Specialist working…');
        return;
      case 'subagent_end':
        setActivity('Assembling the answer…');
        return;
      case 'response_delta': {
        setActivity(null);
        pendingResponseRef.current += String(evt.delta ?? '');
        scheduleFlush();
        return;
      }
      case 'tool_start': {
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const input = (evt.input as Record<string, unknown>) ?? {};
        // Same human labels the timeline uses, present tense — "Delegating:
        // Pipeline Analyst…" instead of "Running task…".
        const live = describeToolCall(name, input, true);
        setActivity(live.detail ? `${live.label} ${live.detail}` : live.label);
        lastRunIsTextRef.current = false;
        appendToLatestAgent(m => ({
          ...m,
          runs: [...(m.runs ?? []), { type: 'tool', name, input, state: 'pending' }],
        }));
        return;
      }
      case 'tool_end': {
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const output = String(evt.output ?? '');
        appendToLatestAgent((m) => {
          const runs = m.runs ?? [];
          for (let i = runs.length - 1; i >= 0; i--) {
            const run = runs[i]!;
            if (run.type === 'tool' && run.name === name && run.state === 'pending') {
              const updated: AgentRun = { ...run, state: 'done', output };
              return { ...m, runs: [...runs.slice(0, i), updated, ...runs.slice(i + 1)] };
            }
          }
          return m;
        });
        return;
      }
      case 'tool_error': {
        // A tool threw. Close its in-flight run AND its trace row as errors so
        // the rail's live row stops spinning and says what happened.
        flushDeltas();
        const name = String(evt.tool ?? 'tool');
        const message = String(evt.message ?? 'tool failed');
        setActivity(null);
        appendToLatestAgent((m) => {
          const runs = m.runs ?? [];
          let patched = false;
          const nextRuns = runs.map((run) => {
            if (!patched && run.type === 'tool' && run.name === name && run.state === 'pending') {
              patched = true;
              return { ...run, state: 'error' as const, output: message };
            }
            return run;
          });
          const trace = m.trace ?? [...pendingTraceRef.current.values()];
          const nextTrace = failToolNode(trace, name, message);
          for (const n of nextTrace) {
            pendingTraceRef.current.set(n.id, n);
          }
          return { ...m, runs: nextRuns, trace: nextTrace };
        });
        return;
      }
      case 'record_links': {
        // The records the answer names, linked to their pages — the same
        // pure pass the stored transcript gets (libs/chat/recordMentions.ts).
        flushDeltas();
        const links = (evt as unknown as { links: Array<{ text: string; href: string }> }).links ?? [];
        appendToLatestAgent(m => ({
          ...m,
          ...(m.content ? { content: linkRecordMentions(m.content, links) } : {}),
          ...(m.runs ? { runs: m.runs.map(r => (r.type === 'text' ? { ...r, text: linkRecordMentions(r.text, links) } : r)) } : {}),
        }));
        return;
      }
      case 'turn_records': {
        // The records the turn filed or changed, typed (`services/chat/turnRecords.ts`):
        // one microcard each under the turn, kept current while it runs.
        flushDeltas();
        const records = (evt as unknown as { records: TurnRecord[] }).records ?? [];
        appendToLatestAgent(m => ({ ...m, records }));
        return;
      }
      case 'record_created': {
        // A room or proposal the turn just made opens beside the conversation
        // (Chris, 2026-09-18: "maybe preview should open automatically").
        flushDeltas();
        const made = (evt as unknown as { record: { type: RecordRef['type']; id: string } }).record;
        if (opensPreviewOnItsOwn({ fromUpload: turnFromUploadRef.current })) {
          openPreview({ type: made.type, id: made.id }, null);
        }
        return;
      }
      case 'version_written': {
        // A record or artifact this turn changed: whatever page or pane is
        // showing it refetches in place and marks what changed (backlog 035).
        const v = evt as unknown as VersionWritten;
        if (v.ref && typeof v.to === 'number') {
          announceVersionWritten({ ref: v.ref, to: v.to, from: v.from ?? null, ...(v.artifactId ? { artifactId: v.artifactId } : {}), ...(v.fields ? { fields: v.fields } : {}), ...(v.related ? { related: v.related } : {}) });
        }
        return;
      }
      case 'documents': {
        flushDeltas();
        const docs = (evt.documents as IndexedDocument[]) ?? [];
        setAllDocuments(prev => [...prev, ...docs]);
        appendToLatestAgent(m => ({ ...m, documents: [...(m.documents ?? []), ...docs] }));
        return;
      }
      case 'decision': {
        // A Decision raised in this turn docks above the composer; one that
        // was answered (by its card, or by typed words the server read as the
        // answer) leaves the dock — the receipt stays in the transcript.
        flushDeltas();
        const d = evt.decision as DecisionView | undefined;
        if (!d || typeof d.id !== 'number') {
          return;
        }
        if (d.state === 'open' || d.state === 'expired') {
          setOpenDecisions(prev => (prev.some(x => x.id === d.id) ? prev.map(x => (x.id === d.id ? d : x)) : [...prev, d]));
          // "Connect your systems" arriving live opens its walk at once — the
          // person asked for it. A reload docks the Decision and starts nothing.
          const walk = d.state === 'open' && d.kind === 'setup' ? d.options.map(o => connectSystemsInputOfHref(o.href)).find(Boolean) : null;
          if (walk) {
            // The lead's why for this person now leads the first step.
            startConnectSystems({ input: walk, decisionId: d.id, intro: d.body ?? null });
          }
          return;
        }
        setOpenDecisions(prev => prev.filter(x => x.id !== d.id));
        setAnsweringDecisionId(cur => (cur === d.id ? null : cur));
        setDecisionError(null);
        if (d.answer?.via === 'composer') {
          const line = d.answer.kind === 'free_text' ? (d.answer.freeText ?? '') : d.answer.kind === 'skip' ? 'Skipped' : d.answer.labels.join(', ');
          setMessages((prev) => {
            const at = prev.findLastIndex(m => m.role === 'user');
            return at === -1 ? prev : prev.map((m, i) => (i === at ? { ...m, decisionAnswer: { id: d.id, question: d.question, line, kind: d.answer!.kind, via: 'composer' } } : m));
          });
        }
        return;
      }
      case 'suggestions': {
        // The follow-ups the reply ended with: pills under it, never text.
        flushDeltas();
        const items = Array.isArray(evt.items) ? evt.items : [];
        appendToLatestAgent(m => ({ ...m, suggestions: items }));
        return;
      }
      case 'receipt': {
        // Done inside the trust bar: one line under the turn, Undo only where real.
        flushDeltas();
        const r = readDoneReceipt(evt.receipt);
        if (r) {
          appendToLatestAgent(m => ({ ...m, receipts: [...(m.receipts ?? []).filter(x => x.runId !== r.runId), r] }));
          // Something ran: a setup step may now be done (the checklist re-reads).
          announceSetupChanged();
        }
        return;
      }
      // A card, a card's update, a recommendation and an approval gate reach
      // this client as the Decision each one is (`services/decisions/
      // escalate.ts`); their raw events are not drawn.
      case 'artifact': {
        // The chip under the message saying what this turn produced.
        //
        // `ChatMessageArtifact`, `ArtifactChips` and the render in
        // `AgentMessage` all existed; nothing ever set `message.artifacts`, on
        // this path or the transcript's. So `render_chart` wrote a real
        // artifact, the agent said "chart's up", and the transcript showed
        // nothing — Chris, 2026-09-17: *"why didn't I get an artifact here?"*
        //
        // A pending shell carries no content yet and is skipped; the real event
        // that follows replaces it. Keyed by id so a turn that updates the same
        // artifact twice leaves one chip at the latest version, not two.
        if (evt.pending) {
          return;
        }
        // The reducer takes untyped events off the wire, so narrow here rather
        // than trusting the shape.
        const a = evt.artifact as { id?: unknown; title?: unknown; kind?: unknown; version?: unknown } | undefined;
        if (!a || typeof a.id !== 'number' || typeof a.title !== 'string') {
          return;
        }
        const chip: ChatMessageArtifact = {
          id: a.id,
          title: a.title,
          kind: (a.kind ?? 'markdown') as ChatMessageArtifact['kind'],
          version: typeof a.version === 'number' ? a.version : 1,
        };
        appendToLatestAgent(m => ({
          ...m,
          artifacts: [...(m.artifacts ?? []).filter(x => x.id !== chip.id), chip],
        }));
        // ...and open it beside the conversation, which is what the tool has
        // been TELLING the user it did. `render_markdown` returns "now open
        // beside the conversation at v1"; `openPreview` was only ever called
        // from a chip click, so the artifact appeared as a chip the user then
        // had to find and press. Chris, 2026-09-17: *"it didn't open the
        // sidebar artifact (it should have)"* — he was comparing against the
        // sentence the product had just shown him.
        //
        // The newest artifact of the turn wins, so a turn that renders three
        // leaves the last one open rather than fighting over the panel.
        // Never after an upload: the chip above is the way in (`autoOpen.ts`).
        if (opensPreviewOnItsOwn({ fromUpload: turnFromUploadRef.current })) {
          openPreview({ type: 'artifact', id: String(chip.id) }, null);
        }
        return;
      }

      case 'self_update': {
        // The chip that says the system improved ITSELF during this turn. The
        // same fold as the artifact chip — key by run id, so a proposal that
        // is refreshed mid-turn leaves one entry at its latest state — except
        // that these group into ONE chip rather than a row each.
        const u = evt.selfUpdate as { runId?: unknown; noun?: unknown; target?: unknown; status?: unknown } | undefined;
        if (!u || typeof u.runId !== 'number' || typeof u.noun !== 'string' || typeof u.target !== 'string') {
          return;
        }
        const receipt = evt.selfUpdate as SelfUpdateReceipt;
        appendToLatestAgent(m => ({ ...m, selfUpdates: mergeSelfUpdate(m.selfUpdates ?? [], receipt) }));
        return;
      }

      case 'done':
        flushDeltas();
        // `done` IS the terminal event (#421): the answer is complete even
        // though the socket stays open for the ~3s it takes the route to
        // persist the row. Release the send guard here, not at socket close —
        // otherwise a message typed in that window is dropped in silence
        // while the button still reads "Send message".
        streamingRef.current = false;
        // Backfill `content` from the streamed text runs. Streaming only
        // accumulates into `runs`; `conversation_history` reads `content`
        // (and drops empty entries), so without this the agent never sees
        // its own prior replies and re-answers earlier turns. Also finalize
        // the trace: any node still "in progress" (e.g. a reason node that
        // never got a done boundary) would otherwise show a spinner + present
        // tense ("Thinking") forever after the turn completes.
        appendToLatestAgent(m => ({
          ...m,
          content: m.content || (m.runs ?? [])
            .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
            .map(run => run.text)
            .join('\n\n'),
          trace: finalizeTrace(m.trace),
        }));
        setPhase('idle');
        setActivity(null);
        return;
      case 'error': {
        flushDeltas();
        setPhase('idle');
        setActivity(null);
        const message = String(evt.message ?? 'error');
        lastRunIsTextRef.current = false;
        // The turn stops here with whatever text already arrived. Marking it
        // now means the live transcript says the same thing the reloaded one
        // will — the server writes the row `incomplete` from the same event
        // (#114).
        //
        // This used to add a tool run called "error" instead, which lit the
        // tool-error badge: the person read "error failed" over a turn where
        // no tool had failed, and after the notice landed they read the same
        // failure twice in one bubble. The run is gone; the reason travels on
        // the message.
        // The server says which ending this is, in the same word it will store
        // on the row; an older runtime that does not say reads as the ending
        // this used to assume.
        const ending = (evt.ending as TurnStatus | undefined) ?? 'incomplete';
        appendToLatestAgent(m => ({
          ...m,
          status: ending,
          statusReason: message,
        }));
      }
    }
  }, [appendToLatestAgent, flushDeltas, scheduleFlush]);

  /* --------------------------------------------------------------- */
  /* Send                                                            */
  /* --------------------------------------------------------------- */

  // Persisted thread id for this chat. Conversations are the system of
  // record (and feed the adoption stream); the id is created lazily on
  // the first send and reset by New chat / agent switch. The virtual
  // `__search__` entry stays ephemeral — it isn't a real agent, so its
  // turns must not appear in conversation history or agent metrics.
  //
  // Held in a ref because `sendMessage` reads it synchronously mid-turn, and
  // mirrored into state because the history pickers highlight the active
  // thread and a ref change doesn't re-render.
  const conversationIdRef = useRef<number | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);

  // WHAT THIS CONVERSATION IS WAITING ON, read from the server whenever the
  // thread changes and whenever a turn lands — so a Decision raised while the
  // person was away (or in another tab) docks the moment they open the thread,
  // and the live `decision` events are reconciled with the record.
  const turnIdle = phase === 'idle';
  useEffect(() => {
    if (conversationId === null) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- a thread with no id waits on nothing
      setOpenDecisions([]);
      return;
    }
    if (!turnIdle) {
      return;
    }
    let cancelled = false;
    // Through a resolved promise, so a client without the route (an old
    // server mid-deploy, a test double) is a warning, never a crash.
    Promise.resolve()
      .then(() => client.decisions.open({ conversationId: conversationId! }))
      .then((rows) => {
        if (!cancelled) {
          setOpenDecisions(rows as DecisionView[]);
        }
      })
      .catch((error: unknown) => {
        console.warn('useChatSession: could not read the open decisions', error);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, turnIdle, decisionsTick]);
  // …and what waits on them elsewhere, read at the same moments — a new chat
  // included, so the queue is there before the first message.
  useEffect(() => {
    if (!turnIdle) {
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => client.decisions.waiting())
      .then((rows) => {
        if (!cancelled) {
          setWaitingDecisions(rows as DecisionView[]);
        }
      })
      .catch((error: unknown) => {
        console.warn('useChatSession: could not read what is waiting', error);
      });
    return () => {
      cancelled = true;
    };
  }, [turnIdle, decisionsTick, conversationId]);
  // A page hand-off may ask for ONE turn to go to a specialist (the brief's
  // team lead); the conversation itself stays with the workspace agent.
  const routeOnceRef = useRef<string | null>(null);

  /**
   * Points this chat at a thread: the synchronous ref, the render-visible
   * state, this browser's localStorage pointer, and the user's server-side
   * pointer, all in one place so no surface can drift from another.
   * @param slug - Agent the thread belongs to.
   * @param id - Conversation id, or null to detach and start fresh.
   */
  const setActiveConversation = useCallback((slug: string, id: number | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
    // This browser session is now in (or out of) the thread — the one signal
    // a later mount resumes on (§9).
    writeSessionConversation(slug, id);
    if (scopeRef) {
      // Scoped threads belong to the record, not to the global pointers —
      // the dock must never steal the full-page chat's resume target.
      scopedResumeIdRef.current = id;
      return;
    }
    if (id === null) {
      clearActiveConversation(slug);
    } else {
      writeActiveConversation(slug, id);
    }
    persist({ agentSlug: slug, conversationId: id });
  }, [persist, scopeRef]);

  /**
   * After a turn lands, learn the persisted id of the assistant row so the
   * feedback control has something to write against. One small read; the
   * server appended the row while streaming.
   */
  const stampLastAssistantId = useCallback(async () => {
    const id = conversationIdRef.current;
    if (id === null) {
      return;
    }
    try {
      const rows = await client.conversations.tail({ id, limit: 2 });
      const last = [...rows].reverse().find(r => r.role === 'assistant');
      if (!last) {
        return;
      }
      appendToLatestAgent(m => (m.id ? m : { ...m, id: last.id }));
    } catch (error) {
      console.warn('useChatSession: could not read the persisted message id', error);
    }
  }, [appendToLatestAgent]);

  // In-flight turn's abort controller (Stop button).
  const abortRef = useRef<AbortController | null>(null);
  const streamStashRef = useRef<StreamStash | null>(null);

  // Once the boot sequence settles (agent restored + conversation resumed or
  // confirmed empty), reveal the final view. Idempotent — safe to call on
  // every resolution path.
  const settleBoot = useCallback(() => {
    setResuming(false);
    setBooted(true);
  }, []);

  // RESUME a mid-turn stream after refresh/drop: replay missed events, then
  // stay attached live until done. Falls back silently (404 = expired; the
  // finished turn arrives via conversation rehydrate as before).
  // `continueLatest`: the connection dropped mid-turn in THIS page (Safari's
  // "Load failed" — a network change, a suspended tab), so the turn's message
  // is already on screen and the replay continues it rather than starting a
  // new one. 2026-09-25: the server finished and stored the answer while the
  // phone showed "This answer stopped partway through".
  const resumeStream = useCallback(async (stash: StreamStash, opts: { continueLatest?: boolean } = {}) => {
    if (!opts.continueLatest) {
      pendingTraceRef.current = new Map();
      traceDirtyRef.current = false;
      textRunsRef.current = 0;
      lastRunIsTextRef.current = false;
      setMessages(prev => [...prev, { role: 'assistant', content: '', runs: [] }]);
    }
    streamingRef.current = true;
    setPhase('thinking');
    setTurnOutcome('running');
    setActivity('Reconnecting to the running turn…');
    streamStashRef.current = stash;
    try {
      const resp = await fetch(`/rpc/agent/stream/resume?id=${encodeURIComponent(stash.streamId)}&after=${stash.count}`);
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          if (!block.startsWith('data: ')) {
            continue;
          }
          try {
            const evt = JSON.parse(block.slice(6));
            if (evt.type !== 'stream_meta') {
              if (streamStashRef.current) {
                streamStashRef.current.count += 1;
                writeStreamStash(streamStashRef.current);
              }
              handleEvent(evt);
            }
          } catch (error) {
            // malformed event — skip it, the stream keeps going
            console.warn('useChatSession: failed to parse a replayed SSE event', error);
          }
        }
      }
      flushDeltas();
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: finalizeTrace(m.trace),
      }));
      void stampLastAssistantId();
      // A turn that finished while we were away still counts as landed, so a
      // queue that survived the reload (sessionStorage) goes out.
      setTurnOutcome('completed');
    } catch (error) {
      console.warn('useChatSession: could not re-attach to the running turn', error);
      if (opts.continueLatest) {
        // The turn's own message stays; it says the answer stopped where the
        // connection did — the same ending as before this reconnect existed.
        flushDeltas();
        appendToLatestAgent(m => ({
          ...m,
          content: m.content || (m.runs ?? [])
            .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
            .map(run => run.text)
            .join('\n\n'),
          status: (m.content || (m.runs ?? []).length > 0 ? 'incomplete' : 'failed') as TurnStatus,
          // A stream the server no longer knows was lost in a restart.
          statusReason: (error as Error).message.startsWith('HTTP 404') ? 'This reply was cut off — the app restarted while it was answering. Send your message again.' : (error as Error).message,
        }));
      } else {
        // Expired/unreachable — drop the placeholder; rehydrate covers the rest.
        setMessages(prev => (prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.content ? prev.slice(0, -1) : prev));
      }
      setTurnOutcome('error');
    } finally {
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      streamStashRef.current = null;
      writeStreamStash(null);
    }
  }, [handleEvent, flushDeltas, appendToLatestAgent]);

  /* --------------------------------------------------------------- */
  /* Boot — restore the last agent, then resume its saved thread.     */
  /* --------------------------------------------------------------- */

  // The agent we're booting toward (stored or default). Set synchronously in
  // the restore effect; the hydrate effect only settles boot for THIS slug, so
  // a hydrate pass for the pre-restore (default) slug can't prematurely reveal
  // the empty-state chips before the swap-to-restored-agent completes.
  // State, not a ref: the hydrate effect below must re-run once the boot
  // target is known, and a ref change doesn't re-trigger an effect.
  const [bootTarget, setBootTarget] = useState<string | null>(null);
  const restoredAgentRef = useRef(false);
  // Was a page hand-off waiting when this session booted? Recorded here, in
  // the first effect to run, because the hand-off effect below CONSUMES the
  // stash — by the time the resume effect looks, it would already be gone.
  const handoffPendingAtBootRef = useRef(false);
  useEffect(() => {
    // Hold the skeleton until the server-side pointer has resolved, so the
    // decision below is made once against both records instead of showing a
    // default view and then swapping.
    if (lastViewedLoading || (scopeRef && scopedBoot.loading) || restoredAgentRef.current) {
      return;
    }
    restoredAgentRef.current = true;

    try {
      handoffPendingAtBootRef.current = sessionStorage.getItem('vocion_chat_handoff') !== null;
    } catch (error) {
      console.warn('useChatSession: could not check for a pending hand-off', error);
    }

    // Scoped mode: the record's own latest thread decides the boot target;
    // the global stored-agent and last-viewed pointers are someone else's.
    if (scopeRef) {
      const conv = scopedBoot.conv && agents.some(a => a.slug === scopedBoot.conv!.agentSlug)
        ? scopedBoot.conv
        : null;
      const target = conv ? conv.agentSlug : agent.slug;
      setBootTarget(target);
      if (target !== agent.slug) {
        setCurrentSlug(target);
      }
      if (conv) {
        scopedResumeIdRef.current = conv.id;
        setResuming(true);
      } else {
        settleBoot();
      }
      return;
    }

    // The workspace agent answers a fresh conversation (§9.10: one identity)
    // — never a last-used or deep-linked agent. A resumed legacy thread that
    // was opened with a specific agent brings that agent below.
    const target = defaultAgentSlug(agents);
    setBootTarget(target);
    if (target !== agent.slug) {
      setCurrentSlug(target);
    }

    // New chat unless intentionally returning (§9): resume only the thread
    // this browser session was already in, or the one the URL names. The
    // last-viewed pointer above chose the AGENT; it never chooses the thread.
    const decision = target === '__search__'
      ? { resume: false as const, reason: 'fresh' as const }
      : decideResume({ explicitId: resumeConversationId, sessionId: readSessionConversation(target) });
    if (decision.resume) {
      pendingResumeIdRef.current = decision.conversationId;
      // Hold the empty state and let the resume effect reveal the transcript
      // directly (no chip flash).
      setResuming(true);
    } else {
      pendingResumeIdRef.current = null;
      settleBoot();
    }
  }, [agents, agent.slug, settleBoot, lastViewedLoading, scopeRef, scopedBoot, resumeConversationId]);

  /**
   * A thread whose last message is the person's, with no stream to re-attach
   * to: poll until the agent's reply is stored (up to 10 minutes), then show
   * it. The composer reads "working" meanwhile, so it never looks unanswered.
   * @param id - The conversation.
   * @param seen - How many messages are already shown.
   */
  const waitForReply = useCallback(async (id: number, seen: number) => {
    waitingRef.current = true;
    setPhase('thinking');
    setActivity('Still answering…');
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline && conversationIdRef.current === id && waitingRef.current) {
      await new Promise(r => setTimeout(r, 3000));
      const conv = await client.conversations.get({ id }).catch(() => null);
      if (!conv || conversationIdRef.current !== id) {
        continue;
      }
      const { messages: next } = hydrateTranscript((conv.messages ?? []) as PersistedMessageRow[], nameOfAgent);
      const last = next[next.length - 1];
      if (next.length >= seen && last?.role === 'assistant' && last.status !== 'running') {
        setMessages(next);
        break;
      }
      // NOTHING IS ANSWERING: the turn was lost (an app restart mid-turn), or
      // the message never started one. Waiting would lock the composer for
      // ten minutes; say what happened and hand it back.
      if ((conv as { answering?: boolean }).answering === false) {
        setMessages([...next, { role: 'assistant', content: '', runs: [], status: 'incomplete' as TurnStatus, statusReason: 'This reply was cut off — the app restarted while it was answering. Send your message again.' }]);
        setTurnOutcome('error');
        break;
      }
    }
    waitingRef.current = false;
    setPhase('idle');
    setActivity(null);
  }, [nameOfAgent]);

  // Resume the agent's saved thread on mount / agent-switch, so navigating
  // away and back doesn't start over. __search__ is ephemeral and never
  // resumes; an explicit page handoff also starts fresh (it stashes its own
  // prompt in sessionStorage).
  const hydratedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    const slug = agent.slug;
    // Wait for the restore effect: it decides which agent we're booting
    // toward and may adopt the server-side conversation pointer, both of
    // which this effect reads.
    if (bootTarget === null || isSearchOnly || hydratedSlugRef.current === slug) {
      return;
    }
    hydratedSlugRef.current = slug;
    // A hand-off carries its own context and starts a fresh turn, so don't
    // resume a saved thread underneath it.
    if (handoffPendingAtBootRef.current) {
      settleBoot();
      return;
    }
    const storedId = scopeRef ? scopedResumeIdRef.current : pendingResumeIdRef.current;
    if (storedId === null) {
      // Only reveal the empty state for the agent we're actually booting toward.
      // A hydrate pass for the pre-restore (default) slug must NOT settle — the
      // restore effect is about to swap us to the real agent, which resumes.
      if (slug === bootTarget) {
        settleBoot();
      }
      return;
    }
    let cancelled = false;
    client.conversations.get({ id: storedId })
      .then((conv) => {
        if (cancelled || agent.slug !== slug) {
          return;
        }
        const { messages: hydrated, documents: restoredDocs } = hydrateTranscript(
          (conv.messages ?? []) as PersistedMessageRow[],
          nameOfAgent,
        );
        if (hydrated.length > 0) {
          conversationIdRef.current = storedId;
          setConversationId(storedId);
          writeSessionConversation(slug, storedId);
          setThreadMeta(readThreadMeta(conv));
          setAutonomyState(readAutonomy(conv));
          setModelPrefsState(readModelPrefs(conv));
          setMessages(hydrated);
          if (restoredDocs.length > 0) {
            setAllDocuments(restoredDocs);
          }
          // Mid-turn drop? If a stream stash exists for this agent and the
          // assistant's reply hasn't persisted yet, replay + re-attach live.
          const stash = readStreamStash();
          const last = hydrated[hydrated.length - 1];
          const stashHere = stash && (stash.conversationId === storedId || (stash.conversationId == null && stash.agentSlug === slug));
          if (stashHere && last?.role === 'user') {
            void resumeStream(stash);
          } else if (last?.role === 'user' || last?.status === 'running') {
            // NO HANDLE TO RE-ATTACH TO (another tab, an older stash, a
            // reload while the turn's row still says running): the server is
            // still answering, so wait for its reply to land rather than
            // showing a question — or an empty turn — with nothing under it.
            void waitForReply(storedId, hydrated.length);
          } else if (stashHere) {
            writeStreamStash(null); // turn already landed
          }
        } else if (scopeRef) {
          // Scoped id points at an empty/deleted thread — forget it.
          scopedResumeIdRef.current = null;
        } else {
          // Stored id points at an empty/deleted thread — forget it.
          clearActiveConversation(slug);
          writeSessionConversation(slug, null);
        }
        settleBoot();
      })
      .catch((error) => {
        // Thread gone/inaccessible — forget it so we start clean.
        console.warn('useChatSession: could not resume the saved conversation', storedId, error);
        if (!cancelled) {
          clearActiveConversation(slug);
          writeSessionConversation(slug, null);
          settleBoot();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.slug, isSearchOnly, settleBoot, resumeStream, waitForReply, bootTarget]);

  /**
   * Send a turn. With `decision`, the turn carries a person's ANSWER to a
   * Decision — typed, from its card's keys or a click — instead of words:
   * nothing is put in their mouth, the composer keeps whatever they were
   * typing, and the server records the answer and runs the agent that asked
   * (`services/decisions/answersFirst.ts`).
   */
  const sendMessage = useCallback(async (raw: string, decision?: { view: DecisionView; answer: DecisionAnswer }) => {
    // Read the ref, not `isStreaming`: ⌘⏎ (stop-and-send) calls handleStop and
    // sendMessage in the same handler, before React has re-rendered.
    // THE HIGHLIGHTED PASSAGE IS PART OF WHAT WAS SAID (Chris, 2026-09-29: "I
    // don't think the highlighted text got pulled in as the anchor … I should
    // be able to submit with just that context"). It rode only as page
    // context: the transcript showed "tell me?" with no quote, history lost
    // it, and an empty box could not send. It is now the turn's opening quote.
    const quoted = decision ? '' : pageContextRef.current?.selection?.text?.trim() ?? '';
    if ((!raw.trim() && !quoted && !pastedText && attachments.length === 0 && !decision) || streamingRef.current || (uploading > 0 && !decision)) {
      return;
    }
    if (decision && conversationIdRef.current === null) {
      return;
    }
    // `/search <query>` is the retrieval-only path (§9.10) — the virtual
    // search entry, reached by command rather than as a persona.
    const command = parseSearchCommand(raw);
    // An empty workspace is a STATE, not an error (2026-09-16). Sending would
    // route the turn to the `__search__` sentinel. The page seeds the
    // workspace's first agent on every load and says so with Retry
    // (`NoAgentsYet`); the words stay in the composer for when it is ready.
    if (!hasWorkspaceAgents(agents) && !command.searchOnly) {
      return;
    }
    streamingRef.current = true;
    setTurnOutcome('running');
    const searchAgent = command.searchOnly ? agents.find(a => a.slug === SEARCH_ONLY_SLUG) : undefined;
    // Pasted material rides along under the instruction, clearly fenced, so
    // the instruction stays readable in the transcript and the agent still
    // receives the full text.
    // A message that is only files still has to say something the server can
    // store and the transcript can show.
    const asked = command.text.trim() || (attachments.length > 0 ? `(Attached: ${attachments.map(a => a.title).join(', ')})` : command.text);
    const typed = quoted ? quoteThenAsk(quoted, asked) : asked;
    const text = pastedText
      ? `${typed}\n\n--- pasted ---\n${pastedText}`.trim()
      : typed;
    const sent = decision ? [] : attachments;
    turnFromUploadRef.current = sent.length > 0;
    // Fresh turn — reset the per-turn trace accumulator and the anchor clock.
    pendingTraceRef.current = new Map();
    traceDirtyRef.current = false;
    textRunsRef.current = 0;
    lastRunIsTextRef.current = false;
    // A card's answer is drawn as what it is — a receipt on the person's
    // side — and the composer, its files and its tags are left alone.
    const answerRow: ChatMessage | null = decision
      ? { role: 'user', content: '', decisionAnswer: { id: decision.view.id, question: decision.view.question, line: answerLine(decision.view, decision.answer), kind: decision.answer.kind, via: 'card' } }
      : null;
    setMessages(prev => [
      ...prev,
      answerRow ?? { role: 'user', content: text, ...(sent.length > 0 ? { attachments: sent } : {}) },
      { role: 'assistant', content: '', runs: [] },
    ]);
    if (decision) {
      setAnsweringDecisionId(decision.view.id);
      setDecisionError(null);
    } else {
      setComposerValue('');
      setPastedText(null);
      setAttachments([]);
      setAttachError(null);
    }
    setPhase('thinking');

    const refs = decision ? [] : contextRefs;
    if (!decision) {
      setContextRefs([]);
    }
    // What the NEXT message owes (0102), read off the tags the person put on
    // it: `@artifact` arms the contract, nothing else does. The tag is not a
    // record, so it is stripped before `context_refs` travels — the model is
    // never handed "a record called Artifact".
    const deliverable = deliverableFromRefs(refs);
    // `@artifact` says what the turn OWES, `@change` says what it must DO.
    // Neither points at a record, so neither travels as one.
    const recordRefs = refs.filter(r => !isArtifactTag(r) && !isIntentTag(r));
    // `@agent` / `@team` routes THIS turn to a specialist; the conversation
    // stays with its own agent and the reply is rendered under the
    // specialist's name (§9).
    const onceSlug = routeOnceRef.current;
    routeOnceRef.current = null;
    // An answer goes to the agent that asked: named, never routed.
    const asker = decision?.view.agentSlug ? agents.find(a => a.slug === decision.view.agentSlug) ?? null : null;
    const routed = asker ?? searchAgent ?? routeTurn(recordRefs, agents) ?? (onceSlug ? agents.find(a => a.slug === onceSlug) ?? null : null);
    const turnAgent = routed ?? agent;
    // A new thread nobody named an agent for is routed first: say so, rather
    // than a bare spinner, until the runtime says who answers.
    if (!routed && !isSearchOnly && conversationIdRef.current === null) {
      setActivity('Choosing who answers…');
    }
    // The reply is NOT attributed here from the tags: the runtime says who
    // speaks (`turn_agent`, the first frame) and the row records it. A label
    // stamped from a guess read "via QA" on a turn the product manager
    // answered (backlog 009).
    // A new thread is created by the turn itself (`create_conversation`) and
    // named in its first frame, rather than by a round trip of its own before
    // the turn could start.
    const createsThread = conversationIdRef.current === null && agent.slug !== '__search__';
    const activeConversationId = conversationIdRef.current;

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch('/rpc/agent/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: decision ? '' : text,
          agent_slug: turnAgent.slug,
          // The answer to a Decision, typed: the server records it and runs
          // the agent that asked — no routing, no intent read, no words.
          ...(decision ? { decision_answer: decisionAnswerWire(decision.view, decision.answer) } : {}),
          // Nobody named an agent for this turn: let the workspace choose
          // (`services/agents/router.ts`). The reply is attributed to whoever
          // answers, exactly as an `@mention` is; the reason rides with it.
          ...(!routed && !isSearchOnly && !decision ? { route: true } : {}),
          // The turn's deliverable contract (0102) — a typed field, decided
          // before the turn runs, not a judgement the model makes during it.
          deliverable,
          // R4: page context travels on every surface; a scoped dock also sends
          // its scope so the server folds it in as a ref (mergeScopeRef).
          ...(pageContextRef.current ? { page_context: pageContextRef.current } : {}),
          // The person's zone: the server judges "today" in it for this turn.
          time_zone: browserTimeZone(),
          ...(scopeRef ? { scope_ref: scopeRef } : {}),
          ...(recordRefs.length > 0 ? { context_refs: recordRefs } : {}),
          // The files, by artifact id — the server resolves them under this
          // org and files them under the message it stores.
          ...(sent.length > 0 ? { attachments: sent.map(a => a.id) } : {}),
          // With a conversation attached the server replays its own
          // (authoritative) history and ignores this list.
          ...(activeConversationId !== null ? { conversation_id: activeConversationId } : {}),
          ...(createsThread
            ? { create_conversation: true, ...(autonomy !== DEFAULT_AUTONOMY ? { conversation_autonomy: autonomy } : {}) }
            : {}),
          // How strong a model, how much it thinks (`libs/llm/modelPrefs.ts`).
          model_strength: modelPrefsRef.current.strength,
          thinking_effort: modelPrefsRef.current.effort,
          // How hard THIS message's turn works (`services/agents/effort.ts`):
          // a one-off from Dig deeper, else the gauge.
          effort_level: effortOnceRef.current ?? modelPrefsRef.current.level,
          conversation_history: messages
            .slice(-6)
            .filter(m => m.content.trim().length > 0)
            .map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (decision && !resp.ok) {
        // The answer did not land — already decided elsewhere, or not one
        // this Decision takes. Nothing was said for them: take the receipt
        // back, say why on the card, and read what is still open.
        const said = await resp.json().catch(() => null) as { error?: string } | null;
        setMessages(prev => prev.slice(0, -2));
        setDecisionError(said?.error ?? 'That answer did not go through.');
        setAnsweringDecisionId(null);
        streamingRef.current = false;
        setPhase('idle');
        setActivity(null);
        setTurnOutcome('completed');
        setDecisionsTick(n => n + 1);
        return;
      }
      if (!resp.ok || !resp.body) {
        // The server's own sentence when it sent one ("Too many attempts. Try
        // again in 30 seconds."), so the turn says why rather than a status.
        const reason = await resp.json().then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : null)).catch(() => null);
        throw new Error(reason ?? `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          if (!block.startsWith('data: ')) {
            continue;
          }
          try {
            const evt = JSON.parse(block.slice(6));
            if (evt.type === 'stream_meta') {
              // The thread this turn created, when it created one.
              if (createsThread && typeof evt.conversationId === 'number' && conversationIdRef.current === null) {
                setActiveConversation(agent.slug, evt.conversationId);
                // The name the server is about to give it — the first message,
                // cut — shown now rather than after the turn lands.
                setThreadMeta({ id: evt.conversationId, title: firstMessageTitle(text), titleSource: 'auto' });
              }
              // Resume handle — stash it; replayed events are counted below
              // so a reconnect asks only for what it missed.
              streamStashRef.current = { streamId: String(evt.streamId), agentSlug: agent.slug, count: 0, conversationId: conversationIdRef.current };
              writeStreamStash(streamStashRef.current);
            } else {
              if (streamStashRef.current) {
                streamStashRef.current.count += 1;
                // A new thread learns its id mid-stream; the stash learns it too.
                streamStashRef.current.conversationId ??= conversationIdRef.current;
                writeStreamStash(streamStashRef.current);
              }
              handleEvent(evt);
            }
          } catch (error) {
            // malformed event — skip it, the stream keeps going
            console.warn('useChatSession: failed to parse an SSE event', error);
          }
        }
      }
      // Stream closed — fold in any deltas still buffered and make sure
      // `content` is populated (covers streams that end without a `done`
      // event; see the `done` case for why content must be backfilled).
      flushDeltas();
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: finalizeTrace(m.trace),
      }));
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      setTurnOutcome('completed');
      setAnsweringDecisionId(null);
      streamStashRef.current = null;
      writeStreamStash(null);
      void stampLastAssistantId();
    } catch (err) {
      // User-initiated Stop (AbortError) is not an error — just finalize the
      // partial turn cleanly, no error breadcrumb and nothing to resume.
      const aborted = (err as Error).name === 'AbortError';
      if (aborted && stoppedControllerRef.current === controller) {
        // `handleStop` already flushed, closed THIS turn's rows and cleared
        // the phase + stash. Touching anything here would land on whatever
        // message is last NOW, which under ⌘⏎ is the NEXT turn's freshly
        // pushed assistant row.
        stoppedControllerRef.current = null;
        setTurnOutcome('stopped');
        return;
      }
      flushDeltas();
      // The connection died, nobody pressed Stop, and the server holds the
      // turn: re-attach once and let it finish into the same message.
      const reattach = !aborted ? streamStashRef.current : null;
      if (reattach) {
        console.warn('useChatSession: the stream dropped; re-attaching to the running turn', err);
        void resumeStream({ ...reattach }, { continueLatest: true });
        return;
      }
      streamingRef.current = false;
      setPhase('idle');
      setActivity(null);
      streamStashRef.current = null;
      if (aborted) {
        writeStreamStash(null);
      } else {
        console.warn('useChatSession: the streaming turn failed', err);
      }
      setTurnOutcome(aborted ? 'stopped' : 'error');
      appendToLatestAgent(m => ({
        ...m,
        content: m.content || (m.runs ?? [])
          .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
          .map(run => run.text)
          .join('\n\n'),
        trace: aborted ? finalizeTrace(m.trace) : (m.trace ?? []),
        // A turn that lost its connection is the same story as one whose run
        // threw: unfinished, not a failed tool (#114). Stopping on purpose is
        // neither, so an abort marks nothing.
        // The connection died before any ending arrived from the server, so
        // the client names one itself: text on screen means the answer stopped
        // part-way, nothing on screen means the turn never got going. A
        // deliberate stop is neither — `handleStop` has already marked it.
        ...(aborted
          ? {}
          : { status: (m.content || (m.runs ?? []).length > 0 ? 'incomplete' : 'failed') as TurnStatus, statusReason: (err as Error).message }),
      }));
    } finally {
      // NOTE: the stream stash is NOT cleared here — on a reload the fetch
      // rejects during unload and this finally raced the navigation, wiping
      // the resume handle. It clears on normal completion / Stop instead.
      //
      // Only clear the handle if it is still OURS: ⌘⏎ starts the next turn
      // before this one's reader has finished rejecting, and clearing then
      // would leave that turn's Stop with nothing to abort.
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [agent, agents, messages, pastedText, attachments, uploading, contextRefs, autonomy, handleEvent, appendToLatestAgent, flushDeltas, setActiveConversation, stampLastAssistantId, resumeStream]);

  /**
   * Attach files to the next message: upload now, chip now. A refused file
   * (wrong type, too big) becomes a sentence above the box; a transport
   * failure too. Nothing here waits for the turn — the person keeps typing.
   */
  const attachFiles = useCallback(async (files: File[]) => {
    // Checked here first, with the server's own rule and words, so a file
    // that cannot come along is said at once instead of after its upload.
    const refusedHere: string[] = [];
    const room = MAX_ATTACHMENTS - attachmentsRef.current.length - pendingRef.current.length;
    const accepted: File[] = [];
    for (const f of files) {
      const why = refusalFor(f);
      if (why) {
        refusedHere.push(why);
      } else if (accepted.length >= room) {
        refusedHere.push(`A message can carry up to ${MAX_ATTACHMENTS} files; ${f.name} was left off.`);
      } else {
        accepted.push(f);
      }
    }
    setAttachError(refusedHere.length > 0 ? refusedHere.join(' ') : null);
    if (accepted.length === 0) {
      return;
    }
    const picked = await Promise.all(accepted.map(shrinkImage));
    const batchKey = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const keys = picked.map((_, i) => `${batchKey}-${i}`);
    const abort = new AbortController();
    uploadBatchesRef.current.set(batchKey, { keys, abort });
    setPendingUploads(prev => [...prev, ...picked.map((f, i) => ({ key: keys[i]!, name: f.name, bytes: f.size, progress: 0 }))]);
    // One request per batch (uploads count against the chat rate limit), so
    // each chip's bar is its share of the bytes sent: files go up in order.
    const ends = picked.reduce<number[]>((acc, f) => [...acc, (acc.at(-1) ?? 0) + f.size], []);
    const starts = [0, ...ends.slice(0, -1)];
    const onProgress = (sent: number, total: number) => {
      const scale = ends.at(-1)! / Math.max(1, total);
      const at = sent * scale;
      setPendingUploads(prev => prev.map((p) => {
        const i = keys.indexOf(p.key);
        return i < 0 ? p : { ...p, progress: Math.max(0, Math.min(1, (at - starts[i]!) / Math.max(1, picked[i]!.size))) };
      }));
    };
    try {
      const { attachments: added, refused } = await uploadAttachments(picked, conversationIdRef.current, { onProgress, signal: abort.signal });
      // A chip dismissed mid-upload stays dismissed: its file is kept as the
      // person's artifact, like any removed chip, but not attached.
      const dismissed = new Set(keys.filter(k => dismissedUploadsRef.current.has(k)).map(k => picked[keys.indexOf(k)]!.name));
      const kept = added.filter(a => !dismissed.has(a.title));
      if (kept.length > 0) {
        setAttachments(prev => [...prev, ...kept.filter(a => !prev.some(p => p.id === a.id))]);
      }
      if (refused.length > 0) {
        setAttachError(prev => [prev, ...refused].filter(Boolean).join(' '));
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAttachError((err as Error).message || 'The upload failed. Try again.');
      }
    } finally {
      uploadBatchesRef.current.delete(batchKey);
      for (const k of keys) {
        dismissedUploadsRef.current.delete(k);
      }
      setPendingUploads(prev => prev.filter(p => !keys.includes(p.key)));
    }
  }, []);

  const removeAttachment = useCallback((id: number) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  /**
   * × on a chip still going up. The last file of its batch cancels the
   * request outright; otherwise the chip goes now and its file is left off
   * when the batch lands.
   */
  const cancelUpload = useCallback((key: string) => {
    for (const [batch, entry] of uploadBatchesRef.current) {
      if (!entry.keys.includes(key)) {
        continue;
      }
      dismissedUploadsRef.current.add(key);
      if (entry.keys.every(k => dismissedUploadsRef.current.has(k))) {
        entry.abort.abort();
        uploadBatchesRef.current.delete(batch);
      }
    }
    setPendingUploads(prev => prev.filter(p => p.key !== key));
  }, []);

  // Abort the in-flight turn (Stop button). The reader loop throws AbortError,
  // which the catch above treats as a clean finalize (no error breadcrumb).
  const handleStop = useCallback(async () => {
    if (!streamingRef.current) {
      // Waiting for a reply with no stream to it (after a reload): Stop ends
      // the wait and hands the composer back (Chris, 2026-09-29: "Tapping
      // stop does not unstuck the chat").
      if (waitingRef.current) {
        waitingRef.current = false;
        setPhase('idle');
        setActivity(null);
        setTurnOutcome('stopped');
      }
      return;
    }
    streamingRef.current = false;
    stoppedControllerRef.current = abortRef.current;
    flushDeltas();
    // Close this turn's rows HERE rather than in the abort catch, so a
    // stop-and-send lands the tail on the turn that was stopped.
    appendToLatestAgent(m => ({
      ...m,
      content: m.content || (m.runs ?? [])
        .filter((run): run is Extract<AgentRun, { type: 'text' }> => run.type === 'text')
        .map(run => run.text)
        .join('\n\n'),
      trace: finalizeTrace(m.trace),
      // Marked live as well as stored, so the bubble says the same thing now
      // as it will after a reload.
      status: 'stopped' as const,
    }));
    setPhase('idle');
    setActivity(null);
    setTurnOutcome('stopped');
    // Tell the server, and WAIT for it before aborting.
    //
    // Aborting only closes this browser's socket, which is exactly what a
    // locked phone does — and that turn has to keep running so the person can
    // come back to it. Stopping is a decision, so it is sent as one, and the
    // row is stored `stopped` instead of `complete`.
    //
    // The wait is what makes the two agree. The run reaches its own end on its
    // own schedule; if the stop were still in flight when it got there, the
    // row would say `complete` while this bubble said `stopped`, and a reload
    // would quietly rewrite what the person remembers doing. Everything above
    // has already happened, so the screen is not waiting on this.
    const streamId = streamStashRef.current?.streamId;
    // A stopped turn has nothing to resume.
    streamStashRef.current = null;
    writeStreamStash(null);
    if (streamId) {
      try {
        await fetch('/rpc/agent/stream/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream_id: streamId }),
        });
      } catch (error) {
        // The turn still stops here, but the stored row will say `complete`
        // and nobody will know why it looks cut short. Worth a line.
        console.warn('useChatSession: the server was not told this turn was stopped', error);
      }
    }
    abortRef.current?.abort();
  }, [flushDeltas, appendToLatestAgent]);

  /**
   * ⌘⏎ / the queued-row "send now": end the running turn and put this message
   * in immediately, rather than waiting behind it. Enter alone never does
   * this — killing a turn somebody wanted is not a thing to do by surprise.
   */
  const sendNow = useCallback(async (text: string) => {
    handleStop();
    await sendMessage(text);
  }, [handleStop, sendMessage]);

  /**
   * Dig deeper: ask the same question again, one level up (`effort_result`'s
   * `next`). The level holds for that one message; the gauge is left alone.
   * @param assistantIndex - The turn being dug into, by its place in `messages`.
   * @param level - The level to run at.
   */
  const digDeeper = useCallback((assistantIndex: number, level: EffortLevel) => {
    const asked = messages.slice(0, assistantIndex).reverse().find(m => m.role === 'user')?.content.trim();
    if (!asked || streamingRef.current) {
      return;
    }
    effortOnceRef.current = level;
    void sendMessage(asked).finally(() => {
      effortOnceRef.current = null;
    });
  }, [messages, sendMessage]);

  const handlePickSuggestion = useCallback((prompt: string) => {
    setComposerValue(prompt);
    void sendMessage(prompt);
  }, [sendMessage]);

  // Handoff from another page (e.g. the Briefings composer): a stashed
  // { question, contextTitle, context } starts this chat — the context rides
  // inside the first message. A stashed `agentSlug` (the brief's team lead)
  // routes that ONE turn (§9.10); the conversation stays with the workspace
  // agent. One-shot: the stash is cleared before sending.
  const handoffSentRef = useRef(false);
  useEffect(() => {
    if (bootTarget === null || handoffSentRef.current) {
      return;
    }
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('vocion_chat_handoff');
      if (raw) {
        sessionStorage.removeItem('vocion_chat_handoff');
      }
    } catch (error) {
      console.warn('useChatSession: could not read the hand-off stash', error);
      return;
    }
    if (!raw) {
      return;
    }
    handoffSentRef.current = true;
    try {
      const { question, contextTitle, context, excerpt, agentSlug: target } = JSON.parse(raw) as {
        question: string;
        contextTitle: string;
        context: string;
        excerpt?: string;
        agentSlug?: string;
      };
      const parts = [question];
      if (excerpt) {
        parts.push(`---\nThe question is specifically about this highlighted passage:\n> ${excerpt.replaceAll('\n', '\n> ')}`);
      }
      parts.push(`---\nCONTEXT — "${contextTitle}" (carried over from the Briefings page):\n\n${context}`);
      const message = parts.join('\n\n');
      if (target && target !== agent.slug && agents.some(a => a.slug === target)) {
        routeOnceRef.current = target;
      }
      void sendMessage(message);
    } catch (error) {
      // malformed stash — ignore, nothing to send
      console.warn('useChatSession: could not parse the hand-off stash', error);
    }
  }, [sendMessage, agent.slug, agents, bootTarget]);

  /**
   * BUILD IT (Chris, 2026-10-04: "I should have a path to just push the idea
   * into the software factory from chat … Simple. Magical. Fast."). A card a
   * turn drew is built by a Decision the person takes with their press
   * (`decisions.build`): the workspace's intake owner hears a typed record —
   * build this card, its facts, its id — and files it through the intake's
   * own gates. Nothing is written as the person's words.
   * @param card - The card's chip.
   * @param card.id - Its artifact id.
   * @param card.title - Its name.
   */
  const buildFromCard = useCallback(async (card: { id: number; title: string }) => {
    const conversation = conversationIdRef.current;
    if (conversation === null) {
      return;
    }
    try {
      const view = await client.decisions.build({ conversationId: conversation, artifactId: card.id }) as DecisionView;
      await sendMessage('', { view, answer: { kind: 'option', optionIds: ['build'] } });
    } catch (error) {
      console.warn('useChatSession: Build it did not go through', error);
      setDecisionError(`Build it did not go through: ${(error as Error).message}`);
    }
  }, [sendMessage]);

  /**
   * Answer the docked Decision — from its card's keys or a click. The answer
   * travels TYPED to the agent that asked; nothing is written as the
   * person's words (`sendMessage`'s `decision`).
   */
  const answerDecision = useCallback((view: DecisionView, answer: DecisionAnswer) => {
    const here = conversationIdRef.current !== null && view.conversationId === conversationIdRef.current;
    if (here) {
      // The agent is still answering the last one: the answer is held, the
      // card says it is going, and it goes the moment the turn lands — never
      // dropped because the person was quicker than the reply.
      if (streamingRef.current) {
        heldAnswersRef.current = [...heldAnswersRef.current.filter(h => decisionKey(h.view) !== decisionKey(view)), { view, answer }];
        setAnsweringDecisionId(view.id);
        return;
      }
      void sendMessage('', { view, answer });
      return;
    }
    // Waiting elsewhere (Needs you, a proposal from no conversation): the
    // answer is recorded where it lives and no turn follows; the dock says
    // what it did, once.
    setAnsweringDecisionId(view.id);
    setDecisionError(null);
    void client.decisions.answer({ ...decisionAnswerWire(view, answer), subject: view.subject ?? 'ask' })
      .then((out) => {
        const effect = (out as { effect?: { runId: number; actionId: string; status: string; undoable: boolean; label: string } | null }).effect;
        setWaitingDecisions(prev => prev.filter(d => decisionKey(d) !== decisionKey(view)));
        setDockNotice({
          line: `${answer.kind === 'skip' ? 'Skipped' : answer.kind === 'free_text' ? 'Answered' : `Chose ${answerLine(view, answer)}`} · ${view.question}`,
          ...(effect && effect.status === 'done' ? { receipt: { runId: effect.runId, actionId: effect.actionId, label: effect.label, undoable: effect.undoable } } : {}),
        });
      })
      .catch((error: unknown) => {
        setDecisionError((error as Error).message || 'That answer did not go through.');
        setDecisionsTick(n => n + 1);
      })
      .finally(() => setAnsweringDecisionId(null));
  }, [sendMessage]);

  // A held answer goes as soon as the turn it waited on lands — before any
  // queued message, because answers come first.
  useEffect(() => {
    if (isStreaming || streamingRef.current || heldAnswersRef.current.length === 0) {
      return;
    }
    const [next, ...rest] = heldAnswersRef.current;
    heldAnswersRef.current = rest;
    void sendMessage('', next!);
  }, [isStreaming, turnOutcome, sendMessage]);

  /** A flow the card opened came back failed (a login refused): the card says why; nothing is answered. */
  const failDecision = useCallback((message: string) => {
    setDecisionError(message);
  }, []);

  // Reset only the in-memory transcript. Does NOT touch the per-agent saved
  // conversation — used by agent-switch, which must leave the other agent's
  // thread resumable.
  const resetTranscript = useCallback(() => {
    setMessages([]);
    setAllDocuments([]);
    setPhase('idle');
    conversationIdRef.current = null;
    setConversationId(null);
  }, []);

  // "New chat" — explicitly forget THIS agent's thread so the next send
  // starts a fresh persisted one and a later remount doesn't resume it.
  const handleNewChat = useCallback(() => {
    resetTranscript();
    setActiveConversation(agent.slug, null);
  }, [resetTranscript, agent.slug, setActiveConversation]);

  /** The workspace lead — the config behind the workspace agent. */
  const leadSlug = defaultAgentSlug(agents);

  // Inline citation tap — open the Sources drawer focused on that `[n]`.
  const handleCitationClick = useCallback((n: number) => {
    setFocusCitation(n);
    setSourcesOpen(true);
  }, []);

  // "Sources" affordance on a message — open the drawer on the full set,
  // with no single citation singled out.
  const handleShowSources = useCallback(() => {
    setFocusCitation(null);
    setSourcesOpen(true);
  }, []);

  const agentSlugForChats = agent.slug;
  useEffect(() => {
    if (agentSlugForChats === '__search__') {
      setRecentChats([]);
      return;
    }
    let cancelled = false;
    void client.conversations.list({ agentSlug: agentSlugForChats, limit: 12 })
      .then((rows) => {
        if (!cancelled) {
          setRecentChats((rows as Array<{ id: number; title: string | null; titleSource?: ConversationTitleSource }>).map(row => ({
            id: row.id,
            title: row.title || nounCode('conversation', row.id),
            ...(row.titleSource ? { titleSource: row.titleSource } : {}),
          })));
        }
      })
      .catch((error) => {
        console.warn('useChatSession: failed to list recent conversations', error);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlugForChats, booted, phase, titleTick]);

  // The open thread's name: the recent list when it holds it (refetched after
  // every turn, so a generated name arrives there), else what was last read.
  const listedThread = conversationId === null ? undefined : recentChats.find(c => c.id === conversationId);
  const conversationTitle = conversationId === null
    ? null
    : listedThread?.title ?? (threadMeta?.id === conversationId ? threadMeta.title : null);
  const conversationTitleSource = listedThread?.titleSource ?? (threadMeta?.id === conversationId ? threadMeta.titleSource : undefined);

  // A generated name is written a second or two after the first reply lands,
  // in the background. While the open thread's name is still the first-message
  // cut and the turn is over, look again twice — then stop: a model that
  // failed leaves the cut, which is already on screen.
  const awaitingName = conversationId !== null && phase === 'idle' && conversationTitleSource === 'auto' && messages.some(m => m.role === 'assistant');
  useEffect(() => {
    if (!awaitingName) {
      return;
    }
    const timers = [2_500, 7_000].map(ms => setTimeout(() => setTitleTick(n => n + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [awaitingName, conversationId]);

  /**
   * A person names the open thread. Optimistic in the header, the rail and the
   * history list; a failed write puts the old name back.
   */
  const renameConversation = useCallback(async (next: string) => {
    const id = conversationIdRef.current;
    const title = next.split(/\s+/).filter(Boolean).join(' ');
    if (id === null || !title) {
      return;
    }
    const previous = { list: recentChats, meta: threadMeta };
    setThreadMeta({ id, title, titleSource: 'person' });
    setRecentChats(rows => rows.map(r => (r.id === id ? { ...r, title, titleSource: 'person' } : r)));
    try {
      await client.conversations.rename({ id, title });
    } catch (error) {
      console.warn('useChatSession: could not rename the conversation', error);
      setThreadMeta(previous.meta);
      setRecentChats(previous.list);
    }
  }, [recentChats, threadMeta]);

  // History picker: load a past conversation into the transcript + make it
  // the active thread (so new turns append to it).
  const handlePickConversation = useCallback(async (id: number) => {
    try {
      const conv = await client.conversations.get({ id });
      const { messages: hydrated, documents: restoredDocs } = hydrateTranscript(
        (conv.messages ?? []) as PersistedMessageRow[],
        nameOfAgent,
      );
      const slug = (conv as { agentSlug?: string }).agentSlug ?? agent.slug;
      if (slug !== agent.slug) {
        // Picked a thread belonging to another agent (the bubble's history
        // panel is per-agent, but a stale list can still offer one) — follow
        // it rather than appending this agent's turns to someone else's thread.
        hydratedSlugRef.current = slug;
        setCurrentSlug(slug);
      }
      setActiveConversation(slug, id);
      setThreadMeta(readThreadMeta(conv));
      setAutonomyState(readAutonomy(conv));
      setModelPrefsState(readModelPrefs(conv));
      setMessages(hydrated);
      setAllDocuments(restoredDocs);
      setPhase('idle');
    } catch (error) {
      // conversation gone — leave the current transcript
      console.warn('useChatSession: could not load conversation', id, error);
    }
  }, [agent.slug, setActiveConversation]);

  // The standing preference seeds a fresh thread once on mount (client-only
  // read, so not during render).
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setAutonomyState(readPreferredAutonomy());
  }, []);

  /**
   * Change how recommended actions behave in this thread — persisted on the
   * conversation when one exists, and remembered as the preference for the
   * next new one (0094).
   */
  const setAutonomy = useCallback((next: ConversationAutonomy) => {
    setAutonomyState(next);
    writePreferredAutonomy(next);
    const id = conversationIdRef.current;
    if (id !== null) {
      client.conversations.setAutonomy({ id, autonomy: next }).catch((error) => {
        console.warn('useChatSession: could not persist the autonomy setting', error);
      });
    }
  }, []);

  /** Change how strong a model answers this thread and how much it thinks — persisted on the conversation when one exists. */
  const setModelPrefs = useCallback((next: ModelPrefs) => {
    setModelPrefsState(next);
    const id = conversationIdRef.current;
    if (id !== null) {
      client.conversations.setModel({ id, strength: next.strength, effort: next.effort }).catch((error) => {
        console.warn('useChatSession: could not persist the model setting', error);
      });
    }
  }, []);

  /**
   * A follow-up pill under the latest answer: its words go as the person's
   * next message, a real turn (chips are prompts).
   */
  const sendSuggestion = useCallback((s: import('@/libs/chat/suggestions').Suggestion) => {
    void sendMessage(s.prompt);
  }, [sendMessage]);

  /**
   * A thumb (and optional note) on one assistant turn. Optimistic: the
   * message shows the rating at once; the server write is best-effort and a
   * failure logs rather than reverting — a thumb is not worth a modal.
   */
  const handleFeedback = useCallback(async (messageId: number, rating: 'up' | 'down' | null, note?: string | null) => {
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, feedback: { rating, note: rating ? (note ?? m.feedback?.note ?? null) : null } } : m)));
    try {
      await client.conversations.feedback({ messageId, rating, note: note ?? null });
    } catch (error) {
      console.warn('useChatSession: could not save feedback', error);
    }
  }, []);

  const addContextRef = useCallback((ref: ContextRef) => {
    setContextRefs(prev => (prev.some(r => r.type === ref.type && r.id === ref.id) ? prev : [...prev, ref]));
  }, []);
  const removeContextRef = useCallback((ref: ContextRef) => {
    setContextRefs(prev => prev.filter(r => !(r.type === ref.type && r.id === ref.id)));
  }, []);

  /** Threads matching a query — the history popover's search (blank = recent). */
  const searchConversations = useCallback(async (q: string) => {
    try {
      return await client.conversations.search({ q, limit: 20 });
    } catch (error) {
      console.warn('useChatSession: conversation search failed', error);
      return [];
    }
  }, []);

  /**
   * The send queue (P0 of the steering work): Enter mid-turn appends here
   * instead of being swallowed by a disabled box, and the queue drains itself
   * the moment the turn lands. See `queueReducer.ts` for the contract.
   */
  const sendQueue = useSendQueue({
    conversationId,
    streaming: isStreaming,
    outcome: turnOutcome,
    send: sendMessage,
  });

  /**
   * Enter while a turn is running. Queues rather than sends — the running turn
   * is not interrupted, and nothing the person typed is lost.
   */
  const queueMessage = useCallback((text: string) => {
    sendQueue.enqueue(text);
    setComposerValue('');
  }, [sendQueue]);

  /** Clicking a queued row: it leaves the queue and goes back in the box. */
  const editQueued = useCallback((id: string) => {
    const text = sendQueue.edit(id);
    if (text !== null) {
      setComposerValue(prev => (prev.trim() ? `${text}\n${prev}` : text));
    }
  }, [sendQueue]);

  return {
    /** Build it on a card a turn drew (`ArtifactChips`). */
    buildFromCard,
    /** The agent this chat is talking to right now. */
    agent,
    /** Chips for the empty state — the picked agent's own, else the workspace set. */
    emptyChips,
    /** True while a picked agent's chips are still being synthesized. */
    emptyChipsLoading,
    /** Greeting for the empty state (workspace name, or the picked agent's). */
    emptyGreeting,
    /** Composer placeholder: neutral on the workspace view, the agent's own once picked. */
    composerPlaceholder,
    messages,
    composerValue,
    setComposerValue,
    /** Captured pasted material for the composer chip; travels with the next send. */
    pastedText,
    setPastedText,
    /** Files attached to the next message — uploaded, chips showing. */
    attachments,
    /** Files still going up. */
    uploading,
    /** The chips with progress bars, one per file still going up. */
    pendingUploads,
    cancelUpload,
    /** Why the last attach did not fully land, for the line above the box. */
    attachError,
    clearAttachError: () => setAttachError(null),
    attachFiles,
    removeAttachment,
    isStreaming,
    activity,
    /** The Decisions this conversation waits on, oldest first; the first is docked above the composer. */
    openDecisions,
    /** What else waits on this person — Needs you questions, proposals from no conversation — queued behind them. */
    waitingDecisions,
    /** What an answer from the queue did, said once in the dock. */
    dockNotice,
    dismissDockNotice: () => setDockNotice(null),
    /** A flow a card opened came back failed: say why on the card. */
    failDecision,
    /** Answer a Decision, typed — never as the person's words. */
    answerDecision,
    /** The Decision whose answer is on its way. */
    answeringDecisionId,
    /** Why the last answer did not land. */
    decisionError,
    /**
     * An agent's name, by slug — the asker on a Decision's card.
     * @param slug
     */
    agentNameOf: (slug: string | null) => (slug ? nameOfAgent(slug) : null),
    agentAccentOf: (slug: string | null) => (slug ? rosterRef.current.find(a => a.slug === slug)?.accent ?? null : null),
    sourcesOpen,
    setSourcesOpen,
    focusCitation,
    allDocuments,
    citedIndices,
    /** False until the restore-agent + resume-conversation sequence settles. */
    booted,
    /** True while a saved thread is about to hydrate — show a transcript skeleton, not chips. */
    resuming,
    /** Recent threads for this agent, for the history pickers. */
    recentChats,
    /** Id of the thread new turns append to. Null until the first send. */
    conversationId,
    /** The open thread's name; null for a new chat that has not been sent yet. */
    conversationTitle,
    /** Name the open thread (sets its title source to `person`). */
    renameConversation,
    sendMessage,
    sendSuggestion,
    handleStop,
    /** How the last turn ended — `stopped`/`error` hold the queue instead of flushing it. */
    turnOutcome,
    /** Queued messages waiting for the running turn to land, oldest first. */
    queuedMessages: sendQueue.items,
    /** True when a stopped or failed turn left the queue unsent. */
    queueHeld: sendQueue.held,
    /** Enter mid-turn — append to the queue. */
    queueMessage,
    /** The ✕ on a queued row. */
    dropQueued: sendQueue.drop,
    /** Click a queued row to pull it back into the composer. */
    editQueued,
    /** Acknowledge the "not sent" notice. */
    releaseQueueNotice: sendQueue.release,
    /** ⌘⏎ — stop the running turn and send this message right now. */
    sendNow,
    handlePickSuggestion,
    handleNewChat,
    /** The workspace lead's slug — the config behind the one workspace agent (§9.10). */
    leadSlug,
    /** The name the surface speaks as. */
    workspaceName,
    handleCitationClick,
    handleShowSources,
    handlePickConversation,
    /** How recommended actions behave in this thread (0094). */
    autonomy,
    setAutonomy,
    /** How strong a model answers this thread and how much it thinks (`libs/llm/modelPrefs.ts`). */
    modelPrefs,
    setModelPrefs,
    /** Re-ask a turn's question one effort level up (Dig deeper). */
    digDeeper,
    /** Thumb + note on an assistant turn, by persisted message id. */
    handleFeedback,
    /** Records the next message is about (`@` tags). */
    contextRefs,
    addContextRef,
    removeContextRef,
    /** Search threads by title or content — the history popover. */
    searchConversations,
    /** The rail's saved geometry for this user (0094); null until the pointer resolves or when never set. */
    railState: lastViewed ? { railWidth: lastViewed.railWidth ?? null, railOpen: lastViewed.railOpen ?? null } : null,
    railLoading: lastViewedLoading,
    persistRail,
  };
}

/**
 * The name a persisted conversation carries, and who wrote it.
 * @param conv - A conversation row as the router returns it.
 */
function readThreadMeta(conv: unknown): { id: number; title: string; titleSource: ConversationTitleSource } | null {
  const c = conv as { id?: unknown; title?: unknown; titleSource?: unknown } | null;
  if (typeof c?.id !== 'number' || typeof c.title !== 'string') {
    return null;
  }
  const source = c.titleSource === 'generated' || c.titleSource === 'person' ? c.titleSource : 'auto';
  return { id: c.id, title: c.title, titleSource: source };
}

/**
 * The autonomy rung a persisted conversation carries; a row that says nothing
 * usable is at the default.
 * @param conv - A conversation row as the router returns it.
 */
function readAutonomy(conv: unknown): ConversationAutonomy {
  const a = (conv as { autonomy?: unknown } | null)?.autonomy;
  return a === 'ask' || a === 'act-within-bounds' ? a : DEFAULT_AUTONOMY;
}

/**
 * The turn a highlighted passage opens: the passage as a quote, then what the
 * person typed (or nothing — the quote is the question).
 * @param passage - The highlighted text.
 * @param asked - What they typed.
 */
export function quoteThenAsk(passage: string, asked: string): string {
  const quote = passage.split('\n').map(line => `> ${line}`).join('\n');
  return asked.trim() ? `${quote}\n\n${asked.trim()}` : quote;
}
