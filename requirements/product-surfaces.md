# Product Surfaces

The chat UI should be a work UI, not just a chat app.

## 1. Conversation Pane (Ask)

The obvious piece, but not the whole product.

Requirements:
- Streaming answers
- Source-backed citations
- Follow-up suggestions
- Visible scope controls
- Saved/pinned context
- Thread history

## 2. Context Drawer

Critical for trust. Every answer should be explorable through a right-side panel.

Shows:
- Source documents
- Slack threads
- CRM/account records
- Tickets
- Linked business objects
- Related runs or prior answers

The user should be able to navigate the evidence, not just click raw links.

## 3. Action Bar

Where you win deals. Every useful answer should have nearby next steps.

Actions:
- Create ticket
- Send follow-up
- Update CRM record
- Generate report
- Route to approver
- Open workflow

## 4. Workflow Mode

Not every job should be done in chat. Add a structured mode for:

- Guided forms
- Repeatable processes
- Approvals
- Long-running jobs
- Multi-step runs

Examples:
- Process inbound lead
- Generate weekly report
- Audit account
- Prepare QBR
- Summarize incident and open follow-ups

## 5. Source and Scope Controls

Trust rises when users can clearly control:

- Which systems are in scope
- Which teams/projects are in scope
- Time range
- Specific business object
- Assistant/skill used

Onyx already has search-side filtering for sources, dates, authors, and tags. Build on that into the main product surface.

## 6. Memory and Session State

Users need:
- Recent searches
- Saved workflows
- Pinned objects
- Reusable scopes
- Draft outputs
- Reopened prior runs

## 7. Feedback

Every surface should collect:
- Thumbs up/down
- "Wrong source"
- "Stale answer"
- "Missing system"
- "Bad action"
- Freeform correction

This becomes the eval pipeline and tuning loop.

## Build Priority

### Build Now
- Chat/work interface
- Context drawer
- Search results with filters
- Skill catalog
- Run history
- Approvals inbox
- Connectors page
- Business object mapping page
- Feedback capture
- Admin analytics

### Build Soon After
- Workflow builder
- Trigger and hook configuration
- Domain dashboards
- Saved scopes and saved views
- Reusable templates
- Compare answers across assistants or models

### Keep Mostly Internal at First
- Raw prompt editor
- Chunking/embedding settings
- Retrieval weights
- Model routing
- Secret management
- Low-level connector retries

These are managed service territory.
