/**
 * Generate the token stylesheet from a theme file.
 *
 * This is what makes the theming rule true rather than merely stated. The
 * project's contract says swapping the whole design is a matter of pointing
 * `layout.yaml`'s `theme:` at a different file — but until now the client
 * imported the committed `tokens.css` directly, so that key was decorative and
 * the second theme, written expressly to prove the swap, had never been loaded.
 *
 * Output is plain hex and px. No `oklch()`, no `color-mix()`: OKLCH is the design
 * space in which a theme's authors derive values, hex is the delivery format,
 * because both functions are past the Safari 15.0 floor.
 *
 * A theme may also carry files — self-hosted fonts, background pictures,
 * ornament images. The generator never touches the filesystem for them: it
 * names them by theme-relative path and asks the caller (`assetUrl`) what URL
 * that path is served at, which keeps this a pure function the tests can run.
 */

export interface ThemeColorTriple {
  light: string
  dark: string
  night?: string
}

/** A self-hosted face. `src` is relative to the theme file's own directory. */
export interface ThemeFontFace {
  family: string
  src: string
  /** A number, or a "400 900" range for a variable face. */
  weight?: number | string
  style?: string
  unicodeRange?: string
}

/**
 * The title face: card titles, the shell's name, dialog headings. Absent, titles
 * are set exactly like a HUD label — the UI face, uppercase, tracked — so a
 * theme that says nothing here looks the way every theme looked before it existed.
 */
export interface ThemeDisplay {
  fontFamily?: string
  sizePx?: number
  weight?: number
  /** `text-transform` for titles. The first letter is always capitalised. */
  case?: 'none' | 'uppercase' | 'lowercase'
  letterSpacingPx?: number
  /** Unitless. Default: the body leading a card title always inherited. */
  lineHeight?: number
}

/** One CSS value for every mode, or one per mode (night falls back to dark). */
export type ThemeModeValue = string | { light?: string; dark?: string; night?: string }

/** Like ThemeModeValue, but each mode may list several alternatives to rotate through. */
export type ThemeModeValues =
  | string
  | string[]
  | { light?: string | string[]; dark?: string | string[]; night?: string | string[] }

/**
 * Pictures and decorative borders. Every slot is raw CSS, because a background
 * stack or a `border-image` is not worth re-inventing as YAML; `asset("path")`
 * inside a value stands for a theme file and is rewritten to its served URL.
 */
export interface ThemeOrnament {
  /**
   * The page's picture layer(s). A list is a set of backdrops the page rotates
   * through (see backdropEveryMinutes); each mode's list is independent and may
   * differ in length. The overlay goes on top, the mode's `background` colour
   * underneath.
   */
  pageBackground?: ThemeModeValues
  /** Layers drawn over every backdrop — the bands that keep header and footer text legible. */
  pageOverlay?: ThemeModeValue
  /** How long each backdrop stays, in minutes, counted from local midnight. Default 60. */
  backdropEveryMinutes?: number
  /** Background layers for every card. The mode's `surface` colour is appended as the base layer. */
  cardBackground?: ThemeModeValue
  /** A `border-image` value for every card's frame. */
  cardFrame?: ThemeModeValue
  /** A `border-image` value for the dividers under the shell header and each card head. */
  rule?: ThemeModeValue
}

/**
 * The shell header as a band of its own: a background, its padding, and the
 * ink used on it. `colors` takes the same role names as the top-level
 * `colors`/`states`, and is scoped to the header (data-region="header"), so
 * everything inside — title, status, buttons, the pull-to-refresh tab — reads
 * against the band instead of the page. Absent, the header is what it always
 * was: no background, a bottom rule, the page's own colours.
 */
export interface ThemeHeader {
  background?: ThemeModeValue
  padding?: string
  colors?: Record<string, ThemeColorTriple>
}

export interface GenerateOptions {
  /** Theme-relative asset path → the URL it is served at. Defaults to the path itself. */
  assetUrl?: (path: string) => string
}

export interface Theme {
  name: string
  typography: {
    fontFamily: string
    baseSizePx: number
    letterSpacingLabelsPx: number
    scale?: { read?: Record<string, number>; glance?: Record<string, number> }
    weights?: Record<string, number>
    /** For text that must align in columns — ASCII art, code. Defaults to the UI face, which suits a monospace one. */
    monoFontFamily?: string
    fontFaces?: ThemeFontFace[]
    display?: ThemeDisplay
  }
  colors: Record<string, ThemeColorTriple>
  ornament?: ThemeOrnament
  header?: ThemeHeader
  spacing?: { basePx?: number; gridGapPx?: number; cardPaddingPx?: number; cardMinHeightPx?: number }
  shape: { borderRadiusPx: number; borderWidthPx: number; borderWidthStrongPx?: number }
  motion?: { fastMs?: number; baseMs?: number; slowMs?: number; easing?: string; blinkPeriodMs?: number }
  controls?: { heightPx?: number; heightSmallPx?: number; focusRingWidthPx?: number; focusRingOffsetPx?: number }
  layout?: { sidebarWidthPx?: number; targetViewportPx?: number }
  states?: Record<string, ThemeColorTriple>
  density?: { largeScaleFactor?: number }
}

