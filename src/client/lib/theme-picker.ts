/**
 * The header menu's theme picker: look at another theme in this tab only.
 *
 * `layout.yaml` still decides what the wall shows. The choice made here lives
 * in sessionStorage, so it survives a reload (including the ones recovery and
 * pull-to-refresh do) and is gone when the tab is closed; no other device and
 * no other tab sees it. The server honours only ids from its own catalogue
 * (server/theme/catalogue.ts), so a stale id just renders the default.
 *
 * index.html applies a stored choice before first paint with a few inline
 * lines that must agree with SESSION_KEY and themeSheetHref() below; this
 * module takes over from there.
 */
export const SESSION_KEY = 'k7:theme-session'

const DEFAULT_SHEET = '/theme.css'

export interface ThemeEntry {
  id: string
  name: string
}

export interface ThemeCatalogue {
  /** The layout's own theme id. */
  default: string
  themes: ThemeEntry[]
}

/** The stylesheet URL for a session theme; no id (or the default's) is the plain sheet. */
export function themeSheetHref(id: string | null | undefined, defaultId?: string): string {
  return id && id !== defaultId ? `${DEFAULT_SHEET}?theme=${encodeURIComponent(id)}` : DEFAULT_SHEET
}

/** The option to show as selected: the session's choice if the catalogue still has it, else the default. */
export function selectedThemeId(catalogue: ThemeCatalogue, stored: string | null): string {
  return stored && catalogue.themes.some((t) => t.id === stored) ? stored : catalogue.default
}

export interface ThemePickerOptions {
  doc?: Document
  storage?: Storage
  fetchCatalogue?: () => Promise<ThemeCatalogue>
  /** Called once the new sheet has loaded — for anything that read the old tokens. */
  onApplied?: () => void
  /** The theme now on screen: once the catalogue is in, then after every applied change. */
  onShown?: (theme: ThemeEntry) => void
}

export interface ThemePickerUi {
  destroy(): void
}

async function defaultFetchCatalogue(): Promise<ThemeCatalogue> {
  const res = await fetch('/api/themes')
  if (!res.ok) throw new Error(`themes: HTTP ${res.status}`)
  return (await res.json()) as ThemeCatalogue
}

function read(storage: Storage): string | null {
  try {
    return storage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function write(storage: Storage, id: string | null): void {
  try {
    if (id) storage.setItem(SESSION_KEY, id)
    else storage.removeItem(SESSION_KEY)
  } catch {
    // Storage blocked: the theme still applies until the next reload.
  }
}

/**
 * Fills the select from the server's catalogue and swaps the token sheet on
 * change. The new sheet is loaded alongside the old one and the old one is
 * dropped only once the new one has arrived, so the screen never paints
 * unstyled in between. Without a catalogue (offline, older server) the picker
 * stays hidden; a theme already chosen this session keeps applying regardless.
 */
export function createThemePickerUi(options: ThemePickerOptions = {}): ThemePickerUi {
  const doc = options.doc ?? document
  const storage = options.storage ?? sessionStorage
  const select = doc.getElementById('theme-picker') as HTMLSelectElement | null
  const wrapper = select?.closest<HTMLElement>('.theme-picker') ?? null
  let catalogue: ThemeCatalogue | undefined
  let destroyed = false
  /** A sheet still loading. A newer choice replaces it rather than racing it. */
  let pending: HTMLLinkElement | undefined

  function announce(id: string): void {
    const theme = catalogue?.themes.find((t) => t.id === id)
    if (theme) options.onShown?.(theme)
  }

  function swapSheet(href: string, id: string): void {
    pending?.remove()
    pending = undefined
    const current = doc.getElementById('theme-sheet') as HTMLLinkElement | null
    if (current && current.getAttribute('href') === href) {
      announce(id)
      return
    }
    const next = doc.createElement('link')
    next.rel = 'stylesheet'
    next.href = href
    pending = next
    next.addEventListener('load', () => {
      if (pending !== next) return
      pending = undefined
      doc.getElementById('theme-sheet')?.remove()
      next.id = 'theme-sheet'
      options.onApplied?.()
      announce(id)
    }, { once: true })
    // A sheet that will not load leaves the old one in place, which is a
    // theme the household can still read.
    next.addEventListener('error', () => {
      if (pending === next) pending = undefined
      next.remove()
    }, { once: true })
    if (current) current.after(next)
    else doc.head.append(next)
  }

  const onChange = (): void => {
    if (!select || !catalogue) return
    const id = select.value
    write(storage, id === catalogue.default ? null : id)
    swapSheet(themeSheetHref(id, catalogue.default), id)
  }

  void (options.fetchCatalogue ?? defaultFetchCatalogue)()
    .then((result) => {
      if (destroyed || !select) return
      // A layout may point at a theme outside the catalogue's directory; it is
      // still the default, so it still gets an option.
      const themes = result.themes.some((t) => t.id === result.default)
        ? result.themes
        : [{ id: result.default, name: result.default }, ...result.themes]
      catalogue = { default: result.default, themes }
      select.replaceChildren(
        ...themes.map((t) => {
          const option = doc.createElement('option')
          option.value = t.id
          option.textContent = t.id === result.default ? `${t.name} (domyślny)` : t.name
          return option
        }),
      )
      select.value = selectedThemeId(catalogue, read(storage))
      announce(select.value)
      if (wrapper) wrapper.hidden = false
      select.addEventListener('change', onChange)
    })
    .catch(() => {
      // Nothing to offer; the menu simply has no picker this load.
    })

  return {
    destroy() {
      destroyed = true
      select?.removeEventListener('change', onChange)
    },
  }
}
