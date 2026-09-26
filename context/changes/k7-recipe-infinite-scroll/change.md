# k7-recipe-infinite-scroll

status: reviewed
created: 2026-09-25
epic: k7-recipe-widget-upgrade
memory_goal: e80dff0a-f65d-4e24-a0f4-803f9fbcf347
review: context/changes/k7-recipe-search-tag-filter/review.md

## Goal
The recipes widget's all-titles list becomes cursor-paginated:
`GET /api/recipes?view=summary` returns one page plus a `nextCursor`, and the
widget loads the next page as the household scrolls to the bottom.
