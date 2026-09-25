/**
 * Measure text contrast on what is actually painted, for a theme with pictures.
 *
 * WHY THIS EXISTS. A palette can pass WCAG on paper and still fail on the wall:
 * a backdrop photograph, a card watermark, a gradient or a `border-image` rule
 * all sit between the ink and the surface colour the ratio was computed
 * against. test/theme.test.ts checks the palette; this checks the pixels.
 *
 * HOW IT MEASURES. Two screenshots of the same frame: one as rendered, one with
 * every colour forced transparent. Where they differ, a glyph was painted; the
 * background under that glyph is what the second shot shows at the same pixel.
 * Measuring a string's *bounding box* instead reads coloured bars, borders and
 * event ticks that merely sit inside the box, which produces 1.5:1 readings for
 * text that is plainly legible — and buries the real failures among them.
 *
 * Usage:
 *   node scripts/theme-preview.mjs &          # or `npm start`
 *   node scripts/theme-contrast.mjs <theme-id> [--pages 0,1,2] [--backdrops 6] [--port 8791]
 *
 * Needs a Chromium-family browser and playwright-core, neither of which is a
 * project dependency (this is a design tool, not part of the build):
 *   npm i --no-save playwright-core
 * It drives an installed Chrome/Edge; set CHROME to override the path.
 *
 * Exit code is 1 if any string measures below 4.5:1, so it can gate a change.
 * textDisabled is skipped: DESIGN.md allows that one role below AA.
 */
import { existsSync } from 'node:fs'

const [themeArg, ...rest] = process.argv.slice(2)
if (!themeArg) {
  process.stderr.write('usage: node scripts/theme-contrast.mjs <theme-id> [--pages 0,1] [--backdrops 6] [--port 8791]\n')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i > -1 ? rest[i + 1] : fallback
}
const PORT = Number(flag('port', 8791))
const PAGES = String(flag('pages', '0,1,2,3,4,5')).split(',').map(Number)
const BACKDROPS = Number(flag('backdrops', 6))
const MODES = String(flag('modes', 'dark,light,night')).split(',')
const MIN = Number(flag('min', 4.5))

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  process.stderr.write('playwright-core is not installed. Run: npm i --no-save playwright-core\n')
  process.exit(2)
}

const CANDIDATES = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  process.stderr.write(`no Chrome/Edge found. Set CHROME=<path>. Tried:\n${CANDIDATES.join('\n')}\n`)
  process.exit(2)
}

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [hi, lo] = [a, b].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 })
await page.addInitScript((id) => sessionStorage.setItem('k7:theme-session', id), themeArg)
page.on('pageerror', () => {})   // a card failing on mock data is not this tool's business

/** Every string on screen, with its colour, its box, and where it lives. */
async function strings(mode, backdrop, pageIndex) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  await page.evaluate(([m, b, p]) => {
    document.documentElement.dataset.mode = m
    document.documentElement.dataset.backdrop = String(b)
    const track = document.querySelector('.pager-track')
    if (track) { track.style.transition = 'none'; track.style.transform = `translate3d(${-100 * p}%,0,0)` }
  }, [mode, backdrop, pageIndex])
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(700)

  return page.evaluate(() => {
    const out = []
    const push = (el, where) => {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return
      const r = el.getBoundingClientRect()
      if (r.width < 6 || r.height < 6 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return
      out.push({ where, text: el.textContent.trim().slice(0, 28), color: cs.color, box: [r.x, r.y, r.width, r.height] })
    }
    for (const el of document.querySelectorAll('.shell-head *, .shell-foot *')) push(el, 'chrome')
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot)   // every widget is a custom element
        push(el, 'card')
      }
    }
    walk(document.querySelector('.deck'))
    return out
  })
}

/** The disabled ink for this mode: the one role allowed under AA. */
const disabledColour = () => page.evaluate(() => {
  const probe = document.createElement('span')
  probe.style.color = 'var(--fg-disabled)'
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
})

async function frame() {
  const buf = await page.screenshot()
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    return { w: c.width, h: c.height, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }
  }, buf.toString('base64'))
}

async function hideText() {
  await page.evaluate(() => {
    const css = '*, *::before, *::after { color: transparent !important; text-shadow: none !important; caret-color: transparent !important }'
    const add = (root) => {
      const s = document.createElement('style')
      s.textContent = css
      ;(root.head ?? root).appendChild(s)
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) add(el.shadowRoot)
    }
    add(document)
  })
  await page.waitForTimeout(250)
}

function measure(items, A, B, skipColour) {
  const out = []
  for (const it of items) {
    if (it.color === skipColour) continue
    const [r, g, b] = it.color.match(/[\d.]+/g).map(Number)
    const fg = lum(r, g, b)
    let worst = Infinity
    let glyphPixels = 0
    const x0 = Math.max(0, Math.round(it.box[0])), y0 = Math.max(0, Math.round(it.box[1]))
    const x1 = Math.min(A.w, Math.round(it.box[0] + it.box[2])), y1 = Math.min(A.h, Math.round(it.box[1] + it.box[3]))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * A.w + x) * 4
        const diff = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])
        if (diff < 40) continue                       // antialiasing and noise, not a glyph
        glyphPixels++
        const r2 = ratio(fg, lum(B.data[i], B.data[i + 1], B.data[i + 2]))
        if (r2 < worst) worst = r2
      }
    }
    if (glyphPixels >= 6) out.push({ ...it, worst })
  }
  return out.sort((a, b) => a.worst - b.worst)
}

let failed = false
for (const mode of MODES) {
  const skip = await (async () => { await strings(mode, 0, 0); return disabledColour() })()
  for (let backdrop = 0; backdrop < BACKDROPS; backdrop++) {
    const items = await strings(mode, backdrop, 0)
    const A = await frame()
    await hideText()
    const measured = measure(items.filter((i) => i.where === 'chrome'), A, await frame(), skip)
    report(`header/footer ${mode} backdrop ${backdrop}`, measured)
  }
  for (const p of PAGES) {
    const items = await strings(mode, 0, p)
    const A = await frame()
    await hideText()
    const measured = measure(items.filter((i) => i.where === 'card'), A, await frame(), skip)
    report(`cards ${mode} page ${p}`, measured)
  }
}

function report(label, measured) {
  const bad = measured.filter((m) => m.worst < MIN)
  if (bad.length) failed = true
  const worst = measured[0] ? measured[0].worst.toFixed(2) : '-'
  process.stdout.write(
    `${label}: ${String(measured.length).padStart(3)} strings, worst ${worst}` +
    (bad.length ? `  BELOW ${MIN}: ${bad.map((b) => `"${b.text}" ${b.worst.toFixed(2)}`).join(', ')}` : '  ok') + '\n',
  )
}

await browser.close()
process.exit(failed ? 1 : 0)
