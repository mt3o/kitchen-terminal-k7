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
 * Wires the open/close/clear buttons and the fetch-on-open behaviour.
 * Missing nodes are tolerated, same "still work, just without the
 * affordance" rule `domReconnectUi` and `createChangelogUi` both follow.
 */
export function createIssueLogUi(doc: Document = document, fetchImpl: typeof fetch = fetch): IssueLogUi {
  const root = doc.getElementById('issue-log')
  const openButton = doc.getElementById('issue-log-open')
  const closeButton = doc.getElementById('issue-log-close')
  const clearButton = doc.getElementById('issue-log-clear')
  const CLEAR_LABEL = '[ wyczyść ]'
  const CONFIRM_LABEL = '[ na pewno? ]'
  const CONFIRM_WINDOW_MS = 4000
  let confirmTimer: ReturnType<typeof setTimeout> | undefined
  let clearing = false
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

  function disarm(): void {
    clearTimeout(confirmTimer)
    confirmTimer = undefined
    if (clearButton) clearButton.textContent = CLEAR_LABEL
  }

  /**
   * Two taps, same as deleting a chat conversation: a kiosk screen gets
   * brushed, and an emptied log cannot be brought back. The first tap arms,
   * the second within the window clears; the window lapsing disarms.
   */
  async function clear(): Promise<void> {
    if (!clearButton || clearing) return
    if (confirmTimer === undefined) {
      clearButton.textContent = CONFIRM_LABEL
      confirmTimer = setTimeout(disarm, CONFIRM_WINDOW_MS)
      return
    }
    disarm()
    clearing = true
    try {
      const res = await fetchImpl('/api/issues', { method: 'DELETE' })
      if (!res.ok) throw new Error(`issues clear ${res.status}`)
    } catch {
      if (body && !body.querySelector('.issue-log-clear-failed')) {
        body.insertAdjacentHTML('afterbegin', '<p class="stale issue-log-clear-failed">[!] nie udało się wyczyścić dziennika</p>')
      }
      return
    } finally {
      clearing = false
    }
    await load()
  }

  function open(): void {
    if (root) root.hidden = false
    // Refetched on every open, unlike the changelog: this log changes while
    // the dashboard is up, and "what just happened" is the whole point.
    void load()
  }

  function close(): void {
    if (root) root.hidden = true
    disarm()
  }

  const onOpenClick = (): void => open()
  const onCloseClick = (): void => close()
  const onClearClick = (): void => void clear()
  const onVeilClick = (): void => close()
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && root && !root.hidden) close()
  }

  openButton?.addEventListener('click', onOpenClick)
  closeButton?.addEventListener('click', onCloseClick)
  clearButton?.addEventListener('click', onClearClick)
  veil?.addEventListener('click', onVeilClick)
  doc.addEventListener('keydown', onKeydown)

  return {
    open,
    close,
    destroy() {
      openButton?.removeEventListener('click', onOpenClick)
      closeButton?.removeEventListener('click', onCloseClick)
      clearButton?.removeEventListener('click', onClearClick)
      disarm()
      veil?.removeEventListener('click', onVeilClick)
      doc.removeEventListener('keydown', onKeydown)
    },
  }
}
