# Skills

## Query Skills (Read-Only)

| Skill | Inputs | Sources | Description |
|-------|--------|---------|-------------|
| Summarize Deal | Deal name | HubSpot, Gmail, Zoom, Drive | Full deal brief across all touchpoints |
| Discovery Summary | Transcript | Zoom | Structured extraction: pains, budget, timeline, features |
| Account Timeline | Company name, time range | HubSpot, Gmail, Zoom | Chronological view of all interactions |
| Find Similar Deals | Deal characteristics | HubSpot | Past deals with similar profile for reference |
| Inbox Triage | Time range | Gmail | Classify inbox threads by urgency and deal |
| Aging Pipeline Report | Stage, age threshold | HubSpot | Deals needing attention |
| Objection Analysis | Deal name | Gmail, Zoom | Extract and categorize objections |

## Mutation Skills (Take Action)

| Skill | Inputs | Action | Approval |
|-------|--------|--------|----------|
| Draft Lead Response | Lead context | Gmail draft | Yes |
| Draft Follow-up Email | Deal context, purpose | Gmail draft | Yes |
| Draft Capabilities Package | Discovery summary | Gmail draft + Drive attachments | Yes |
| Generate Proposal | Discovery summary, template | Gamma creation | Yes |
| Send Scheduling Link | Contact, meeting type | Gmail + Calendly link | Configurable |
| Update Deal Stage | Deal, new stage | HubSpot mutation | Configurable |
| Create Follow-up Task | Deal, description, due date | HubSpot task | No |
| Log Note to Deal | Deal, note content | HubSpot note | No |

## Composite Skills (Read + Write)

| Skill | Description |
|-------|-------------|
| Process Inbound Lead | Enrich -> classify -> draft response -> create records |
| Post-Discovery Follow-up | Summarize transcript -> select assets -> draft email |
| Proposal Package | Generate brief -> create deck -> draft delivery email |
| Pipeline Health Check | Scan all deals -> flag risks -> draft follow-ups |
| Daily Sales Briefing | Inbox scan + pipeline review + action recommendations |
