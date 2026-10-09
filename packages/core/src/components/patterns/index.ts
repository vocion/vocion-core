/**
 * `components/patterns` — the four dashboard archetypes (List, Detail,
 * Ledger, and Front doors for choosing and starting). New dashboard
 * pages compose these; nobody hand-rolls a list, a detail or a ledger layout.
 * Read `docs/design/patterns.md` first.
 */

// Front doors
export { CatalogCard, type CatalogCardAction, type CatalogCardProps, CatalogCards } from './CatalogCard';
export { arrangeChips, type ChipLike, fitChips } from './chipFit';
// List
export { type Chip, ChipRow } from './ChipRow';
export { type CompactActiveFilter, CompactFilters, type CompactMenu, CompactSection } from './CompactFilters';
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

export { firstSentence } from './frontDoor';
export { IntegrationLogo } from './IntegrationLogo';
// Ledger
export { LedgerEntry, LedgerGroup, type ProvenanceItem, ProvenanceLine, ScoreChip, type ScoreChipProps, type Verdict, VerdictBadge } from './Ledger';
export { ListEmpty, ListPage } from './ListPage';
export { Column, COLUMN, type ColumnKind, ListRow, type ListRowProps, ListRows, Subline } from './ListRow';
export { applyListState, flipDirection, type ListState, type ListStateConfig, parseListState, type SortDirection, toggleChip } from './listState';
export { ListToolbar, type ToolbarChip, type ToolbarFacet, type ToolbarSort, type ToolbarTab } from './ListToolbar';
export { useListUrlState } from './listUrlState';
export { OpenInPreview } from './OpenInPreview';
// Loading + pending
export { PendingIcon } from './PendingIcon';

export { RecordCode } from './RecordCode';
export { Related, relatedFacts } from './Related';
export { RowMenu, type RowMenuItem } from './RowMenu';

export { formatScore, scorePercent, type ScoreVerdict, scoreVerdict } from './scoreChip';

export { ConversationSkeleton, ListSkeleton, ReportSkeleton } from './Skeletons';
export { type BarAction, type BarField, StickyActionBar } from './StickyActionBar';
export { type RowSwipe, type SwipeAction } from './SwipeRow';
