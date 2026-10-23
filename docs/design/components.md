# Components: one per job

Principle 6: two shapes doing the same job is a defect. Each row names the one
component for a job, where it lives (paths under `packages/core/src`), and what
it replaces. If a row is missing what you need, extend the component in the
row; don't build a second one beside it.

| Job | Use | File | Replaces / never |
|---|---|---|---|
| Primary, secondary, ghost button | `Button`, `buttonVariants()` | `components/ui/button.tsx`, `buttonVariants.ts` | Hand-rolled `bg-foreground text-background` or amber primaries. One ink primary per screen |
| Icon button in a bar | `BAR_ICON_BUTTON` | `components/ui/buttonVariants.ts` | Round or `hover:bg-muted` icon buttons |
| Icon button in a row or panel header | `buttonVariants({ variant: 'ghost', size: 'icon-sm' })` | same | size-6/7/8 hand-rolls in three radii |
| Close (panel, Dialog, Sheet) | `CLOSE_BUTTON`, `PanelCloseButton` | `buttonVariants.ts`, `components/ui/panel-close-button.tsx` | Round closes; faded `rounded-xs` |
| An agent | `AgentDot` (`working`, `settling`) | `components/ui/agent-dot.tsx` | Letter tiles, bullets, `AgentMark`, hand-rolled circles |
| A stack of agents | `AgentStack` (interactive), `AgentDots` (inside another control) | `components/ui/agent-stack.tsx`, `agent-dot.tsx` | Bespoke avatar rows |
| An agent at work, no agent known | `SparkOrb` | `components/ui/spark-orb.tsx` | Amber spinners and ping dots |
| A thing (app, connector, workspace) | `LetterTile` | `components/ui/letter-tile.tsx` | Per-surface monograms |
| A row in a list | `ListRow` (`icon` or `lead`) in `ListRows` | `components/patterns/ListRow.tsx` | Card grids for lists, bespoke rows |
| A page | `ListPage`, `DetailPage` | `components/patterns/*` | `TitleBar` plus hand-rolled headers and icon tiles |
| A reference after a turn (artifact, record, source) | `CHIP` | `components/ui/chip.ts` | Eleven other chip shapes |
| A filter | `ChipRow`, `TypeChips` (ink when on) | `components/patterns/ChipRow.tsx`, `features/review/TypeChips.tsx` | Amber selected chips |
| A state | `StatusPill`, `StatusBadge` (borderless soft fill) | `components/ui/status-pill.tsx`, `status-badge.tsx` | Raw-palette pills, copied tone maps |
| A count | `CountBadge` (`waiting` or `quiet`) | `components/ui/count-badge.tsx` | Three heights and two fills |
| An inline message or a page banner | `Notice` (`edge` for banners) | `components/ui/notice.tsx` | Hand-made red and amber boxes |
| Nothing to show | `EmptyState` | `components/ui/empty-state.tsx` | Dashed boxes (`chat/EmptyState` is the documented exception) |
| A modal, a drawer, a popover, a menu | `Dialog`, `Sheet`, `Popover`, `DropdownMenu` | `components/ui/*` | `fixed inset-0` overlays, `shadow-lg` menus |
| Jump anywhere | `CommandDialog` (the command palette) | `features/dashboard/CommandPalette.tsx` | A second palette |
| A label on hover | `Tooltip` | `components/ui/tooltip.tsx` | `title=` on icon buttons (`title` only for raw evidence: a hash, an ISO time) |
| A field | `Input` | `components/ui/input.tsx` | Bordered raw inputs; `Textarea` and `NativeSelect` to follow on the same recipe |
| A system wait | `PendingIcon` (muted) | `components/patterns/PendingIcon.tsx` | `Loader2` in amber or blue |
| Progress | `GoalProgressBar` | `features/goals/GoalProgressBar.tsx` | Amber or emerald bars |
| A toast | `toast` | `components/ui/toast.tsx` | |