/** Theme key → CSS custom property. Explicit, because a clever automatic
 *  camel-to-kebab rule would silently rename a token the day someone adds one. */
const COLOR_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['background', '--bg'],
  ['backgroundDeep', '--bg-deep'],
  ['surface', '--surface'],
  ['surfaceRaised', '--surface-raised'],
  ['surfaceSunken', '--surface-sunken'],
  ['textPrimary', '--fg'],
  ['textMuted', '--fg-muted'],
  ['textDisabled', '--fg-disabled'],
  ['border', '--border'],
  ['borderStrong', '--border-strong'],
  ['accent', '--accent'],
  ['accentFg', '--accent-fg'],
  ['signal', '--signal'],
  ['warn', '--warn'],
  ['danger', '--fail'],
  ['focus', '--focus'],
]

const STATE_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['accentHover', '--accent-hover'],
  ['accentActive', '--accent-active'],
  ['ghostHover', '--ghost-hover'],
  ['ghostActive', '--ghost-active'],
]

type Mode = 'light' | 'dark' | 'night'

function pick(triple: ThemeColorTriple | undefined, mode: Mode): string | undefined {
  if (!triple) return undefined
  // A theme need not define night; falling back to dark is better than emitting
  // nothing, which would leave the property inherited from another mode.
  if (mode === 'night') return triple.night ?? triple.dark
  return triple[mode]
}

function pickValue(value: ThemeModeValue | undefined, mode: Mode): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (mode === 'night') return value.night ?? value.dark
  return value[mode]
}

/** A mode's list of alternatives, always as a list (possibly empty). */
function pickValues(value: ThemeModeValues | undefined, mode: Mode): string[] {
  if (value === undefined) return []
  if (typeof value === 'string' || Array.isArray(value)) return ([] as string[]).concat(value)
  const picked = mode === 'night' ? (value.night ?? value.dark) : value[mode]
  return picked === undefined ? [] : ([] as string[]).concat(picked)
}

const MODES: readonly Mode[] = ['dark', 'light', 'night']

/** How many backdrops the page rotates through: the longest mode's list, at least 1. */
export function backdropCount(theme: Theme): number {
  return Math.max(1, ...MODES.map((mode) => pickValues(theme.ornament?.pageBackground, mode).length))
}

/** `asset("path")` / `asset(path)` — a theme file named inside a raw CSS value. */
const ASSET_REF = /asset\(\s*["']?([^"')]+?)["']?\s*\)/g

function resolveAssets(css: string, assetUrl: (path: string) => string): string {
  return css.replace(ASSET_REF, (_m, path: string) => `url("${assetUrl(path.trim())}")`)
}

/** Every raw CSS string inside a slot, however it is nested (string, list, per-mode map). */
function ornamentValues(ornament: unknown): string[] {
  const out: string[] = []
  const collect = (value: unknown): void => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(ornament ?? {})
  return out
}

/**
 * Every file a theme names, theme-relative, deduplicated. This is the complete
 * list the server is willing to serve for it — nothing else in the theme's
 * directory is reachable, whatever path a request asks for.
 */
export function themeAssetPaths(theme: Theme): string[] {
  const paths = new Set<string>()
  for (const face of theme.typography.fontFaces ?? []) paths.add(face.src)
  for (const css of [...ornamentValues(theme.ornament), ...ornamentValues(theme.header?.background)]) {
    for (const m of css.matchAll(ASSET_REF)) paths.add((m[1] as string).trim())
  }
  return [...paths]
}

/** `#rrggbb` → `rgba(...)`. Scrims and washes are the mode's own colours at an
 *  alpha, so a new theme gets its own rather than inheriting amber ones. */
