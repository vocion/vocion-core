# Meeting follow-up

After every call with a client or prospect, the follow-up is ready while the
call is fresh.

## What turning it on gives you

1. **A card per call.** When a call's transcript (Zoom) or note (Granola)
   settles, core raises `meeting.transcript_ready`. An all-internal call is
   never read. Anything else gets one typed read by the classifier — who the
   people outside were and whether a follow-up is owed. A client or prospect
   call that owes one becomes **one** card in Review: *Approve to draft the
   &lt;meeting&gt; follow-up* (`meeting.draft_followup`), showing who it goes
   to, the room, the deck or document it would attach, and the next meeting
   already on the calendar. The meeting's owner is notified
   (**Follow-up to approve**).
2. **Approve, and it is drafted.** Approving is the person releasing the
   call's record — the Follow-up writer reads it only through
   `read_meeting_record`, which refuses a call nobody released — and starts
   the draft. The writer proposes a `gmail.send` with `draft: true` from the
   owner's mailbox to the people outside, the room's deck or document
   attached as a PDF when the call was about it, and writes a dated decision
   log, open items for each promise, and a note on any deliverable the call
   changed back to the room. The owner is notified again
   (**Follow-up ready for review**).
3. **One decision per call.** A pending discovery card for the same call is
   closed in the follow-up card's favour, and none is filed beside it. A call
   whose discovery card a person already approved is drafted from that
   approval, with no second card.

## Customise

- **Who writes it.** Override `meeting-followup-write` (`extends: core`) to
  point at your own agent and mission, and attach your voice playbook to the
  `meeting-followup` skill's agent.
- **Which calls.** The read's routing is core's (`client` or `prospect`, and
  a follow-up owed); turn the triage automation off to stop new cards.
- **Notifications.** Each person picks channels for *Follow-up to approve* and
  *Follow-up ready for review* in notification settings; a workspace entry
  with the same `kind` replaces the plugin's.
