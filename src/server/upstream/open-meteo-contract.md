# Open-Meteo Forecast API — verified contract

Source: https://open-meteo.com/en/docs (fetched 2026-09-08), verified by live `curl` calls against
`https://api.open-meteo.com/v1/forecast`. No API key required for non-commercial use.

## 1. Verified request URL

```
https://api.open-meteo.com/v1/forecast?latitude=52.2297&longitude=21.0122&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=Europe%2FWarsaw&forecast_days=5&temperature_unit=celsius&wind_speed_unit=kmh
```

| Param | Value used | Meaning |
|---|---|---|
| `latitude` | `52.2297` | WGS84 latitude, required. |
| `longitude` | `21.0122` | WGS84 longitude, required. |
| `current` | `temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` | Comma-separated list of instant "current conditions" variables. |
| `daily` | `weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` | Comma-separated list of daily-aggregate variables. Requires `timezone` to be meaningful (day boundaries are local). |
| `timezone` | `Europe/Warsaw` (URL-encoded `Europe%2FWarsaw`) | IANA tz name. Default is `GMT`. All returned timestamps (`current.time`, `daily.time`, `sunrise`, `sunset`) are rendered in this zone as naive ISO8601 (no UTC offset suffix) — see §5. `timezone=auto` derives the zone from lat/lon server-side but *strips per-variable units for `current`* in some combos observed here (see below) — prefer an explicit IANA name for a fixed known location like the kiosk's.
| `forecast_days` | `5` | Number of daily forecast days from today. Default 7, max 16. Also implicitly bounds the `hourly` array length if `hourly` is requested (not used here). |
| `temperature_unit` | `celsius` (default) | `celsius` or `fahrenheit`. |
| `wind_speed_unit` | `kmh` (default) | `kmh`, `ms`, `mph`, or `kn`. |
| `past_days` | not used | 0–92, prepends historical days before today. Not needed for this kiosk. |

Not used but exists: `hourly` (hourly variables array), `apikey` (commercial tier auth), multi-location via comma-separated `latitude`/`longitude` lists.

## 2. Real response (abridged to 2 daily entries)

Request as above, response received:

```json
{
  "latitude": 52.23009,
  "longitude": 21.017075,
  "generationtime_ms": 0.518,
  "utc_offset_seconds": 7200,
  "timezone": "Europe/Warsaw",
  "timezone_abbreviation": "GMT+2",
  "elevation": 113.0,
  "current_units": {
    "time": "iso8601",
    "interval": "seconds",
    "temperature_2m": "°C",
    "apparent_temperature": "°C",
    "relative_humidity_2m": "%",
    "wind_speed_10m": "km/h",
    "weather_code": "wmo code",
    "is_day": ""
  },
  "current": {
    "time": "2026-09-08T20:30",
    "interval": 900,
    "temperature_2m": 22.5,
    "apparent_temperature": 22.1,
    "relative_humidity_2m": 54,
    "wind_speed_10m": 9.0,
    "weather_code": 3,
    "is_day": 0
  },
  "daily_units": {
    "time": "iso8601",
    "weather_code": "wmo code",
    "temperature_2m_max": "°C",
    "temperature_2m_min": "°C",
    "sunrise": "iso8601",
    "sunset": "iso8601"
  },
  "daily": {
    "time": ["2026-09-08", "2026-09-09"],
    "weather_code": [3, 3],
    "temperature_2m_max": [27.0, 28.0],
    "temperature_2m_min": [14.3, 17.1],
    "sunrise": ["2026-09-08T05:59", "2026-09-09T06:00"],
    "sunset": ["2026-09-08T19:08", "2026-09-09T19:05"]
  }
}
```

Notes on the real response:
- `latitude`/`longitude` echoed back are the **grid cell center actually used**, not the requested values (0.23009 vs 0.2297, 21.017075 vs 21.0122) — model resolution snapping. Do not assert-equal request vs response coordinates.
- `current.interval` (900s here) is the update cadence of the current-conditions block, not a forecast step; not to be confused with hourly step.
- `is_day` is `0`/`1` (integer, not boolean) — its unit string is `""` (empty).
- Units come back **per variable**, in a matching `*_units` object, so unit conversion is data-driven, not hardcoded from `temperature_unit`.
- With `temperature_unit=fahrenheit&wind_speed_unit=mph`, `current_units.temperature_2m` becomes `"°F"` and `current_units.wind_speed_10m` becomes `"mp/h"` (note: `"mp/h"`, not `"mph"` — string quirk to hardcode carefully if matching on unit string).

## 3. WMO weather code table (`weather_code` / "wmo code")

| Code | Meaning |
|---|---|
| 0 | Clear sky |
| 1 | Mainly clear |
| 2 | Partly cloudy |
| 3 | Overcast |
| 45 | Fog |
| 48 | Depositing rime fog |
| 51 | Drizzle: light |
| 53 | Drizzle: moderate |
| 55 | Drizzle: dense intensity |
| 56 | Freezing drizzle: light |
| 57 | Freezing drizzle: dense intensity |
| 61 | Rain: slight |
| 63 | Rain: moderate |
| 65 | Rain: heavy intensity |
| 66 | Freezing rain: light |
| 67 | Freezing rain: heavy intensity |
| 71 | Snow fall: slight |
| 73 | Snow fall: moderate |
| 75 | Snow fall: heavy intensity |
| 77 | Snow grains |
| 80 | Rain showers: slight |
| 81 | Rain showers: moderate |
| 82 | Rain showers: violent |
| 85 | Snow showers: slight |
| 86 | Snow showers: heavy |
| 95 | Thunderstorm: slight or moderate |
| 96 | Thunderstorm with slight hail |
| 99 | Thunderstorm with heavy hail |

