/**
 * `layout.local.yaml` layered over `layout.yaml` (see `index.ts`'s
 * `loadLayout`). The local file is a partial layout.yaml — same keys, same
 * shape — and config-layers does all of the merging: objects deep-merge key
 * by key, so `calendars.<id>` in the local file adds a calendar, or changes
 * one field of a tracked one, without restating the rest.
 *
 * A list is one unit to config-layers: the local layer replaces it whole
 * unless it says otherwise with a sibling `<key>Strategy` (`concat` or
 * `union`) — which is how `mainCalendars` can be extended rather than
 * restated. That is also why a calendar card's own params cannot be layered:
 * a card sits inside the `pages`/`cards` lists, which no key path reaches.
 *
 * Kept out of `index.ts` for the same reason `calendar-lookup.ts` was: a
 * plain, directly testable function rather than one more thing folded into
 * the module that boots the whole server as an import side effect.
 */
import { LayeredConfig } from 'config-layers'

import { normaliseLayout, type Layout, type NormalisedLayout } from '../shared/layout.ts'

/** `layout.local.yaml`'s shape: any part of a layout, plus a `<key>Strategy` next to any list it extends. */
export type LocalLayout = Partial<Layout> & Record<string, unknown>

/**
 * Merges the local layer over the tracked layout, validates the result, and
 * normalises it. Throws with a message naming a field or a calendar id —
 * never a calendar's source, which may be private — because `/api/layout`
 * returns it as the error body.
 */
export function layerLayout(base: Layout, local: LocalLayout): NormalisedLayout {
  // A silent notFoundHandler: this instance is rebuilt fresh every request,
  // so the library's own "warn once per key" dedup would otherwise warn on
  // every request for any key layout.local.yaml simply doesn't set (the
  // common case when no local file exists at all).
  const layout = LayeredConfig.fromLayers<Layout>(
    [
      { name: 'layout.yaml', config: base },
      { name: 'layout.local.yaml', config: local },
    ],
    { freeze: false, notFoundHandler: () => undefined, arrayLocalMergeStrategyNameSuffix: 'Strategy' },
  )
  if (layout.version !== 1) throw new Error(`unsupported layout version ${layout.version}`)
  if (!layout.theme) throw new Error('layout has no theme')
  if (!layout.pages?.length && !layout.cards?.length) throw new Error('layout has neither pages nor cards')

  // Normalised here so the renderer has one shape to handle. Two code paths
  // through a layout is how the single-page case quietly stops being tested.
  const normalised = normaliseLayout(layout)
  // Loud rather than filtered out: a typo here would otherwise just be a
  // calendar quietly missing from GŁÓWNY, which nobody reading a wall notices.
  const known = new Set(normalised.calendars.map((c) => c.id))
  const unknown = normalised.mainCalendars.find((id) => !known.has(id))
  if (unknown !== undefined) throw new Error(`mainCalendars names ${JSON.stringify(unknown)}, which is not in calendars`)
  return normalised
}
