/**
 * The confidence ladder moved into the component that draws it
 * (`components/ui/confidence-indicator.tsx`) when the ledger, the inbox and the
 * review detail all started needing the same cut points — MANIFESTO §19, the
 * ladder is not a personalization concern. Re-exported here so the queue and
 * the lead page keep their local import.
 */
export { confidenceLevel } from '@/components/ui/confidence-indicator';
