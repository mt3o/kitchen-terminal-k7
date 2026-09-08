# k7-backend-freshness

```yaml
change_id: k7-backend-freshness
memory_goal: 17d093df-8bc9-4e91-bd34-2df2be1cce2a
change_anchor: d1fd8be9-577e-4203-b3b2-cebe522e0258
parent:
  - 3a29eee2-0cb0-4688-8e53-92c9a2b0c08e   # k7-persistence
  - 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
slice: 6
mode: headless
branch: change/k7-backend-freshness
```

## What this delivers

The half of "offline" that needs no certificate: upstream answers cached in
SQLite and served **with their age attached**, plus Open-Meteo wired for real.

```
db/schema.ts               upstream_cache — key, upstream, payload, fetched_at
upstream/freshness.ts      fetch-through, and the honesty rule
upstream/open-meteo.ts     the weather client
upstream/open-meteo-contract.md   the verified API reference
GET /api/weather           Aged<Weather>
```

## The rule, and why the type enforces it

**The cache never lies about how old the answer is.** `Aged<T>` has no variant
without `ageSeconds` — the honest field is impossible to omit rather than easy to
forget, because a wall display silently showing yesterday's temperature is worse
than one showing nothing. Nobody doubts it.

Age is recomputed from the stored timestamp on every read and is never reset by a
cache hit. A copy can be *fresh enough to use* and *two minutes old* at the same
time; both are reported, because they are different claims.

| Situation | Answer |
|---|---|
| Cold, upstream up | `source: live`, age 0 |
| Inside the 15-min window | `source: cache`, **real** age, `stale: false` |
| Upstream down, cache warm | `source: cache`, real age, `stale: true`, logged |
| Upstream down, nothing cached | **503** — no honest answer exists |

All four verified live, the third by ageing the stored row two hours and pointing
the client at a dead port.

## Open-Meteo lies about its timestamps

It labels them `iso8601` and returns **naive local wall-clock strings with no
offset** — `"2026-09-08T20:30"` — while the real offset arrives separately as
`utc_offset_seconds`. Handing those to `Date` interprets them in the *server's*
zone: correct by accident whenever server and location agree, wrong the rest of
the time and twice a year at a DST boundary.

Every timestamp is resolved through the offset before it leaves the client.
Sunrise and sunset from this response are what a schedule-driven night mode would
key off, and an hours-wrong sunset is a kitchen that dims at the wrong time in a
way that looks entirely plausible.

Also: `is_day` is `0`/`1`, and `Boolean("0")` is `true`.

## A bug the tests caught that production would have hidden

The clock was injected into the service but not into the repository underneath,
so age was measured between two different clocks. In production they agree and
nothing looks wrong; in a test with a fabricated date the answer is absurd. The
cache write now takes the timestamp as a parameter instead of calling the wall
clock itself.

## Verified

| | |
|---|---|
| `npm run check` | exit 0, **35/35** tests |
| Live weather | 22.5 °C, 5 days, sunset `17:08Z` = 19:08 Warsaw ✓ |
| Stale fallback | `stale: true`, age 7205 s, data still served |
| Cold failure | 503 with an honest message |

## Not done

- **Calendar is not wired.** It needs OAuth2, which does not exist yet. It is a
  consumer of the same `fetchThrough` the moment it does.
- **No card renders this.** Slice 6 is classified headless, and putting weather on
  screen is a UI surface, which would make it interactive. The endpoint is
  verifiable by `curl`; the card belongs to Faza 1.
- No cache eviction. Rows are keyed by request shape and there are a handful of
  shapes; a household will not accumulate them.