Codes 95/96/99 (hail variants) are documented as only reliably available for Central Europe in Open-Meteo's underlying model (DWD ICON) — fine for the Warsaw use case, but don't assume global fidelity if the kiosk's location ever changes. Codes 96 and 99 were **observed live**: the 2026-09-10 daily entry in the un-truncated pull returned `weather_code: 63` (moderate rain), confirming the field really does vary day to day and isn't a stub.

## 4. Rate limits & terms (from open-meteo.com/en/terms, non-commercial free API)

| Limit | Value |
|---|---|
| Per minute | 600 calls |
| Per hour | 5,000 calls |
| Per day | 10,000 calls |

- License: **CC-BY 4.0** — attribution to Open-Meteo required wherever the data is used/displayed. A kiosk UI should carry a small "Weather data by Open-Meteo.com" credit.
- Non-commercial use only on the free tier. Non-commercial examples given: private/nonprofit apps without subscriptions or ads, personal home automation, public research, educational use — this kiosk qualifies.
- Commercial use (apps with subscriptions/ads, commercial products, undisclosed commercial research) requires a paid plan (Standard/Professional/Enterprise) and an `apikey` query parameter.
- No API key needed for free/non-commercial calls; the `apikey` param is exclusively for paid tiers routing to reserved capacity.

## 5. Gotchas for implementers

- **Errors are HTTP 400 with a JSON body**, not HTTP 200 with an in-body error flag, and not a bare 4xx with no body. Body shape:
  ```json
  { "error": true, "reason": "<human-readable explanation>" }
  ```
  Verified live:
  - Unknown/misspelled variable name in `current`/`daily`/`hourly` → 400, reason names the offending internal type (message is verbose/technical, not just "unknown variable X" — don't pattern-match on exact wording, just surface `reason` to logs).
  - Missing `latitude` while `longitude` present → 400, reason: `"Parameter 'latitude' and 'longitude' must have the same number of elements"` (the API always treats lat/lon as parallel arrays internally, even for the single-location case).
  - Treat any non-2xx as fatal for that request; do not attempt to partially parse a 400 body as forecast data.
- **Timestamps are naive local time, no offset/zone suffix** (e.g. `"2026-09-08T20:30"`), *not* UTC and *not* ISO8601 with a `Z` or `+02:00` suffix despite `current_units.time: "iso8601"`. The actual UTC offset is given once, separately, as `utc_offset_seconds` (seconds, e.g. `7200` for Warsaw in DST-adjusted CEST) and `timezone_abbreviation` (e.g. `"GMT+2"`, a display string, not parseable as a real tz abbreviation). To get a true instant, parse the naive string as wall-clock time in the `timezone` you requested — do not assume UTC or reuse `utc_offset_seconds` blindly year-round if you cache requests across a DST transition.
- **Array alignment**: `daily.time[i]` corresponds positionally to `daily.weather_code[i]`, `daily.temperature_2m_max[i]`, etc. — all daily arrays are guaranteed same length and same order as `daily.time`, no ids/keys, pure positional join. Same rule applies to any `hourly.*` arrays if added later.
- **Null handling**: individual array slots (e.g. an hourly variable at a time the model has no data) can come back as JSON `null`. Not observed for `daily`/`current` variables used here under normal conditions, but the docs note it can occur for out-of-range forecast horizons or sparse model fields — code defensively (`number | null`), don't assume every slot is populated even on a 200 response.
- **`is_day` is numeric** (`0` or `1`), useful directly for a night-mode schedule gate, but don't type it as boolean in JSON schema/validation — coerce explicitly.
- **Sunrise/sunset are per-day, once each**, inside the `daily` block (not `current`), aligned with `daily.time` same as above — for "is it dark right now" logic, compare current local time against today's `sunrise[0]`/`sunset[0]`, not `is_day` alone if you need the actual threshold moments (e.g. transition animations).
- **Response echoes snapped grid coordinates**, not your input lat/lon (see §2) — never assert round-trip equality on coordinates in tests.
- **`timezone=auto`** works (derives zone from coordinates) but was only exercised here with a minimal `current` var list; for a kiosk with a fixed known location, prefer the explicit IANA name (`Europe/Warsaw`) for clarity and to avoid any edge-case geocoding failures at Open-Meteo's end.
- Unit strings are exact and match Open-Meteo's own formatting, not a standard unit-code enum — e.g. `"mp/h"` for mph, `"°C"`/`"°F"` with the degree symbol, `"km/h"`. If displaying units from `current_units`/`daily_units` verbatim, don't re-derive them from `temperature_unit`/`wind_speed_unit` request params — read them from the response.
