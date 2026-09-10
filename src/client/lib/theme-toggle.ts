/**
 * The footer's light/dark toggle. Binds to a single button in index.html,
 * same DOM-adapter-over-a-pure-function discipline as changelog.ts and
 * reconnect.ts: the part that decides what mode comes next, and what the
 * button should say, is a part a test can reach without a browser.
 *
 * Only light and dark are reachable here — night is schedule-driven
 * (per the theme's own night-mode design), not a button a household member
 * clicks, so toggling only ever moves between the two modes people actually
 * choose between.
 */
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'k7:theme-mode'

export function nextMode(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark'
}

/** What the button says *now* — the mode a click would switch to, not the active one. */
export function toggleLabel(current: ThemeMode): string {
  return current === 'dark' ? '[ MOTYW: JASNY ]' : '[ MOTYW: CIEMNY ]'
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export interface ThemeToggleUi {
  destroy(): void
}

/**
 * Wires the toggle button, restores a stored choice on boot, and persists
 * every change — same "still work, just without the affordance" tolerance
 * for a missing button as changelog.ts and reconnect.ts.
 */
export function createThemeToggleUi(doc: Document = document, storage: Storage = localStorage): ThemeToggleUi {
  const root = doc.documentElement
  const button = doc.getElementById('theme-toggle')

  function apply(mode: ThemeMode): void {
    root.dataset.mode = mode
    if (button) button.textContent = toggleLabel(mode)
  }

  const stored = (() => {
    try {
      return storage.getItem(STORAGE_KEY)
    } catch {
      // Private browsing / storage blocked: fall back to whatever index.html
      // already set rather than failing the toggle entirely.
      return null
    }
  })()
  if (isThemeMode(stored)) apply(stored)
  else if (button) button.textContent = toggleLabel(isThemeMode(root.dataset.mode ?? null) ? (root.dataset.mode as ThemeMode) : 'dark')

  const onClick = (): void => {
    const current = isThemeMode(root.dataset.mode ?? null) ? (root.dataset.mode as ThemeMode) : 'dark'
    const mode = nextMode(current)
    apply(mode)
    try {
      storage.setItem(STORAGE_KEY, mode)
    } catch {
      // Nothing to persist to; the mode still applies for this session.
    }
  }

  button?.addEventListener('click', onClick)

  return {
    destroy() {
      button?.removeEventListener('click', onClick)
    },
  }
}