function rgba(hex: string | undefined, alpha: number): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return undefined
  const n = Number.parseInt(m[1] as string, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`
}

function modeBlock(theme: Theme, mode: Mode, selector: string, assetUrl: (path: string) => string): string {
  const lines: string[] = []
  for (const [key, token] of COLOR_TOKENS) {
    const value = pick(theme.colors[key], mode)
    if (value) lines.push(`${token}: ${value};`)
  }
  for (const [key, token] of STATE_TOKENS) {
    const value = pick(theme.states?.[key], mode)
    if (value) lines.push(`${token}: ${value};`)
  }
  // A scrim's job is to dim, so it is built from the darkest ground the theme
  // has rather than from the current mode's background — dimming a light screen
  // with a light colour dims nothing.
  const scrim = rgba(pick(theme.colors.backgroundDeep, 'dark') ?? pick(theme.colors.background, 'dark'), 0.88)
  if (scrim) lines.push(`--scrim: ${scrim};`)

  // Washes follow their own role's colour in the current mode, which is what
  // keeps a tag chip legible after a re-theme instead of staying amber.
  for (const [key, token] of [
    ['accent', '--wash-accent'],
    ['signal', '--wash-signal'],
    ['danger', '--wash-fail'],
  ] as const) {
    const w = rgba(pick(theme.colors[key], mode), 0.14)
    if (w) lines.push(`${token}: ${w};`)
  }

  // Title ink. A theme without a display role sets titles in muted text, which
  // is what a HUD label always was.
  const display = pick(theme.colors.display, mode) ?? pick(theme.colors.textMuted, mode)
  if (display) lines.push(`--fg-display: ${display};`)

  // The card's own outline. Separate from borderStrong because that one also
  // outlines buttons, active tabs and focused inputs and must reach 3:1; a
  // theme whose cards are set apart by their fill (a white note on cork) wants
  // a hairline here without weakening every control. Default: borderStrong.
  const cardBorder = pick(theme.colors.cardBorder, mode) ?? pick(theme.colors.borderStrong, mode)
  if (cardBorder) lines.push(`--card-border: ${cardBorder};`)

  // The header band. `transparent` is what the header always had. It goes
  // through asset() like the ornament slots: a band is a background, and a
  // theme that wants a watermark on it should not have to hard-code a URL.
  const band = pickValue(theme.header?.background, mode)?.trim()
  lines.push(`--shell-head-bg: ${band ? resolveAssets(band, assetUrl) : 'transparent'};`)

  // Ornament. Each slot's default reproduces an unornamented theme exactly: the
  // page and the cards are their flat colours, and there is no frame or rule
  // image, so the plain borders underneath show as they always have.
  const ornament = theme.ornament
  const layered = (value: ThemeModeValue | undefined, base: string | undefined): string | undefined => {
    const layers = pickValue(value, mode)
    if (!layers) return base
    const resolved = resolveAssets(layers.trim(), assetUrl)
    return base ? `${resolved}, ${base}` : resolved
  }
  const pageBg = pageBackground(theme, mode, 0, assetUrl)
  if (pageBg) lines.push(`--page-bg: ${pageBg};`)
  const cardBg = layered(ornament?.cardBackground, pick(theme.colors.surface, mode))
  if (cardBg) lines.push(`--card-bg: ${cardBg};`)
  const frame = pickValue(ornament?.cardFrame, mode)
  lines.push(`--card-frame: ${frame ? resolveAssets(frame.trim(), assetUrl) : 'none'};`)
  const rule = pickValue(ornament?.rule, mode)
  lines.push(`--rule: ${rule ? resolveAssets(rule.trim(), assetUrl) : 'none'};`)

  lines.push(`color-scheme: ${mode === 'light' ? 'light' : 'dark'};`)
  return block(selector, lines)
}

/**
 * --page-bg for one mode and one backdrop: overlay, then that backdrop (a mode
 * with fewer pictures than the longest list wraps round its own), then the
 * mode's ground colour. With no pictures it is the ground colour alone, which
 * is what an unornamented theme's page always was.
 */
function pageBackground(theme: Theme, mode: Mode, index: number, assetUrl: (path: string) => string): string | undefined {
  const pictures = pickValues(theme.ornament?.pageBackground, mode)
  const picture = pictures.length ? pictures[index % pictures.length] : undefined
  const layers = [pickValue(theme.ornament?.pageOverlay, mode), picture, pick(theme.colors.background, mode)]
    .map((layer) => layer?.trim())
    .filter((layer): layer is string => Boolean(layer))
  return layers.length ? resolveAssets(layers.join(', '), assetUrl) : undefined
}

/**
 * One rule per extra backdrop and mode. Backdrop 0 lives in the mode blocks;
 * the client picks the rest by setting `data-backdrop` on <html>
 * (lib/backdrop.ts). Attribute selectors rather than :root so the client can
 * compute a backdrop it has not shown yet on a detached probe, to preload it.
 * Dark also matches an element with no data-mode, as the dark block does.
 */
function backdropBlocks(theme: Theme, assetUrl: (path: string) => string): string[] {
  const out: string[] = []
  for (let index = 1; index < backdropCount(theme); index++) {
    const at = `[data-backdrop="${index}"]`
    for (const [mode, selector] of [
      ['dark', `${at}:not([data-mode="light"]):not([data-mode="night"])`],
      ['light', `[data-mode="light"]${at}`],
      ['night', `[data-mode="night"]${at}`],
    ] as const) {
      const value = pageBackground(theme, mode, index, assetUrl)
      if (value) out.push(block(selector, [`--page-bg: ${value};`]))
    }
  }
  return out
}

/**
 * The header's own ink, scoped to data-region="header". Custom properties set
 * on the header element win over the ones it would inherit from <html>, so
 * every component inside it follows without knowing it is in a band. Dark is
 * the unqualified rule, as the dark mode block is; light and night outrank it.
 */
function headerBlocks(theme: Theme): string[] {
  const colors = theme.header?.colors
  if (!colors) return []
  const region = '[data-region="header"]'
  const out: string[] = []
  for (const [mode, selector] of [
    ['dark', region],
    ['light', `[data-mode="light"] ${region}`],
    ['night', `[data-mode="night"] ${region}`],
  ] as const) {
    const lines: string[] = []
    for (const [key, token] of [...COLOR_TOKENS, ...STATE_TOKENS, ['display', '--fg-display'] as const]) {
      const value = pick(colors[key], mode)
      if (value) lines.push(`${token}: ${value};`)
    }
    if (lines.length) out.push(block(selector, lines))
  }
  return out
}

function fontFaceBlock(face: ThemeFontFace, assetUrl: (path: string) => string): string {
  const lines = [
    `font-family: '${face.family.replace(/'/g, '')}';`,
    `font-style: ${face.style ?? 'normal'};`,
    `font-weight: ${face.weight ?? 400};`,
    // swap, not block: on a wall display a title in the fallback face for the
    // first second after a cold boot is better than no title at all.
    'font-display: swap;',
    `src: url("${assetUrl(face.src)}") format("woff2");`,
  ]
  if (face.unicodeRange) lines.push(`unicode-range: ${face.unicodeRange};`)
  return block('@font-face', lines)
}

