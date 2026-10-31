import type { RoutineView } from '@/libs/routines/types';
import { Repeat } from 'lucide-react';
import { Column, ListEmpty, ListRow, ListRows, StatusDot, Subline } from '@/components/patterns';
import { routineLine, routineStatusWord } from '@/libs/routines/display';
import { PracticeRoutineButton } from './PracticeRoutineButton';
import { TrustChip } from './RoutineChips';
import { TeachRoutineButton } from './TeachRoutineButton';

const DOT = { pass: 'pass', amber: 'amber', fail: 'fail', neutral: 'neutral', teal: 'neutral' } as const;

/**
 * The workspace's routines, one row each: its name, its expert and how it has
 * gone, where it stands, and its rung on the trust ladder.
 * @param props
 * @param props.routines - Newest first.
 */
export function RoutineList({ routines }: { routines: RoutineView[] }) {
  if (routines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center" data-routines-empty>
        <ListEmpty
          variant="page"
          icon={Repeat}
          title="No automations yet"
          description="Record the task in Slate, narrate why each step happens, then ask in chat: Teach a task from <link>. Or start here, and Vocion opens the site for you to record on."
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <TeachRoutineButton label="Teach a task" />
          <PracticeRoutineButton />
        </div>
      </div>
    );
  }
  return (
    <ListRows>
      {routines.map((r) => {
        const word = routineStatusWord(r);
        return (
          <ListRow
            key={r.id}
            href={`/dashboard/automations/${r.id}`}
            icon={Repeat}
            title={r.name}
            subline={<Subline separator="·" segments={[r.expert ? r.expert.name : 'No expert yet', routineLine(r)]} />}
            columns={(
              <>
                <Column kind="number">{r.version ? `v${r.version.n}` : '—'}</Column>
                <Column kind="status" align="left" always><StatusDot tone={DOT[word.tone]} pulse={word.pulse} label={<span className="truncate">{word.word}</span>} /></Column>
              </>
            )}
            chip={<TrustChip trust={r.trust} />}
            data-testid={`routine-row-${r.id}`}
          />
        );
      })}
    </ListRows>
  );
}
