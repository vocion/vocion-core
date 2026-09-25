/**
 * `components/patterns` — the three dashboard archetypes. New dashboard
 * pages compose these; nobody hand-rolls a list, a detail or a ledger layout.
 * Read `docs/design/patterns.md` first.
 */

export { arrangeChips, type ChipLike, fitChips } from './chipFit';
// List
export { type Chip, ChipRow } from './ChipRow';
// Detail
export {
  Accordion,
  type AccordionItem,
  ConfidenceMeter,
  type Crumb,
  DetailColumns,
  DetailMeta,
  DetailPage,
  type DotTone,
  type Fact,
  FactList,
  type Maybe,
  MetaChip,
  RightColumn,
  Section,
  StatusDot,
} from './DetailPage';
export { citationLabel, evidenceSource, type EvidenceSource, isCitationUrl } from './evidence';
export { type EvidenceItem, EvidenceList, SourceChip } from './EvidenceList';

export { FilterBar } from './FilterBar';
// Ledger
export { LedgerEntry, LedgerGroup, type ProvenanceItem, ProvenanceLine, ScoreChip, type ScoreChipProps, type Verdict, VerdictBadge } from './Ledger';
export { ListEmpty, ListPage } from './ListPage';
export { Column, COLUMN, type ColumnKind, ListRow, type ListRowProps, ListRows, Subline } from './ListRow';
export { applyListState, flipDirection, type ListState, type ListStateConfig, parseListState, type SortDirection, toggleChip } from './listState';
export { ListToolbar, type ToolbarChip, type ToolbarFacet, type ToolbarSort, type ToolbarTab } from './ListToolbar';
export { useListUrlState } from './listUrlState';
// Loading + pending
export { PendingIcon } from './PendingIcon';

export { formatScore, scorePercent, type ScoreVerdict, scoreVerdict } from './scoreChip';
export { ConversationSkeleton, ListSkeleton, ReportSkeleton } from './Skeletons';
export { type BarAction, type BarField, StickyActionBar } from './StickyActionBar';
