/**
 * Deep links: the dashboard's view, pushed to the URL hash so a link reopens
 * the same view and Back undoes the last human navigation.
 *
 * Routes (hash routing — no server route, works with the precached shell):
 *
 *   #/p/<pageId>                      a Page
 *   #/p/<pageId>/card/<cardId>?fs=1   a Card a person holds fullscreen
 *   #/recipe/<recipeId>               a Recipe's detail view
 *
 * Ids are the layout's own page/card ids and the recipe file store's ids.
 *
 * Split pure/impure like fullscreen-lock.ts and slideshow.ts: parse/serialize
 * and the reducer are DOM-free and unit tested; `createDeepLinkRouter` talks
 * to the browser only through the `DeepLinkHost` adapter main.ts supplies, so
 * it is testable with a fake history too.
 *
 * Two rules carry the whole design:
 *
 * - **Only human navigation writes history.** The Slideshow is idle-driven:
 *   it never reaches this module at all. The view tracks the *manual*
 *   fullscreen owner (fullscreen-lock's `manualElIdStore`), never the promoted
 *   element, so a Slideshow entering, rotating and leaving changes nothing here.
 * - **Applying a route never pushes.** While a route is being applied (cold
 *   load, Back/Forward, a re-render) the UI reports what it did as usual, but
 *   the reducer only records it. When applying ends, whatever the UI could not
 *   honour (an unknown page or card, a card with no fullscreen button) shows up
 *   as a difference between the view and the URL, and the URL is *replaced* by
 *   the view — the silent fallback. That is also what makes popstate loop-free:
 *   the events the UI fires while obeying Back land inside the applying window.
 */

export type Route =
  | { kind: 'home' }
  | { kind: 'page'; pageId: string; cardId?: string; fullscreen?: boolean }
  | { kind: 'recipe'; recipeId: string }

const HOME: Route = { kind: 'home' }

