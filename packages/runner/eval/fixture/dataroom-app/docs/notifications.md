# Notifications

Every email is a notification with a type. `src/services/notifications.mjs` lists the types and
the user preference that turns each off; a person who turned a type off never gets it.

| Type | Sent when | Preference |
|---|---|---|
| `link.shared` | a link is created for a recipient | `shares` |
| `reminder` | a recipient has not opened a link | `reminders` |
| `digest` | weekly, to each library owner | `digest` |

## Reminders

A recipient who has not opened their link 3 days after it was created is reminded. A link's
recipient gets **at most one reminder in any 24 hours**, and at most 3 in all. Opening the link
stops reminders. The reminder job runs every hour.
