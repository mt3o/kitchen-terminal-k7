/**
 * Rotates the page backdrop when the theme ships more than one.
 *
 * The theme owns the pictures: its stylesheet carries one --page-bg rule per
 * backdrop, keyed by `data-backdrop` on <html>, plus two tokens this module
 * reads — how many backdrops there are (--backdrop-count) and how long each
 * stays (--backdrop-every, minutes). A theme with one backdrop, which is every
 * theme but steampunk-brass, makes this a no-op.
 *
 * Which backdrop shows is a function of the local clock, not of when the page
 * loaded: a reload, or a second screen, shows the same picture at the same time.
 *
 * The next picture is decoded before it is swapped in, so the change is one
 * instant repaint rather than a flash of flat colour while it loads; if it
 * cannot be loaded (backend down, not yet cached) the current one stays. Only
 * the attribute changes — nothing is animated, which on the A8X would mean
 * repainting the whole page every frame.
 */

/** The backdrop a moment falls in: whole intervals since local midnight, wrapping. */
export function backdropIndex(now: Date, everyMinutes: number, count: number): number {
  if (!(count > 1) || !(everyMinutes > 0)) return 0
  const localMinutes = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 60_000)
  return Math.floor(localMinutes / everyMinutes) % count
}

/** Milliseconds until the next interval boundary (at least one second). */
export function msUntilNextBackdrop(now: Date, everyMinutes: number): number {
  const period = everyMinutes * 60_000
  const local = now.getTime() - now.getTimezoneOffset() * 60_000
  return Math.max(1000, period - (local % period))
}

/** Every `url(...)` in a CSS value, unquoted. */
export function cssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)].map((m) => m[1] as string)
}

export interface BackdropRotation {
  destroy(): void
}

/** A numeric token, or undefined when the theme sheet has not applied yet. */
function readNumber(root: HTMLElement, token: string): number | undefined {
  const raw = getComputedStyle(root).getPropertyValue(token).trim()
  return raw === '' ? undefined : Number.parseFloat(raw)
}

/**
 * The URLs a backdrop would paint in a mode, found by letting the theme's own
 * rules apply to a detached probe carrying those attributes — the page is not
 * touched, and this module never learns a path the stylesheet did not give it.
 */
function backdropUrls(doc: Document, mode: string, index: number): string[] {
  const probe = doc.createElement('div')
  probe.hidden = true
  probe.dataset.mode = mode
  probe.dataset.backdrop = String(index)
  doc.body.appendChild(probe)
  const value = getComputedStyle(probe).getPropertyValue('--page-bg')
  probe.remove()
  return cssUrls(value)
}

function preload(url: string): Promise<void> {
  const img = new Image()
  img.src = url
  return img.decode()
}

export function createBackdropRotation(doc: Document = document): BackdropRotation {
  const root = doc.documentElement
  let timer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  let first = true

  async function show(index: number, first: boolean): Promise<void> {
    if (root.dataset.backdrop === String(index)) return
    // At boot there is no picture on the wall yet worth protecting, and waiting
    // would only mean fetching backdrop 0 as well as the right one.
    if (first) {
      root.dataset.backdrop = String(index)
      return
    }
    try {
      await Promise.all(backdropUrls(doc, root.dataset.mode ?? 'dark', index).map(preload))
    } catch {
      // Not loadable right now: keep what is on the wall rather than swap in a
      // blank. The next tick tries again.
      return
    }
    if (!destroyed) root.dataset.backdrop = String(index)
  }

  function tick(): void {
    if (destroyed) return
    const count = readNumber(root, '--backdrop-count')
    const every = readNumber(root, '--backdrop-every')
    if (count === undefined || every === undefined) {
      // /theme.css is render-blocking, so this should not happen — but if the
      // tokens are not there yet, look again once everything has loaded rather
      // than conclude there is nothing to rotate.
      if (first) doc.defaultView?.addEventListener('load', tick, { once: true })
      return
    }
    if (!(count > 1) || !(every > 0)) return
    const now = new Date()
    void show(backdropIndex(now, every, count), first)
    first = false
    timer = setTimeout(tick, msUntilNextBackdrop(now, every))
  }

  // Timers are throttled while a tab is hidden and a kiosk's clock can jump;
  // catch up when the page is looked at again.
  const onVisible = (): void => {
    if (doc.visibilityState !== 'visible') return
    if (timer) clearTimeout(timer)
    tick()
  }

  tick()
  doc.addEventListener('visibilitychange', onVisible)

  return {
    destroy() {
      destroyed = true
      if (timer) clearTimeout(timer)
      doc.removeEventListener('visibilitychange', onVisible)
    },
  }
}
