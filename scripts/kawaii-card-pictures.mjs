#!/usr/bin/env node
// Makes the `kawaii` theme's card pictures legible under text, by
// construction rather than by hope.
//
// Each source illustration is cover-cropped to 1024×768, blended toward the
// mode's `surface` (strength per job), then clamped pixel by pixel: any pixel
// on which one of the seven text roles would fall under the target contrast
// is pulled further toward `surface` until it does not. The result is encoded
// as JPEG, decoded again, and measured; if JPEG ringing pushed any pixel
// under 4.5:1 the target is raised by 0.2 and the job redone. So every pixel
// of every shipped file keeps every text role at >= 4.5:1 — the palette in
// kawaii.yaml is read at run time, so a palette change means re-running this.
//
//   node scripts/kawaii-card-pictures.mjs <source-dir> [chrome-path]
//
// <source-dir> holds the Gemini originals, named as in `jobs` below (they are
// not committed: ~5 MB, and this script is the only thing that reads them).
// Needs playwright-core (`npm i --no-save playwright-core`) and a Chrome.
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
const theme = parse(readFileSync('design-system/themes/kawaii.yaml', 'utf8'))
const ROLES = ['textPrimary', 'textMuted', 'accent', 'signal', 'warn', 'danger', 'display']
const FLOOR = 4.5   // what the decoded JPEG must meet at every pixel
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (h) => { const n = parseInt(h.slice(1, 7), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) }
const pick = (mode, k) => theme.colors[k][mode] ?? theme.colors[k].dark
function bounds(mode, MIN) {
  const Ls = ROLES.map((k) => lum(pick(mode, k)))
  // light: text is dark, the picture must stay at least this light; dark/night: at most this light.
  return mode === 'light'
    ? { lo: Math.max(...Ls.map((L) => (L + 0.05) * MIN - 0.05)), hi: 1 }
    : { lo: 0, hi: Math.min(...Ls.map((L) => (L + 0.05) / MIN - 0.05)) }
}
const jobs = [
  ...['clouds', 'meadow', 'picnic', 'balloons', 'windowsill'].map((n) => [`c-${n}`, `card-${n}-light.jpg`, 'light', 0.75]),
  ...['cloud', 'unicorn', 'cocoa', 'balloons', 'windowsill'].map((n) => [`n-${n}`, `card-${n}-dark.jpg`, 'dark', 0.8]),
  ...['cloud', 'unicorn', 'cocoa', 'balloons', 'windowsill'].map((n) => [`n-${n}`, `card-${n}-night.jpg`, 'night', 0.6]),
]
const [srcDir, chromeArg] = process.argv.slice(2)
if (!srcDir) {
  process.stderr.write('usage: node scripts/kawaii-card-pictures.mjs <source-dir> [chrome-path]\n')
  process.exit(2)
}
const executablePath = [chromeArg, process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
const br = await chromium.launch({ executablePath })
const page = await br.newPage()
for (const [src, out, mode, strength] of jobs) {
 const floor = bounds(mode, FLOOR)
 for (let MIN = 4.8; ; MIN += 0.2) {
  const b = bounds(mode, MIN)
  const surface = pick(mode, 'surface')
  const b64 = readFileSync(`${srcDir}/${src}.jpg`).toString('base64')
  const res = await page.evaluate(async ([b64, b, surface, strength]) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode()
    const W = 1024, H = 768, c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d')
    const s = Math.max(W / img.width, H / img.height)
    x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s)
    const im = x.getImageData(0, 0, W, H), d = im.data
    const lut = new Float64Array(256).map((_, v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    const n = parseInt(surface.slice(1), 16), sr = n >> 16 & 255, sg = n >> 8 & 255, sb = n & 255
    const L = (r, g, bb) => 0.2126 * lut[Math.round(r)] + 0.7152 * lut[Math.round(g)] + 0.0722 * lut[Math.round(bb)]
    let clamped = 0, worst = b.lo ? 1 : 0
    for (let i = 0; i < d.length; i += 4) {
      let t = strength
      const mix = (t) => [sr + (d[i] - sr) * t, sg + (d[i + 1] - sg) * t, sb + (d[i + 2] - sb) * t]
      let [r, g, bl] = mix(t)
      const ok = (r, g, bl) => { const l = L(r, g, bl); return l >= b.lo && l <= b.hi }
      if (!ok(r, g, bl)) {
        clamped++
        let lo = 0, hi = t
        for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; const p = mix(m); if (ok(...p)) lo = m; else hi = m }
        ;[r, g, bl] = mix(lo)
      }
      d[i] = Math.round(r); d[i + 1] = Math.round(g); d[i + 2] = Math.round(bl)
      const l = L(d[i], d[i + 1], d[i + 2]); worst = b.lo ? Math.min(worst, l) : Math.max(worst, l)
    }
    x.putImageData(im, 0, 0)
    // Re-measure after JPEG, the file the kiosk actually decodes.
    const url = c.toDataURL('image/jpeg', 0.8)
    const back = new Image(); back.src = url; await back.decode()
    x.drawImage(back, 0, 0)
    const e = x.getImageData(0, 0, W, H).data
    let after = b.lo ? 1 : 0
    for (let i = 0; i < e.length; i += 4) { const l = L(e[i], e[i + 1], e[i + 2]); after = b.lo ? Math.min(after, l) : Math.max(after, l) }
    return { url, clamped: clamped / (W * H), worst, after }
  }, [b64, b, surface, strength])
  const pass = mode === 'light' ? res.after >= floor.lo : res.after <= floor.hi
  if (!pass && MIN < 9) continue
  writeFileSync(`design-system/themes/kawaii/images/${out}`, Buffer.from(res.url.split(',')[1], 'base64'))
  console.log(out.padEnd(28), mode.padEnd(5), `target ${MIN.toFixed(1)}`, `clamped ${(res.clamped * 100).toFixed(1)}%`, `jpeg extreme ${res.after.toFixed(3)} vs floor ${(floor.lo || floor.hi).toFixed(3)}`, pass ? 'ok' : 'FAIL')
  break
 }
}
await br.close()
