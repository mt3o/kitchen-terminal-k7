# k7-recipe-search-fulltext

status: reviewed
created: 2026-09-25
epic: k7-recipe-widget-upgrade
memory_goal: 84bdd8e7-f7fd-49c0-94a1-8a1b5c4b6da2
review: context/changes/k7-recipe-search-tag-filter/review.md

## Goal
A search box in the recipes widget queries `GET /api/recipes?view=summary&q=`
over title, tags, ingredients, steps, description and source URL, ranked in
that priority order, and pages through results with the same cursor.
