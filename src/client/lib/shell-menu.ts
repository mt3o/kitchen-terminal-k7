/**
 * The header's hamburger menu: one [ ≡ ] button that opens a small panel
 * holding the changelog and issue-log buttons, the per-tab theme picker and
 * the light/dark toggle. Those controls keep their own ids and their own
 * modules (changelog.ts, issue-log.ts, theme-picker.ts, theme-toggle.ts);
 * this module only shows and hides the panel they sit in.
 *
 * The panel lives outside the header in index.html, so a drag on it never
 * reaches pull-refresh.ts's touch listeners on the header. It is fixed-
 * positioned under the button each time it opens.
 *
 * No Popover API: Safari 15 does not have it (it arrived in Safari 17).
 */
export interface ShellMenuUi {
  open(): void
  close(): void
  destroy(): void
}

/** Where the panel's top-right corner goes: just under the button, flush with its right edge. */
export function panelPosition(button: { bottom: number; right: number }, viewportWidth: number, gapPx: number): { top: number; right: number } {
  return { top: Math.round(button.bottom + gapPx), right: Math.max(0, Math.round(viewportWidth - button.right)) }
}

const GAP_PX = 6

export function createShellMenuUi(doc: Document = document): ShellMenuUi {
  const button = doc.getElementById('shell-menu-open')
  const panel = doc.getElementById('shell-menu')
  const win = doc.defaultView

  function isOpen(): boolean {
    return !!panel && !panel.hidden
  }

  function place(): void {
    if (!button || !panel || !win) return
    const pos = panelPosition(button.getBoundingClientRect(), win.innerWidth, GAP_PX)
    panel.style.top = `${pos.top}px`
    panel.style.right = `${pos.right}px`
  }

  function open(): void {
    if (!panel) return
    place()
    panel.hidden = false
    button?.setAttribute('aria-expanded', 'true')
  }

  function close(): void {
    if (!panel || panel.hidden) return
    panel.hidden = true
    button?.setAttribute('aria-expanded', 'false')
  }

  const onButtonClick = (): void => (isOpen() ? close() : open())

  // A tap anywhere else closes it — the deck behind stays usable at once.
  const onDocPointer = (e: Event): void => {
    if (!isOpen()) return
    const target = e.target as Node | null
    if (target && (panel?.contains(target) || button?.contains(target))) return
    close()
  }

  // Opening one of the logs hands the screen over to its dialog, so the menu
  // steps aside. The theme controls keep it open: the point is to see the
  // effect and maybe try the next one.
  const onPanelClick = (e: Event): void => {
    const target = e.target as Element | null
    if (target?.closest('[data-closes-menu]')) close()
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isOpen()) return
    close()
    button?.focus()
  }

  const onResize = (): void => {
    if (isOpen()) place()
  }

  button?.addEventListener('click', onButtonClick)
  panel?.addEventListener('click', onPanelClick)
  doc.addEventListener('click', onDocPointer)
  doc.addEventListener('keydown', onKeydown)
  win?.addEventListener('resize', onResize)

  return {
    open,
    close,
    destroy() {
      button?.removeEventListener('click', onButtonClick)
      panel?.removeEventListener('click', onPanelClick)
      doc.removeEventListener('click', onDocPointer)
      doc.removeEventListener('keydown', onKeydown)
      win?.removeEventListener('resize', onResize)
    },
  }
}
