#!/usr/bin/env node
// Draws the `kawaii` theme's vector pictures: the pattern backdrop, card
// frame, title rule, header-band mascot and card watermark. The scenic
// backdrops are raster illustrations in images/, credited in CREDITS.md.
//
//   node scripts/draw-kawaii-decor.mjs     → design-system/themes/kawaii/decor/
//
// The SVGs are committed; this script is how they were made and how to
// redraw them (a palette tweak is one edit here, not twenty in the files).
// No <filter>, no blur, no animation: the A8X rasterises each picture once.
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = 'design-system/themes/kawaii/decor'
mkdirSync(OUT, { recursive: true })

const svg = (w, h, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extra}>${body}</svg>\n`
const f = (n) => Math.round(n * 10) / 10

// --- palettes -----------------------------------------------------------------
// Light is strawberry milk in daylight; dark is the same world at bedtime —
// plum sky, pastels dimmed to sit with the dark illustrations; night reuses
// dark under an overlay.
const LIGHT = {
  rainbow: ['#ffb3d1', '#ffcfa8', '#fff0a0', '#bff0d4', '#b8dcff', '#d9c2ff'],
  skyTop: '#ffe3f0', skyMid: '#f6e4ff', skyBottom: '#e3f1ff',
  cloud: '#ffffff', cloudShade: '#f3e6f7',
  fur: '#ffffff', furShade: '#f4e7f2', ink: '#5a3560', blush: '#ff9cc4', earIn: '#ffc2db',
  horn: '#ffe08a', hornLine: '#e8b84d', star: '#fff2a8', starAlt: '#ffffff', heart: '#ff9cc4',
}
const DARK = {
  rainbow: ['#b0588c', '#b67a5e', '#b0a05c', '#4f9a7c', '#5578b5', '#8a63b8'],
  skyTop: '#1b1430', skyMid: '#2a1d45', skyBottom: '#3a2552',
  cloud: '#4b3c69', cloudShade: '#3d3058',
  fur: '#d9cde6', furShade: '#b8a8cc', ink: '#2a1838', blush: '#c46b98', earIn: '#c98fb2',
  horn: '#c9a95a', hornLine: '#8f733a', star: '#e8d48a', starAlt: '#b9a8e0', heart: '#b8628f',
}

// --- little shapes ---------------------------------------------------------------
const heart = (x, y, s, fill, op = 1) =>
  `<path d="M${f(x)},${f(y + s * 0.3)} C${f(x)},${f(y - s * 0.1)} ${f(x - s * 0.55)},${f(y - s * 0.15)} ${f(x - s * 0.55)},${f(y + s * 0.2)} C${f(x - s * 0.55)},${f(y + s * 0.5)} ${f(x - s * 0.2)},${f(y + s * 0.7)} ${f(x)},${f(y + s * 0.9)} C${f(x + s * 0.2)},${f(y + s * 0.7)} ${f(x + s * 0.55)},${f(y + s * 0.5)} ${f(x + s * 0.55)},${f(y + s * 0.2)} C${f(x + s * 0.55)},${f(y - s * 0.15)} ${f(x)},${f(y - s * 0.1)} ${f(x)},${f(y + s * 0.3)} Z" fill="${fill}" opacity="${op}"/>`

// A four-point sparkle, the kawaii "shine".
const sparkle = (x, y, s, fill, op = 1) => {
  const k = s * 0.22
  return `<path d="M${f(x)},${f(y - s)} Q${f(x + k)},${f(y - k)} ${f(x + s)},${f(y)} Q${f(x + k)},${f(y + k)} ${f(x)},${f(y + s)} Q${f(x - k)},${f(y + k)} ${f(x - s)},${f(y)} Q${f(x - k)},${f(y - k)} ${f(x)},${f(y - s)} Z" fill="${fill}" opacity="${op}"/>`
}

// A soft five-point star with rounded joins.
const star = (x, y, r, fill, op = 1) => {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.48 : r
    pts.push(`${f(x + rr * Math.cos(a))},${f(y + rr * Math.sin(a))}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="${f(r * 0.25)}" stroke-linejoin="round" opacity="${op}"/>`
}

const cloud = (x, y, s, c) => {
  const puffs = [[0, 0, 0.5], [0.45, -0.22, 0.42], [0.85, 0.02, 0.4], [-0.42, 0.08, 0.36], [0.2, 0.12, 0.48]]
  return `<g>${puffs.map(([dx, dy, r]) => `<circle cx="${f(x + dx * s)}" cy="${f(y + dy * s + s * 0.06)}" r="${f(r * s)}" fill="${c.cloudShade}"/>`).join('')}${puffs
    .map(([dx, dy, r]) => `<circle cx="${f(x + dx * s)}" cy="${f(y + dy * s)}" r="${f(r * s)}" fill="${c.cloud}"/>`)
    .join('')}</g>`
}

// A rainbow as concentric arcs; `open` bands from the outside in.
const rainbow = (cx, cy, r, band, colors, op = 1) =>
  `<g fill="none" stroke-linecap="round" opacity="${op}">${colors
    .map((col, i) => {
      const rr = r - i * band
      return `<path d="M${f(cx - rr)},${f(cy)} A${f(rr)},${f(rr)} 0 0 1 ${f(cx + rr)},${f(cy)}" stroke="${col}" stroke-width="${f(band + 0.5)}"/>`
    })
    .join('')}</g>`

// Happy closed eyes: ^ ^
const happyEye = (x, y, s, ink) =>
  `<path d="M${f(x - s)},${f(y + s * 0.3)} Q${f(x)},${f(y - s * 0.7)} ${f(x + s)},${f(y + s * 0.3)}" fill="none" stroke="${ink}" stroke-width="${f(s * 0.42)}" stroke-linecap="round"/>`
// Round shiny eyes, the other kawaii face.
const shinyEye = (x, y, s, ink) =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.62)}" ry="${f(s * 0.78)}" fill="${ink}"/><circle cx="${f(x + s * 0.2)}" cy="${f(y - s * 0.3)}" r="${f(s * 0.24)}" fill="#ffffff"/>`
// Sleeping eyes: a downward curve.
const sleepEye = (x, y, s, ink) =>
  `<path d="M${f(x - s)},${f(y - s * 0.1)} Q${f(x)},${f(y + s * 0.7)} ${f(x + s)},${f(y - s * 0.1)}" fill="none" stroke="${ink}" stroke-width="${f(s * 0.38)}" stroke-linecap="round"/>`
