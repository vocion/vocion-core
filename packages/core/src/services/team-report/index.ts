/**
 * The team-report module — measurement model with provenance, derived
 * metrics, human load, setup detection, evidence chains and outcome lineage.
 * `services/TeamReportService.ts` composes these into the page's report.
 * Spec: docs/specs/team-report-v2.md.
 */
export { type ConfigureInput, type ConfigureMeasure, type ConfigureTeam, keyFromLabel, type PlannedFile, planWorkforceConfig } from './configure';
export { attainment, budgetVariance, costPerOutcomeCents, deriveReading, goalProgress, median, primaryOutcome, qualityRate, rate, targetMet, teamsOnTarget, trendOf } from './derive';
export { hubspotIdOf, type OutcomeChain, readOutcomeChains } from './evidence';
export { DECISION_LATENCY_CAP_MS, deriveHumanLoad, emptyHumanLoadCounts, foldHumanLoad, type HumanLoad, type HumanLoadCounts, type HumanLoadRows, readHumanLoad, readHumanLoadRows, sumHumanLoadCounts, type TeamScope } from './humanLoad';
export { type LineageFunnel, type LineageItem, type LineageNode, type LineageNodeId, trace } from './lineage';
export { type Freshness, type MeasureDimension, measureRange, type MeasureReading, type MeasureUnavailableKind, type MeasureWindow, priorRange, PROVENANCE_LABEL, PROVENANCE_MEANING, type ProvenanceKind, provenanceRank, type Range, type TeamMeasure, type TeamMeasureSource, type TrendDirection, UNAVAILABLE_LABEL, windowMs, windowPhrase } from './measures';
export { type MeasureScope, type RawReading, readMeasure, readRaw, readTeamMeasures } from './provenance';
export { detectSetupState, type SetupItem, type SetupReason, type SetupState } from './setup';
