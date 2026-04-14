'use client';

import * as Popover from '@radix-ui/react-popover';
import { FileText, Globe, Mail, MessageSquare, Sparkles } from 'lucide-react';

type ContextAction = {
  label: string;
  skillSlug?: string;
  icon: React.ReactNode;
  description: string;
  onClick?: () => void;
};

// Actions available per business object type
const objectTypeActions: Record<string, ContextAction[]> = {
  discovery_call: [
    {
      label: 'Summarize Call',
      skillSlug: 'discovery_summary',
      icon: <Sparkles className="size-3.5" />,
      description: 'Generate a structured summary with prospect, budget, timeline',
    },
    {
      label: 'Draft Follow-up Email',
      skillSlug: 'draft_followup_email',
      icon: <Mail className="size-3.5" />,
      description: 'Draft a capabilities follow-up email for the prospect',
    },
    {
      label: 'Find Related Conversations',
      skillSlug: 'find_related_conversations',
      icon: <MessageSquare className="size-3.5" />,
      description: 'Search Gmail, Slack & HubSpot notes for related threads',
    },
    {
      label: 'Generate Proposal',
      skillSlug: 'draft_mvp_proposal',
      icon: <FileText className="size-3.5" />,
      description: 'Draft an MVP proposal + Gamma presentation from this call',
    },
    {
      label: 'Search Everything',
      skillSlug: 'search_everything',
      icon: <Globe className="size-3.5" />,
      description: 'Search all sources: email, Slack, HubSpot, Drive, Zoom',
    },
  ],
  // Generic actions for any call/meeting
  _call: [
    {
      label: 'Summarize',
      skillSlug: 'discovery_summary',
      icon: <Sparkles className="size-3.5" />,
      description: 'Generate a summary of this call',
    },
    {
      label: 'Find Related Conversations',
      skillSlug: 'find_related_conversations',
      icon: <MessageSquare className="size-3.5" />,
      description: 'Search Gmail, Slack & HubSpot notes for related threads',
    },
    {
      label: 'Search Everything',
      skillSlug: 'search_everything',
      icon: <Globe className="size-3.5" />,
      description: 'Search all sources: email, Slack, HubSpot, Drive, Zoom',
    },
  ],
};

type ContextMenuProps = {
  /** The text/title that was identified as a business object */
  title: string;
  /** The detected object type (e.g., discovery_call) or source type (e.g., zoom) */
  objectType?: string;
  sourceType?: string;
  /** Callback when an action is selected — sends a message to the agent */
  onAction: (message: string) => void;
  children: React.ReactNode;
};

export const ContextMenu = ({ title, objectType, sourceType, onAction, children }: ContextMenuProps) => {
  // Determine which actions to show
  let actions: ContextAction[] = [];
  if (objectType && objectTypeActions[objectType]) {
    actions = objectTypeActions[objectType]!;
  } else if (sourceType === 'zoom') {
    actions = objectTypeActions._call ?? [];
  }

  if (actions.length === 0) {
    return <>{children}</>;
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <span className="cursor-pointer border-b border-dashed border-muted-foreground/40 transition-colors hover:border-primary/60">
          {children}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          avoidCollisions
          className="z-[200] w-72 animate-in rounded-lg border border-border bg-popover p-1.5 shadow-lg fade-in-0 zoom-in-95"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className="mb-1 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            Actions for &quot;
            {title.slice(0, 30)}
            {title.length > 30 ? '...' : ''}
            &quot;
          </div>
          {actions.map(action => (
            <Popover.Close key={action.label} asChild>
              <button
                type="button"
                onClick={() => {
                  const msg = action.skillSlug === 'discovery_summary'
                    ? `Summarize the "${title}" call`
                    : action.skillSlug === 'draft_followup_email'
                      ? `Draft a follow-up email for the "${title}" call`
                      : action.skillSlug === 'find_related_conversations'
                        ? `Find related conversations for "${title}" — search Gmail, Slack, and HubSpot notes for threads and messages related to this call`
                        : action.skillSlug === 'draft_mvp_proposal'
                          ? `Generate an MVP proposal for the "${title}" call — create a full proposal document with scope, architecture, timeline, and engagement model`
                          : action.skillSlug === 'search_everything'
                            ? `Search everything related to "${title}" — check all sources including email, Slack, HubSpot records, Google Drive docs, and Zoom calls`
                            : `Run ${action.label} on "${title}"`;
                  onAction(msg);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                  {action.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{action.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{action.description}</div>
                </div>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
