import { setRequestLocale } from 'next-intl/server';
import { loadChatAgentContext } from '@/features/dashboard/chat/agentOptions';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { parseConversationParam } from '@/features/dashboard/chat/resumeRule';
import { clerkAuth as auth } from '@/libs/Auth';
import { listArtifactsByIds } from '@/services/ArtifactService';
import { attachmentFromArtifact } from '@/services/chat/attachments';
import { buildWorkspaceChips } from '@/services/chat/suggestions';
import { workspaceGreeting } from '@/services/chat/workspaceLabel';
import { parseAttachParam } from '@/services/share/intake';

/**
 * Chat surface. Server-loads the project's agents from the DB so the
 * client-side ChatShell has the workspace's real roster — no hardcoded
 * fallback. A project with no agents authored still gets the virtual search
 * entry, so the list is empty only when no workspace resolved at all; the
 * shell renders an empty state for that instead of failing to pick a default.
 *
 * Deep-linkable: `?prompt=<text>` pre-fills the composer without sending,
 * `?attach=<ids>` starts uploaded files in it (Share to Vocion), and
 * `?conversation=<id>` resumes a thread — otherwise the page opens a NEW
 * conversation with the one workspace agent (agent-chat-surface.md §9, §9.10).
 * `?agent=<slug>` is still accepted for old links but no longer picks an
 * agent: there is nothing to pick.
 *
 * Deliberately chrome-free: no TitleBar, no header strip — "insert quarter,
 * shoot aliens." The surface is messages + composer; New chat lives behind a
 * single ⋯ menu that ChatShell portals into the shell top bar.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function ChatPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ agent?: string; prompt?: string; conversation?: string; new?: string; attach?: string }>;
}) {
  const { locale } = await props.params;
  const { prompt: seededPrompt, conversation, new: startNew, attach } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();

  // Shared with the floating chat bubble — same ordering, same default agent.
  const { agents, coordinatorSlug, accountName, projectName } = orgId
    ? await loadChatAgentContext(orgId)
    : { agents: [], coordinatorSlug: undefined, accountName: undefined, projectName: undefined };

  // Workspace-scoped greeting ("Metacto" eyebrow + "Ask Revenue") — a SHORT
  // label composed from the account + project names, never an agent name.
  const greeting = workspaceGreeting(accountName, projectName);

  // Dynamic empty-state chips: urgency (recent brief / review queue) first,
  // then team capabilities across agents. Falls back to capability chips when
  // no live urgency data exists (the pre-F1 default).
  const chips = orgId
    ? await buildWorkspaceChips({ orgId, agents, coordinatorSlug })
    : [];

  // `?attach=<ids>` — files the phone's share sheet already uploaded
  // (`/api/mobile/share`) start in the composer as chips. Only this
  // workspace's person-authored `file` artifacts qualify, the same rule the
  // stream route applies when the turn is sent; a video is kept out because
  // no model reads one (it is named in the seeded prompt instead).
  const attachIds = parseAttachParam(attach);
  const initialAttachments = orgId && attachIds.length > 0
    ? (await listArtifactsByIds({ orgId, ids: attachIds }))
        .filter(row => row.kind === 'file' && row.lastAuthorKind === 'human')
        .map(attachmentFromArtifact)
        .filter(a => !a.contentType.startsWith('video/'))
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatShell
        agents={agents}
        greeting={greeting}
        suggestions={chips.map(c => ({ label: c.label, prompt: c.prompt }))}
        initialComposerValue={seededPrompt}
        initialAttachments={initialAttachments.length > 0 ? initialAttachments : undefined}
        conversationId={parseConversationParam(conversation)}
        // `?new=1` — ⌘⇧O or the palette from a page with no chat surface: start
        // a fresh thread instead of resuming this browser session's.
        startNew={startNew === '1'}
      />
    </div>
  );
}
