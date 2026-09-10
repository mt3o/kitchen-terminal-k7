# k7-calendar-alignment-fix

status: open
created: 2026-09-10

## Goal
Follow-up on k7-ui-polish-batch's vertical-day-list calendar redesign,
reported from a live-server screenshot: the event list's left edge
zigzagged between rows because .col-head auto-sized to its content
("DZIS" only appears on today's row, widening just that row's head), and
the empty-day "—" placeholder centered in the remaining row width instead
of sitting near the date, reading as disconnected floating text.

Fix: .col-head gets a fixed width (var(--space-12)) so every row's
content starts at the same left edge; .empty left-aligns instead of
centering.

memory_goal: (reuses k7-ui-polish-batch's scope — direct refinement of
its calendar decision, not an independent one)