export function generateTokensCss(theme: Theme, options: GenerateOptions = {}): string {
  const assetUrl = options.assetUrl ?? ((path: string) => path)
  const t = theme.typography
  const sp = theme.spacing ?? {}
  const base = sp.basePx ?? 4
  const motion = theme.motion ?? {}
  const controls = theme.controls ?? {}

  const structure: string[] = [
    `--font-ui: ${t.fontFamily};`,
    `--font-mono: ${t.monoFontFamily ?? 'var(--font-ui)'};`,
  ]

  // Titles. Every default here is the HUD label's own value, by reference, so
  // an undecorated theme's titles are its labels and stay so if those change.
  const display = t.display ?? {}
  structure.push(`--font-display: ${display.fontFamily ?? 'var(--font-ui)'};`)
  structure.push(`--display-size: ${display.sizePx !== undefined ? `${display.sizePx}px` : 'var(--text-sm)'};`)
  structure.push(`--display-weight: ${display.weight ?? 'var(--weight-medium)'};`)
  structure.push(`--display-case: ${display.case ?? 'uppercase'};`)
  // A title set larger than a label at body leading makes every card head
  // taller, and every card body that much shorter — a theme with a big title
  // face sets this tight to give that height back.
  structure.push(`--display-leading: ${display.lineHeight ?? 'var(--leading-body)'};`)
  // Read by lib/backdrop.ts, not by CSS: how many backdrops there are and how
  // long each one stays. 1 means there is nothing to rotate.
  structure.push(`--backdrop-count: ${backdropCount(theme)};`)
  structure.push(`--backdrop-every: ${theme.ornament?.backdropEveryMinutes ?? 60};`)
  structure.push(
    `--display-tracking: ${
      display.letterSpacingPx !== undefined ? `${(display.letterSpacingPx / t.baseSizePx).toFixed(3)}em` : 'var(--tracking-label)'
    };`,
  )

  for (const [name, px] of Object.entries(t.scale?.read ?? {})) structure.push(`--text-${name}: ${px}px;`)
  for (const [name, px] of Object.entries(t.scale?.glance ?? {})) structure.push(`--glance-${name}: ${px}px;`)
  for (const [name, weight] of Object.entries(t.weights ?? {})) structure.push(`--weight-${name}: ${weight};`)

  // 0.12em rather than a px value: tracking that does not scale with the type
  // size stops meaning the same thing the moment a size changes.
  structure.push(`--tracking-label: ${(t.letterSpacingLabelsPx / t.baseSizePx).toFixed(3)}em;`)

  // Line heights and glance tracking are structural rather than per-theme: no
  // theme has varied them, and a body leading is a legibility decision made once
  // at a reading distance, not a stylistic one. A theme gains slots for them the
  // day one needs to differ.
  structure.push('--leading-body: 1.45;')
  structure.push('--leading-tight: 1.15;')
  structure.push('--leading-glance: 1.0;')
  structure.push('--tracking-glance: -0.01em;')

  for (const step of [1, 2, 3, 4, 5, 6, 8, 12, 16]) structure.push(`--space-${step}: ${base * step}px;`)
  structure.push(`--control-pad-x: ${base * 4}px;`)
  // Touch slop: fingers on a wall display are imprecise and often wet.
  structure.push('--tap-slop: 8px;')
  if (sp.gridGapPx) structure.push(`--grid-gap: ${sp.gridGapPx}px;`)
  if (sp.cardPaddingPx) structure.push(`--card-pad: ${sp.cardPaddingPx}px;`)
  if (sp.cardMinHeightPx) structure.push(`--card-min-h: ${sp.cardMinHeightPx}px;`)

  structure.push(`--radius: ${theme.shape.borderRadiusPx}px;`)
  // The header's padding: only its bottom gap unless the theme draws a band.
  // Square unless there is a band to round: a radius on a header that is only
  // a bottom rule would curl the rule's ends.
  structure.push(`--shell-head-pad: ${theme.header?.padding ?? '0 0 var(--space-2)'};`)
  structure.push(`--shell-head-radius: ${theme.header?.background ? 'var(--radius)' : '0px'};`)
  structure.push(`--border-w: ${theme.shape.borderWidthPx}px;`)
  structure.push(`--border-w-strong: ${theme.shape.borderWidthStrongPx ?? theme.shape.borderWidthPx}px;`)

  if (controls.heightPx) structure.push(`--control-h: ${controls.heightPx}px;`)
  if (controls.heightSmallPx) structure.push(`--control-h-sm: ${controls.heightSmallPx}px;`)
  if (controls.focusRingWidthPx) structure.push(`--focus-w: ${controls.focusRingWidthPx}px;`)
  if (controls.focusRingOffsetPx) structure.push(`--focus-offset: ${controls.focusRingOffsetPx}px;`)
  if (theme.layout?.sidebarWidthPx) structure.push(`--sidebar-w: ${theme.layout.sidebarWidthPx}px;`)
  if (theme.layout?.targetViewportPx) structure.push(`--viewport-target: ${theme.layout.targetViewportPx}px;`)

  if (motion.fastMs) structure.push(`--motion-fast: ${motion.fastMs}ms;`)
  if (motion.baseMs) structure.push(`--motion-base: ${motion.baseMs}ms;`)
  if (motion.slowMs) structure.push(`--motion-slow: ${motion.slowMs}ms;`)
  if (motion.easing) structure.push(`--ease: ${motion.easing};`)
  if (motion.blinkPeriodMs) structure.push(`--blink-period: ${motion.blinkPeriodMs}ms;`)

  const parts = [
    `/* Generated from theme "${theme.name}". Do not edit: change the theme file. */`,
    ...(t.fontFaces ?? []).map((face) => fontFaceBlock(face, assetUrl)),
    block(':root', structure),
    modeBlock(theme, 'dark', ':root, [data-mode="dark"]', assetUrl),
    modeBlock(theme, 'light', '[data-mode="light"]', assetUrl),
    modeBlock(theme, 'night', '[data-mode="night"]', assetUrl),
    ...backdropBlocks(theme, assetUrl),
    ...headerBlocks(theme),
  ]

  const large = theme.density?.largeScaleFactor
  if (large && t.scale?.read) {
    const scaled = Object.entries(t.scale.read).map(
      ([name, px]) => `--text-${name}: ${Math.round(px * large)}px;`,
    )
    // A title given in px has no `--text-*` to follow, so it is scaled here too.
    if (display.sizePx !== undefined) scaled.push(`--display-size: ${Math.round(display.sizePx * large)}px;`)
    parts.push(block('[data-density="large"]', scaled))
  }

  // The one motion rule that is not a token: a kiosk honours the OS setting
  // even when the theme has opinions about duration.
  parts.push(
    block('@media (prefers-reduced-motion: reduce)', [
      ':root { --motion-fast: 0ms; --motion-base: 0ms; --motion-slow: 0ms; --blink-period: 0s; }',
    ]),
  )

  return `${parts.join('\n\n')}\n`
}
