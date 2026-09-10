/**
 * The changelog popup. Binds to the markup in index.html, same discipline as
 * `reconnect.ts`'s `domReconnectUi` — DOM adapter over a small, pure render
 * function, so the part that can format an entry wrong is a part a test can
 * reach without a browser.
 *
 * Fetched lazily on first open, not at boot: a household member who never
 * opens it should not cost an extra request on every reconnect.
 */
import type { Changelog, ChangelogEntry } from '../../shared/changelog.ts'
import { escapeHtml } from './markdown.ts'

/** One entry's markup — escaped, since a date/title/item is data, not markup. */
function renderEntry(entry: ChangelogEntry): string {
  const items = entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  return (
    `<article class="changelog-entry">` +
    `<p class="changelog-date meta">${escapeHtml(entry.date)}</p>` +
    `<h3 class="changelog-entry-title">${escapeHtml(entry.title)}</h3>` +
    `<ul class="changelog-items">${items}</ul>` +
    `</article>`
  )
}

export function renderChangelog(changelog: Changelog): string {
  if (changelog.entries.length === 0) return '<p class="meta">brak wpisów</p>'
  return changelog.entries.map(renderEntry).join('')
}

export interface ChangelogUi {
  open(): void
  close(): void
  destroy(): void
}

/**
 * Wires the open/close buttons and the fetch-on-first-open behaviour. Missing
 * nodes are tolerated — same "still work, just without the affordance" rule
 * `domReconnectUi` follows, since a malformed changelog must never block the
 * dashboard it is describing changes to.
 */
export function createChangelogUi(doc: Document = document, fetchImpl: typeof fetch = fetch): ChangelogUi {
  const root = doc.getElementById('changelog')
  const openButton = doc.getElementById('changelog-open')
  const closeButton = doc.getElementById('changelog-close')
  const veil = root?.querySelector('.changelog-veil')
  const body = doc.getElementById('changelog-body')

  let loaded = false

  async function load(): Promise<void> {
    if (loaded || !body) return
    try {
      const res = await fetchImpl('/api/changelog')
      if (!res.ok) throw new Error(`changelog ${res.status}`)
      const changelog = (await res.json()) as Changelog
      body.innerHTML = renderChangelog(changelog)
      loaded = true
    } catch {
      body.innerHTML = '<p class="stale">[!] dziennik zmian niedostępny</p>'
    }
  }

  function open(): void {
    if (root) root.hidden = false
    void load()
  }

  function close(): void {
    if (root) root.hidden = true
  }

  const onOpenClick = (): void => open()
  const onCloseClick = (): void => close()
  const onVeilClick = (): void => close()
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && root && !root.hidden) close()
  }

  openButton?.addEventListener('click', onOpenClick)
  closeButton?.addEventListener('click', onCloseClick)
  veil?.addEventListener('click', onVeilClick)
  doc.addEventListener('keydown', onKeydown)

  return {
    open,
    close,
    destroy() {
      openButton?.removeEventListener('click', onOpenClick)
      closeButton?.removeEventListener('click', onCloseClick)
      veil?.removeEventListener('click', onVeilClick)
      doc.removeEventListener('keydown', onKeydown)
    },
  }
}
