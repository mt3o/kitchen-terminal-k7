/**
 * The issue log popup. Same shape as `lib/changelog.ts` — DOM adapter over a
 * pure render function, bound to markup in `index.html`, fetched lazily on
 * first open. This is the household's own answer to "what went wrong today":
 * comic-of-the-day falling back to yesterday's image, a calendar that
 * couldn't be reached, a card that crashed — see `GET /api/issues`.
 */
import type { IssueLogEntry, IssueSeverity } from '../../shared/issue-log.ts'
import { ageLabel } from './wmo.ts'
import { escapeHtml } from './markdown.ts'

/** `[!]` warn (amber-adjacent, degraded-but-handled), `[X]` fail (an actual error) — DESIGN.md §8's status-badge glyphs, never colour alone. */
function badge(severity: IssueSeverity): string {
  return severity === 'error' ? '[X]' : '[!]'
}

function ageSecondsSince(iso: string, now: () => Date): number {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.round((now().getTime() - then) / 1000))
}

function renderEntry(entry: IssueLogEntry, now: () => Date): string {
  const detail = entry.detail ? `<p class="issue-log-detail meta">${escapeHtml(entry.detail)}</p>` : ''
  return (
    `<article class="issue-log-entry issue-log-${entry.severity}">` +
    `<p class="issue-log-meta meta">` +
    `<span class="issue-log-badge">${badge(entry.severity)}</span> ` +
    `<span class="issue-log-source">${escapeHtml(entry.source.toUpperCase())}</span> // ` +
    `<span class="issue-log-age">${ageLabel(ageSecondsSince(entry.createdAt, now))}</span>` +
    `</p>` +
    `<p class="issue-log-message">${escapeHtml(entry.message)}</p>` +
    detail +
    `</article>`
  )
}

export function renderIssueLog(entries: IssueLogEntry[], now: () => Date = () => new Date()): string {
  if (entries.length === 0) return '<p class="meta">brak zgłoszonych błędów</p>'
  return entries.map((e) => renderEntry(e, now)).join('')
}

export interface IssueLogUi {
  open(): void
  close(): void
  destroy(): void
}

/**
 * Wires the open/close buttons and the fetch-on-first-open behaviour.
 * Missing nodes are tolerated, same "still work, just without the
 * affordance" rule `domReconnectUi` and `createChangelogUi` both follow.
 */
export function createIssueLogUi(doc: Document = document, fetchImpl: typeof fetch = fetch): IssueLogUi {
  const root = doc.getElementById('issue-log')
  const openButton = doc.getElementById('issue-log-open')
  const closeButton = doc.getElementById('issue-log-close')
  const veil = root?.querySelector('.issue-log-veil')
  const body = doc.getElementById('issue-log-body')

  async function load(): Promise<void> {
    if (!body) return
    try {
      const res = await fetchImpl('/api/issues')
      if (!res.ok) throw new Error(`issues ${res.status}`)
      const entries = (await res.json()) as IssueLogEntry[]
      body.innerHTML = renderIssueLog(entries)
    } catch {
      body.innerHTML = '<p class="stale">[!] dziennik błędów niedostępny</p>'
    }
  }

  function open(): void {
    if (root) root.hidden = false
    // Refetched on every open, unlike the changelog: this log changes while
    // the dashboard is up, and "what just happened" is the whole point.
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
