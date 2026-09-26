# k7-recipe-description-field

status: implemented
created: 2026-09-23
epic: k7-recipe-widget-upgrade
memory_goal: 5689d533-a542-4ff8-8aa0-15efe8f123a4

## Goal
Add a free-text `description` field to Recipe — domain type, markdown
serialize/parse, the `POST /api/recipes` / `GET /api/recipes` /
`GET /api/recipes/:id` HTTP contract, and the review/edit form + detail view
in K7Recipes.svelte — so households can note things a title and ingredient
list don't capture (e.g. "double the recipe, freezes well").
