# k7-oauth-scope-check-and-issue-log-clear

status: open
created: 2026-10-08

## Goal
Refuse a Google OAuth grant that lacks calendar.readonly at the /admin consent
callback (keep the previous credential, record it in the issue log), and let the
household clear the issue log from the dashboard's issue-log popup.

## Why
2026-10-08: a reconnect through /admin stored a grant whose scope was only
`userinfo.email openid` — the calendar checkbox on Google's granular consent
screen was left unticked. The callback reported "połączono", the stored grant
shadowed the env token, and every calendar fetch 403'd into the stale cache.

memory_goal: ef973eda-51cd-4b4e-a2aa-7a3d953ff481
