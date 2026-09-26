# k7-phone-page-scroll

status: reviewed
created: 2026-09-25
memory_goal: e73397bc-9bc3-47c9-8457-f72312d46aef
review: context/changes/k7-phone-page-scroll/review.md
design_surface: k7-shell-mobile

## Goal
On a phone (≤767px) each pager page scrolls vertically inside the fixed
shell, with cards sharing the screen but never going below `--card-min-h`,
and the pager ignoring vertical drags — while the wall kiosk keeps "nothing
scrolls, ever".
