'use client';

import { FileSearch, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';

interface ContextAction {
  label: string;
  skillSlug?: string;
  icon: React.ReactNode;
  description: string;
  onClick?: () => void;
}

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
      label: 'Find Related Emails',
      skillSlug: 'find_related_emails',
      icon: <FileSearch className="size-3.5" />,
      description: 'Search for email threads with this prospect',
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
      label: 'Find Related Emails',
      skillSlug: 'find_related_emails',
      icon: <FileSearch className="size-3.5" />,
      description: 'Search for related email threads',
    },
  ],
};

interface ContextMenuProps {
  /** The text/title that was identified as a business object */
  title: string;
  /** The detected object type (e.g., discovery_call) or source type (e.g., zoom) */
  objectType?: string;
  sourceType?: string;
  /** Callback when an action is selected — sends a message to the agent */
  onAction: (message: string) => void;
  children: React.ReactNode;
}

export const ContextMenu = ({ title, objectType, sourceType, onAction, children }: ContextMenuProps) => {
  const [showMenu, setShowMenu] = useState(false);

  // Determine which actions to show
  let actions: ContextAction[] = [];
  if (objectType && objectTypeActions[objectType]) {
    actions = objectTypeActions[objectType]!;
  } else if (sourceType === 'zoom') {
    actions = objectTypeActions._call ?? [];
  }

  if (actions.length === 0) return <>{children}</>;

  return (
    <span
      className="relative inline"
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
    >
      <span className="cursor-pointer border-b border-dashed border-muted-foreground/40 transition-colors hover:border-primary/60">
        {children}
      </span>

      {showMenu && (
        <div className="absolute top-full left-0 z-[100] mt-1 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
          <div className="mb-1 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            Actions for &quot;{title.slice(0, 30)}{title.length > 30 ? '...' : ''}&quot;
          </div>
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                setShowMenu(false);
                // Send a natural language message to the agent to run this skill
                const msg = action.skillSlug === 'discovery_summary'
                  ? `Summarize the "${title}" call`
                  : action.skillSlug === 'draft_followup_email'
                    ? `Draft a follow-up email for the "${title}" call`
                    : action.skillSlug === 'find_related_emails'
                      ? `Find emails and threads related to "${title}"`
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
          ))}
        </div>
      )}
    </span>
  );
};
