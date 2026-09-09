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
 */

export interface ThemeColorTriple {
  light: string
  dark: string
  night?: string
}

export interface Theme {
  name: string
  typography: {
    fontFamily: string
    baseSizePx: number
    letterSpacingLabelsPx: number
    scale?: { read?: Record<string, number>; glance?: Record<string, number> }
    weights?: Record<string, number>
  }
  colors: Record<string, ThemeColorTriple>
  spacing?: { basePx?: number; gridGapPx?: number; cardPaddingPx?: number; cardMinHeightPx?: number }
  shape: { borderRadiusPx: number; borderWidthPx: number; borderWidthStrongPx?: number }
  motion?: { fastMs?: number; baseMs?: number; slowMs?: number; easing?: string; blinkPeriodMs?: number }
  controls?: { heightPx?: number; heightSmallPx?: number; focusRingWidthPx?: number; focusRingOffsetPx?: number }
  layout?: { sidebarWidthPx?: number }
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

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`
}

function modeBlock(theme: Theme, mode: Mode, selector: string): string {
  const lines: string[] = []
  for (const [key, token] of COLOR_TOKENS) {
    const value = pick(theme.colors[key], mode)
    if (value) lines.push(`${token}: ${value};`)
  }
  for (const [key, token] of STATE_TOKENS) {
    const value = pick(theme.states?.[key], mode)
    if (value) lines.push(`${token}: ${value};`)
  }
  lines.push(`color-scheme: ${mode === 'light' ? 'light' : 'dark'};`)
  return block(selector, lines)
}

export function generateTokensCss(theme: Theme): string {
  const t = theme.typography
  const sp = theme.spacing ?? {}
  const base = sp.basePx ?? 4
  const motion = theme.motion ?? {}
  const controls = theme.controls ?? {}

  const structure: string[] = [
    `--font-ui: ${t.fontFamily};`,
    `--font-mono: var(--font-ui);`,
  ]

  for (const [name, px] of Object.entries(t.scale?.read ?? {})) structure.push(`--text-${name}: ${px}px;`)
  for (const [name, px] of Object.entries(t.scale?.glance ?? {})) structure.push(`--glance-${name}: ${px}px;`)
  for (const [name, weight] of Object.entries(t.weights ?? {})) structure.push(`--weight-${name}: ${weight};`)

  // 0.12em rather than a px value: tracking that does not scale with the type
  // size stops meaning the same thing the moment a size changes.
  structure.push(`--tracking-label: ${(t.letterSpacingLabelsPx / t.baseSizePx).toFixed(3)}em;`)

  for (const step of [1, 2, 3, 4, 5, 6, 8, 12, 16]) structure.push(`--space-${step}: ${base * step}px;`)
  if (sp.gridGapPx) structure.push(`--grid-gap: ${sp.gridGapPx}px;`)
  if (sp.cardPaddingPx) structure.push(`--card-pad: ${sp.cardPaddingPx}px;`)
  if (sp.cardMinHeightPx) structure.push(`--card-min-h: ${sp.cardMinHeightPx}px;`)

  structure.push(`--radius: ${theme.shape.borderRadiusPx}px;`)
  structure.push(`--border-w: ${theme.shape.borderWidthPx}px;`)
  structure.push(`--border-w-strong: ${theme.shape.borderWidthStrongPx ?? theme.shape.borderWidthPx}px;`)

  if (controls.heightPx) structure.push(`--control-h: ${controls.heightPx}px;`)
  if (controls.heightSmallPx) structure.push(`--control-h-sm: ${controls.heightSmallPx}px;`)
  if (controls.focusRingWidthPx) structure.push(`--focus-w: ${controls.focusRingWidthPx}px;`)
  if (controls.focusRingOffsetPx) structure.push(`--focus-offset: ${controls.focusRingOffsetPx}px;`)
  if (theme.layout?.sidebarWidthPx) structure.push(`--sidebar-w: ${theme.layout.sidebarWidthPx}px;`)

  if (motion.fastMs) structure.push(`--motion-fast: ${motion.fastMs}ms;`)
  if (motion.baseMs) structure.push(`--motion-base: ${motion.baseMs}ms;`)
  if (motion.slowMs) structure.push(`--motion-slow: ${motion.slowMs}ms;`)
  if (motion.easing) structure.push(`--ease: ${motion.easing};`)
  if (motion.blinkPeriodMs) structure.push(`--blink-period: ${motion.blinkPeriodMs}ms;`)

  const parts = [
    `/* Generated from theme "${theme.name}". Do not edit: change the theme file. */`,
    block(':root', structure),
    modeBlock(theme, 'dark', ':root, [data-mode="dark"]'),
    modeBlock(theme, 'light', '[data-mode="light"]'),
    modeBlock(theme, 'night', '[data-mode="night"]'),
  ]

  const large = theme.density?.largeScaleFactor
  if (large && t.scale?.read) {
    const scaled = Object.entries(t.scale.read).map(
      ([name, px]) => `--text-${name}: ${Math.round(px * large)}px;`,
    )
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
