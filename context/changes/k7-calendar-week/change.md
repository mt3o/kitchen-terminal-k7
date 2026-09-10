# k7-calendar-week

```yaml
memory_goal: e8c9942e-c6d8-4dc9-aa90-3f814f706180
epic: faza-1
slice: 2
status: implemented
```

Monday-first week view. **The data is not real and the card says so**: with no
OAuth2 there is no backend, so it falls back to obviously-labelled sample events,
puts `dane przykladowe` in the card meta, and stays at `idle` rather than `ok`.
The state vocabulary already means something; `ok` would be a lie.

`today` ticks on a timer. A date captured at component init stops being today at
the first midnight — on a display running for months that is a certainty, and the
calendar is the card it breaks first.

Day columns scroll inside the card; the card never grows. Events outside the
week, malformed dates and `end < start` are dropped rather than rendered. Week
stepping uses calendar fields rather than adding 24h, so a DST transition does
not shift the week.

**Not done:** `editable` is declared so the element observes the attribute the
contract defines, and is inert — edit affordances over a nonexistent write path
would be exactly the dishonest UI this project avoids.