// The ω mouth.
const catMouth = (x, y, s, ink) =>
  `<path d="M${f(x - s)},${f(y)} Q${f(x - s * 0.5)},${f(y + s * 0.8)} ${f(x)},${f(y)} Q${f(x + s * 0.5)},${f(y + s * 0.8)} ${f(x + s)},${f(y)}" fill="none" stroke="${ink}" stroke-width="${f(s * 0.32)}" stroke-linecap="round" stroke-linejoin="round"/>`

const horn = (x, y, w, h, c) => {
  const lines = [0.3, 0.55, 0.78]
    .map((t) => {
      const yy = y - h * t
      const half = (w / 2) * (1 - t)
      return `<path d="M${f(x - half)},${f(yy + h * 0.06)} L${f(x + half)},${f(yy - h * 0.04)}" stroke="${c.hornLine}" stroke-width="${f(w * 0.12)}" stroke-linecap="round"/>`
    })
    .join('')
  return `<path d="M${f(x - w / 2)},${f(y)} Q${f(x - w * 0.1)},${f(y - h * 0.5)} ${f(x)},${f(y - h)} Q${f(x + w * 0.1)},${f(y - h * 0.5)} ${f(x + w / 2)},${f(y)} Z" fill="${c.horn}" stroke="${c.hornLine}" stroke-width="${f(w * 0.08)}" stroke-linejoin="round"/>${lines}`
}

