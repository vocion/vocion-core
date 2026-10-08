# Outlook Calendar

Meetings from an Outlook calendar, the twin of Google Calendar. Setup and
permissions: [microsoft-365.md](microsoft-365.md).

- **Syncs.** The signed-in account's calendar (or `calendarId`) over a rolling
  window, `pastDays` back (30) and `futureDays` ahead (60). Recurring meetings
  arrive as their occurrences. One document per event (`outlook-event:…`) with
  time, attendees and their responses, location and the Teams join link.
  Incremental runs keep only events changed since the last; cancelled events
  are skipped, and the daily full sync removes deleted ones.
- **Tools.** `calendar_events`, the one calendar tool: it reads Outlook live
  for the asked day, beside Google Calendar when the agent holds both, and says
  plainly when a calendar could not be read.
- **Actions.** `outlook.create_event` adds an event (subject, start, end, time
  zone, attendees, location, description, optional Teams meeting link).
  Attendees get Outlook's invitation. **Undo deletes the event** and Outlook
  sends attendees a cancellation. Risk tier `medium`: an agent's proposal waits
  for a person unless the workspace's trust rules promote it.
- **Auth.** Log in with Microsoft (`Calendars.ReadWrite`, no admin consent where
  users may consent). Test connection opens the calendar and says whether it
  can add events.
