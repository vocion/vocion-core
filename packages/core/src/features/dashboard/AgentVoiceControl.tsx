'use client';

/**
 * How this agent talks in chat, set from its page — one tap per setting,
 * saved at once with Undo (done for you). The same service as the API, MCP
 * and chat (`services/agents/agentVoice.ts`); what the workspace YAML says
 * stays underneath, and "Reset" returns to it.
 */
import type { ResolvedVoice, Voice } from '@/libs/agents/voice';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { client } from '@/libs/Orpc';

type Choice<T> = { value: T; label: string };

const LENGTHS: Array<Choice<ResolvedVoice['length']>> = [
  { value: 'brief', label: 'Brief' },
  { value: 'standard', label: 'Standard' },
  { value: 'detailed', label: 'Detailed' },
];
const NARRATION: Array<Choice<ResolvedVoice['narration']>> = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];
const CREATIVITY: Array<Choice<number>> = [
  { value: 0.2, label: 'Conservative' },
  { value: 0.5, label: 'Balanced' },
  { value: 0.8, label: 'Inventive' },
];

function nearest(c: number): number {
  return CREATIVITY.reduce((a, b) => (Math.abs(b.value - c) < Math.abs(a.value - c) ? b : a)).value;
}

function Segmented<T extends string | number>({ label, hint, value, choices, onPick, busy }: { label: string; hint: string; value: T; choices: Array<Choice<T>>; onPick: (v: T) => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      </div>
      <div role="group" aria-label={label} className="flex rounded-md border border-border/60 p-0.5">
        {choices.map(c => (
          <button
            key={String(c.value)}
            type="button"
            aria-pressed={c.value === value}
            disabled={busy}
            onClick={() => c.value !== value && onPick(c.value)}
            className={`min-h-9 flex-1 rounded-[5px] px-2 text-xs font-medium transition-colors ${c.value === value ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-muted'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentVoiceControl({ slug, voice, override }: { slug: string; voice: ResolvedVoice; override: Voice | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState(voice.style ?? '');

  const save = async (change: Record<string, unknown>, what: string) => {
    setBusy(true);
    const before = override;
    try {
      await client.agents.setVoice({ slug, ...change });
      router.refresh();
      toast.success(`${what} saved`, {
        description: 'From the next reply.',
        action: {
          label: 'Undo',
          onClick: () => {
            void client.agents.setVoice({ slug, clear: true, ...(before ?? {}) }).then(() => router.refresh());
          },
        },
      });
    } catch (e) {
      toast.error('Not saved', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="agent-voice">
      <Segmented label="Length" hint="how long a reply runs" value={voice.length} choices={LENGTHS} busy={busy} onPick={v => void save({ length: v }, 'Length')} />
      <Segmented label="Narration" hint="says what it is about to do" value={voice.narration} choices={NARRATION} busy={busy} onPick={v => void save({ narration: v }, 'Narration')} />
      <Segmented label="Creativity" hint="records only ↔ ideas beyond" value={nearest(voice.creativity)} choices={CREATIVITY} busy={busy} onPick={v => void save({ creativity: v }, 'Creativity')} />
      <label className="flex flex-col gap-1.5 text-xs">
        <span className="text-muted-foreground">Style page</span>
        <input
          value={style}
          onChange={e => setStyle(e.target.value)}
          onBlur={() => style.trim() !== (voice.style ?? '') && void save({ style: style.trim() || null }, 'Style page')}
          placeholder="a wiki page slug, e.g. house-voice"
          className="min-h-9 rounded-md border border-border/60 bg-background px-2 font-mono text-xs"
          disabled={busy}
        />
      </label>
      {override && (
        <button type="button" disabled={busy} onClick={() => void save({ clear: true }, 'Workspace voice')} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Reset to the workspace voice
        </button>
      )}
    </div>
  );
}