// The mascot: a round kawaii cat with a unicorn horn — a caticorn.
function caticorn(x, y, s, c, { eyes = 'happy', mane = true } = {}) {
  const ink = c.ink
  const ear = (dir) => {
    const ex = x + dir * s * 0.62
    return `<path d="M${f(x + dir * s * 0.92)},${f(y - s * 0.12)} L${f(ex + dir * s * 0.12)},${f(y - s * 1.02)} L${f(x + dir * s * 0.2)},${f(y - s * 0.62)} Z" fill="${c.fur}" stroke="${c.furShade}" stroke-width="${f(s * 0.05)}" stroke-linejoin="round"/>` +
      `<path d="M${f(x + dir * s * 0.78)},${f(y - s * 0.26)} L${f(ex + dir * s * 0.1)},${f(y - s * 0.82)} L${f(x + dir * s * 0.36)},${f(y - s * 0.58)} Z" fill="${c.earIn}"/>`
  }
  const maneCurls = mane
    ? c.rainbow.map((col, i) => `<circle cx="${f(x - s * 0.55 + i * s * 0.22)}" cy="${f(y - s * 0.72 + Math.abs(i - 2.5) * s * 0.07)}" r="${f(s * 0.16)}" fill="${col}"/>`).join('')
    : ''
  const eye = eyes === 'shiny' ? shinyEye : eyes === 'sleep' ? sleepEye : happyEye
  return `<g>${ear(-1)}${ear(1)}` +
    `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s)}" ry="${f(s * 0.82)}" fill="${c.fur}" stroke="${c.furShade}" stroke-width="${f(s * 0.05)}"/>` +
    maneCurls + horn(x, y - s * 0.7, s * 0.26, s * 0.62, c) +
    eye(x - s * 0.4, y + s * 0.02, s * 0.16, ink) + eye(x + s * 0.4, y + s * 0.02, s * 0.16, ink) +
    `<ellipse cx="${f(x - s * 0.62)}" cy="${f(y + s * 0.28)}" rx="${f(s * 0.17)}" ry="${f(s * 0.1)}" fill="${c.blush}" opacity="0.8"/>` +
    `<ellipse cx="${f(x + s * 0.62)}" cy="${f(y + s * 0.28)}" rx="${f(s * 0.17)}" ry="${f(s * 0.1)}" fill="${c.blush}" opacity="0.8"/>` +
    catMouth(x, y + s * 0.24, s * 0.12, ink) +
    `<g stroke="${c.furShade}" stroke-width="${f(s * 0.04)}" stroke-linecap="round">` +
    `<path d="M${f(x - s * 0.82)},${f(y + s * 0.12)} L${f(x - s * 1.18)},${f(y + s * 0.04)}"/><path d="M${f(x - s * 0.82)},${f(y + s * 0.24)} L${f(x - s * 1.16)},${f(y + s * 0.3)}"/>` +
    `<path d="M${f(x + s * 0.82)},${f(y + s * 0.12)} L${f(x + s * 1.18)},${f(y + s * 0.04)}"/><path d="M${f(x + s * 0.82)},${f(y + s * 0.24)} L${f(x + s * 1.16)},${f(y + s * 0.3)}"/></g></g>`
}

const paw = (x, y, s, fill, op) =>
  `<g fill="${fill}" opacity="${op}"><ellipse cx="${f(x)}" cy="${f(y + s * 0.25)}" rx="${f(s * 0.42)}" ry="${f(s * 0.34)}"/>` +
  [[-0.42, -0.2], [-0.15, -0.42], [0.15, -0.42], [0.42, -0.2]].map(([dx, dy]) => `<ellipse cx="${f(x + dx * s)}" cy="${f(y + dy * s)}" rx="${f(s * 0.14)}" ry="${f(s * 0.18)}"/>`).join('') + `</g>`

// --- the pattern backdrop, 1024×768 (the kiosk's landscape viewport), `cover` ---
// The scenic backdrops are illustrations in ../images/ (see CREDITS.md);
// this one is the third in each mode's rotation: paws, stars and hearts.
function backdropPattern(c, dark) {
  const tile = 128
  const ground = dark ? c.skyMid : '#ffeaf4'
  const p = (dark ? 0.35 : 0.55)
  return svg(1024, 768,
    `<defs><pattern id="t" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">` +
      paw(32, 34, 22, c.heart, p) + star(96, 30, 9, c.star, dark ? 0.6 : 0.9) + heart(98, 82, 18, c.rainbow[5], p + 0.1) +
      sparkle(30, 98, 9, c.rainbow[4], 0.9) + `<circle cx="64" cy="64" r="3" fill="${c.rainbow[2]}"/>` +
    `</pattern><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground}" stop-opacity="0"/><stop offset="1" stop-color="${ground}" stop-opacity=".9"/></linearGradient></defs>` +
    `<rect width="1024" height="768" fill="${ground}"/><rect width="1024" height="768" fill="url(#t)"/><rect y="420" width="1024" height="348" fill="url(#v)"/>` +
    rainbow(512, 820, 300, 20, c.rainbow, 0.9) + cloud(230, 760, 90, c) + cloud(800, 760, 90, c) +
    caticorn(512, 640, 70, c, { eyes: dark ? 'happy' : 'shiny' }))
}

for (const [mode, c] of [['light', LIGHT], ['dark', DARK]]) {
  const dark = mode === 'dark'
  writeFileSync(`${OUT}/backdrop-sweets-${mode}.svg`, backdropPattern(c, dark))
}