function decodeSegment(segment: string): string | undefined {
  try {
    const value = decodeURIComponent(segment)
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** Anything unrecognised is home — the caller falls back to the default view. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const q = raw.indexOf('?')
  const path = q >= 0 ? raw.slice(0, q) : raw
  const query = q >= 0 ? raw.slice(q + 1) : ''
  if (!path.startsWith('/')) return HOME
  const parts = path.slice(1).split('/')
  const ids = parts.map(decodeSegment)
  if (ids.some((id) => id === undefined)) return HOME

  if (parts[0] === 'recipe' && parts.length === 2) return { kind: 'recipe', recipeId: ids[1] as string }
  if (parts[0] === 'p' && parts.length === 2) return { kind: 'page', pageId: ids[1] as string }
  if (parts[0] === 'p' && parts.length === 4 && parts[2] === 'card') {
    const fullscreen = query.split('&').includes('fs=1')
    return { kind: 'page', pageId: ids[1] as string, cardId: ids[3] as string, ...(fullscreen ? { fullscreen } : {}) }
  }
  return HOME
}

export function serializeRoute(route: Route): string {
  const enc = encodeURIComponent
  switch (route.kind) {
    case 'recipe':
      return `#/recipe/${enc(route.recipeId)}`
    case 'page':
      if (route.cardId) return `#/p/${enc(route.pageId)}/card/${enc(route.cardId)}${route.fullscreen ? '?fs=1' : ''}`
      return `#/p/${enc(route.pageId)}`
    default:
      return '#/'
  }
}

/** What is on screen, as far as a link is concerned. */
export interface DashboardView {
  pageId: string | null
  /** The card a person holds fullscreen by hand — never the Slideshow's. */
  manualCardId: string | null
  /** The recipe whose detail the recipes card shows. */
  recipeId: string | null
}

/**
 * The URL names the most specific thing open: an open recipe outranks the
 * page (swiping away from it leaves it open in its card, and a link should
 * reopen it), a manual fullscreen card outranks its page.
 */
export function routeOfView(view: DashboardView): Route {
  if (view.recipeId) return { kind: 'recipe', recipeId: view.recipeId }
  if (view.pageId === null) return HOME
  if (view.manualCardId) return { kind: 'page', pageId: view.pageId, cardId: view.manualCardId, fullscreen: true }
  return { kind: 'page', pageId: view.pageId }
}

export interface RouterState {
  view: DashboardView
  /** The hash the address bar holds, normalised through parse/serialize. */
  url: string
  applying: boolean
}

export const INITIAL_ROUTER_STATE: RouterState = {
  view: { pageId: null, manualCardId: null, recipeId: null },
  url: '#/',
  applying: false,
}

export type RouterEvent =
  /** A route is about to be applied to the UI: cold load, Back/Forward, a re-render. */
  | { type: 'apply-start'; route: Route }
  | { type: 'apply-end' }
  | { type: 'page-shown'; pageId: string }
  /** fullscreen-lock's manual owner changed. Slideshow ownership has no event. */
  | { type: 'manual-fullscreen'; cardId: string | null }
  /** `fallback`: a link named a recipe that turned out not to exist — replace, don't push. */
  | { type: 'recipe-shown'; recipeId: string | null; fallback?: boolean }

export interface HistoryOp {
  op: 'push' | 'replace'
  url: string
}

export interface RouterStep {
  state: RouterState
  history?: HistoryOp
}

function withView(state: RouterState, view: DashboardView, fallback: boolean): RouterStep {
  if (state.applying) return { state: { ...state, view } }
  const url = serializeRoute(routeOfView(view))
  if (url === state.url || view.pageId === null) return { state: { ...state, view } }
  return { state: { ...state, view, url }, history: { op: fallback ? 'replace' : 'push', url } }
}

export function deepLinkReducer(state: RouterState, event: RouterEvent): RouterStep {
  switch (event.type) {
    case 'apply-start': {
      // Optimistic for the recipe: the recipes card fetches it asynchronously
      // and only says so after applying has ended. Until it reports otherwise
      // (`fallback`), the URL's recipe is taken as open. Any other route asks
      // the card to close, so its recipe leaves the view now.
      const recipeId = event.route.kind === 'recipe' ? event.route.recipeId : null
      return {
        state: { view: { ...state.view, recipeId }, url: serializeRoute(event.route), applying: true },
      }
    }
    case 'apply-end': {
      const settled = { ...state, applying: false }
      const url = serializeRoute(routeOfView(state.view))
      if (url === state.url || state.view.pageId === null) return { state: settled }
      return { state: { ...settled, url }, history: { op: 'replace', url } }
    }
    case 'page-shown':
      return withView(state, { ...state.view, pageId: event.pageId }, false)
    case 'manual-fullscreen':
      return withView(state, { ...state.view, manualCardId: event.cardId }, false)
    case 'recipe-shown':
      return withView(state, { ...state.view, recipeId: event.recipeId }, event.fallback === true)
    default:
      return { state }
  }
}

// --- runtime ---------------------------------------------------------------

/** The browser, as far as the router needs it. main.ts supplies the real one. */
export interface DeepLinkHost {
  readHash(): string
  push(url: string): void
  replace(url: string): void
  /**
   * Make the UI show `route`, synchronously. Report what actually happened
   * through `dispatch` (or let the UI's own observers do it) — anything not
   * honoured becomes a silent replaceState when applying ends.
   */
  apply(route: Route): void
}

export interface DeepLinkRouter {
  dispatch(event: RouterEvent): void
  /** Apply the address bar's route — boot, popstate/hashchange, after a re-render. */
  syncFromLocation(options?: { force?: boolean }): void
  /** Open an applying window without applying anything yet: render() rebuilds
   *  the deck, and the events that fires must not push. */
  hold(): void
  state(): RouterState
}

export function createDeepLinkRouter(host: DeepLinkHost): DeepLinkRouter {
  let state = INITIAL_ROUTER_STATE

  function dispatch(event: RouterEvent): void {
    const step = deepLinkReducer(state, event)
    state = step.state
    if (!step.history) return
    if (step.history.op === 'push') host.push(step.history.url)
    else host.replace(step.history.url)
  }

  return {
    dispatch,
    syncFromLocation(options = {}) {
      const route = parseRoute(host.readHash())
      // A hashchange that follows a popstate for the same navigation, or one
      // our own push caused, is already the state: applying it again would only
      // re-run the UI for nothing.
      if (!options.force && !state.applying && serializeRoute(route) === state.url) return
      dispatch({ type: 'apply-start', route })
      try {
        host.apply(route)
      } finally {
        dispatch({ type: 'apply-end' })
      }
    },
    hold() {
      dispatch({ type: 'apply-start', route: parseRoute(host.readHash()) })
    },
    state: () => state,
  }
}
