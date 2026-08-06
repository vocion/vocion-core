import { setRequestLocale } from 'next-intl/server';
import { buildAgentOptions } from '@/features/dashboard/chat/agentOptions';
import { ChatShell } from '@/features/dashboard/chat/ChatShell';
import { clerkAuth as auth } from '@/libs/Auth';

/**
 * Chat surface. Server-loads the project's agents from the DB so the
 * client-side ChatShell has a real list to pick from — no hardcoded
 * fallback. When the project has no agents authored, ChatShell renders
 * a "no agents yet" empty state pointing at the authoring path.
 *
 * Deliberately chrome-free: no page TitleBar — the agent header inside
 * ChatShell IS the identity of this surface (eyebrow · name · scope),
 * so the agent isn't announced four times on one screen.
 * @param props - Page component props
 * @param props.params - Promise containing the locale string from the dynamic route
 */
export default async function ChatPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const agents = orgId ? await buildAgentOptions(orgId) : [];

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <ChatShell agents={agents} />
    </div>
  );
}