// --- card frame: a nine-slice ribbon of pastel rainbow ----------------------------
// 96×96, sliced at 32 and drawn at 16px, so the outer corner radius of 32 in
// the file is exactly the theme's 16px border-radius on screen and the card's
// own rounded background sits flush inside the ribbon. Only the corner slices
// are fixed; the edges stretch, so every stripe is a plain rounded rect.
function frame(colors, heartFill) {
  const stripe = 3.4
  const rects = colors
    .map((col, i) => {
      const inset = stripe / 2 + i * stripe
      return `<rect x="${f(inset)}" y="${f(inset)}" width="${f(96 - 2 * inset)}" height="${f(96 - 2 * inset)}" rx="${f(32 - inset)}" fill="none" stroke="${col}" stroke-width="${f(stripe + 0.3)}"/>`
    })
    .join('')
  // A small heart riding the ribbon's top-left curve, inside the rounded
  // edge (anything outside it would hang off the clipped card), where no
  // card puts anything: the title starts after the padding.
  return svg(96, 96, rects + heart(15.5, 9.5, 12, heartFill))
}
const FRAME_LIGHT = ['#ffb3d1', '#ffd6ad', '#fff0a6', '#c4f0d8', '#c2e0ff']
const FRAME_DARK = ['#d77aa9', '#cf9a6c', '#cfc07a', '#6fb89b', '#7a9fd1']
const FRAME_NIGHT = ['#8f5674', '#87694d', '#857d53', '#4c7a68', '#556e91']
writeFileSync(`${OUT}/frame-light.svg`, frame(FRAME_LIGHT, '#ff7fb4'))
writeFileSync(`${OUT}/frame-dark.svg`, frame(FRAME_DARK, '#ff9fd0'))
writeFileSync(`${OUT}/frame-night.svg`, frame(FRAME_NIGHT, '#b0638a'))

// --- the rule under every title: a thin rainbow with a heart per tile -------------
// 180×30, the bottom 30 units sliced and drawn 20px tall, outset 16px. The
// stripes sit in units 3-11 (≈ 2-7px into the image, just under the head's
// padding); the heart hangs to unit 20 at most, which stays above the body.
function rule(colors, heartFill) {
  const h = 2
  const stripes = colors.map((col, i) => `<rect x="0" y="${f(3 + i * h)}" width="180" height="${f(h + 0.2)}" fill="${col}"/>`).join('')
  return svg(180, 30, stripes + heart(90, 8.5, 12, heartFill))
}
writeFileSync(`${OUT}/rule-light.svg`, rule(['#ffa3c8', '#ffd09e', '#bdebd2', '#b3d6ff'], '#ff7fb4'))
writeFileSync(`${OUT}/rule-dark.svg`, rule(['#d77aa9', '#cf9a6c', '#6fb89b', '#7a9fd1'], '#ff9fd0'))
writeFileSync(`${OUT}/rule-night.svg`, rule(['#8f5674', '#87694d', '#4c7a68', '#556e91'], '#b0638a'))

// --- header band mascot: the caticorn, 96×96, drawn at 44px ------------------------
writeFileSync(`${OUT}/mascot.svg`, svg(96, 96, caticorn(48, 56, 30, { ...LIGHT, ink: '#4a2a52' }, { eyes: 'happy' })))
writeFileSync(`${OUT}/mascot-dark.svg`, svg(96, 96, caticorn(48, 56, 30, { ...LIGHT, fur: '#fff6fb', ink: '#4a2a52' }, { eyes: 'happy' })))
writeFileSync(`${OUT}/mascot-night.svg`, svg(96, 96, caticorn(48, 56, 30, DARK, { eyes: 'sleep' })))

// --- card watermark: faint paws walking out of the bottom-left corner --------------
// ≤8% ink, per the themes README: [OK] lives bottom-right, so the paws stay left.
function paws(fill, op) {
  return svg(220, 160, paw(30, 128, 26, fill, op) + paw(78, 98, 26, fill, op) + paw(118, 120, 26, fill, op) + paw(166, 88, 26, fill, op) + paw(200, 46, 22, fill, op))
}
writeFileSync(`${OUT}/paws-light.svg`, paws('#c0367c', 0.07))
writeFileSync(`${OUT}/paws-dark.svg`, paws('#ff9fd0', 0.07))

console.log('drew', OUT)
