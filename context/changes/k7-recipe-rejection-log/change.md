# k7-recipe-rejection-log

status: reviewed
created: 2026-09-24
epic: k7-recipe-widget-upgrade
memory_goal: 0f65e225-90a5-49a9-849c-a5552f6b4477
review: context/changes/k7-recipe-search-tag-filter/review.md

## Goal
Log server-side rejections (validation failures on `POST /api/recipes`,
import errors on `POST /api/recipes/import`) so failed add/import attempts
can be reviewed and retried — a retry action reopens the review form
pre-filled with the original input so the household can fix and resubmit
rather than losing what they typed or tried to import.
