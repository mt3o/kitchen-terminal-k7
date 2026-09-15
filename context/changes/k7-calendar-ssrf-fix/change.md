# k7-calendar-ssrf-fix

status: open
created: 2026-09-15
memory_goal: 25df1729-dc32-4525-ae98-d7691fac18fc

## Goal
Fix an SSRF vulnerability in /api/calendar/week (it trusted a client-supplied
`url`/`mode`/`calendarId` and fetched it server-side with no validation
against what was actually configured), found live during k7-multi-calendar's
deploy by the peer session on the home server. Also fixes the pre-existing
K7Calendar.svelte day-label reactivity bug flagged independently by both
this project's own /gw-review and the same peer-session deploy check.
