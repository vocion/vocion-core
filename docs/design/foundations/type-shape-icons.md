# Type, shape, elevation and icons

## Type

One humanist sans, Inter (`--font-sans`), for the app; the display face is the
same face (B-034b §1). Outfit only for the empty chat's greeting and the
marketing site. Never a serif (founder, 2026-10-09).

The scale, by job (the code still has ~21 pixel sizes; new work uses these):

| Step | Size | Use |
|---|---|---|
| meta | 11px | Timestamps, eyebrows, counts, step results |
| small | 12px | Chips, sublines, table meta |
| ui | 13px | Nav rows, buttons, body of controls, the live line (semibold) |
| reading | 15px | Chat prose, document body |
| title | 20px / 600 | Page titles, tight tracking |
| display | 26–30px | The empty chat's greeting |

Numbers that line up use `tabular-nums`. Headings `text-balance`.

## Shape

| Job | Radius |
|---|---|
| Buttons, fields, icon buttons, nav rows, menu rows | `rounded-lg` |
| Chips, pills, counts, avatars | `rounded-full` |
| Popovers, menus, dialogs, cards, notices | `rounded-xl` (notices `rounded-lg`) |
| The composer | 22px |
| Square marks (apps, connectors, workspaces) | `LetterTile` sizes |

Hairlines, not boxes; a bordered surface never contains another bordered
surface (patterns.md § Never).

## Elevation

Two shadows only: `--shadow-pop` (popovers, menus, dialogs, sheets, toasts)
and `--shadow-composer` (the composer floating on the page). No
`shadow-md|lg|xl|2xl` in feature code.

## Icons

lucide, outline, 1.5 stroke (B-034b §2), 16px in controls. An icon button is a
ghost rounded square, never a circle: `BAR_ICON_BUTTON` in a bar,
`size="icon-sm"` in a row or panel header, `CLOSE_BUTTON` for every close.
The avatar is the only round thing in a bar.
