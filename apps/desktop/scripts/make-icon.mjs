// Draws build-resources/icon.png and assets/tray.png. Afterwards run
// `npx tauri icon build-resources/icon.png`; docs/logo.svg mirrors the mark.

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const INK = [0x14, 0x17, 0x1c]
const SIGNAL = [0xe2, 0xa6, 0x40] // amber
const LINKED = [0x52, 0xc7, 0xb8] // teal

// Distance-field helpers with 1px anti-aliasing.
function coverage (signedDist) {
  return Math.min(1, Math.max(0, 0.5 - signedDist))
}

function roundedRectDist (x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius)
  const dy = Math.abs(y - cy) - (halfH - radius)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius
}

function circleDist (x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r
}

function segmentDist (x, y, [ax, ay], [bx, by]) {
  const px = x - ax
  const py = y - ay
  const vx = bx - ax
  const vy = by - ay
  const t = Math.min(1, Math.max(0, (px * vx + py * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - vx * t, py - vy * t)
}

function blend (base, color, alpha) {
  return base.map((c, i) => c + (color[i] - c) * alpha)
}

// The mark in a 24-unit box: an isometric box (hexagon outline plus the three
// inner edges) whose inner edges meet at a teal peer node.
function markSegments () {
  const r = 7
  const v = [-90, -30, 30, 90, 150, 210].map((deg) => {
    const a = (deg * Math.PI) / 180
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)]
  })
  const outline = v.map((p, i) => [p, v[(i + 1) % 6]])
  const inner = [v[1], v[3], v[5]].map((p) => [[12, 12], p])
  return [...outline, ...inner]
}

function render ({ size, plate, stroke, gap, node }) {
  const png = new PNG({ width: size, height: size })
  const s = size / 24
  const segs = markSegments().map(([a, b]) => [[a[0] * s, a[1] * s], [b[0] * s, b[1] * s]])
  const C = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const lineDist = Math.min(...segs.map(([a, b]) => segmentDist(px, py, a, b))) - (stroke * s) / 2
      const lines = coverage(lineDist) * coverage(-circleDist(px, py, C, C, gap * s))
      const dot = coverage(circleDist(px, py, C, C, node * s))

      let rgb = INK
      let alpha
      if (plate) {
        alpha = coverage(roundedRectDist(px, py, C, C, size * 0.461, size * 0.461, size * 0.1875))
        rgb = blend(rgb, SIGNAL, lines)
        rgb = blend(rgb, LINKED, dot)
      } else {
        alpha = Math.max(lines, dot)
        rgb = dot > 0 ? blend(SIGNAL, LINKED, dot) : SIGNAL
      }

      const idx = (y * size + x) * 4
      png.data[idx] = Math.round(rgb[0])
      png.data[idx + 1] = Math.round(rgb[1])
      png.data[idx + 2] = Math.round(rgb[2])
      png.data[idx + 3] = Math.round(alpha * 255)
    }
  }
  return png
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputs = [
  ['build-resources/icon.png', { size: 512, plate: true, stroke: 1.15, gap: 2.4, node: 1.55 }],
  // Thicker strokes so the glyph survives a 16-22px tray slot.
  ['assets/tray.png', { size: 32, plate: false, stroke: 2.2, gap: 3.4, node: 2.3 }]
]
for (const [rel, opts] of outputs) {
  const out = join(root, rel)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, PNG.sync.write(render(opts)))
  console.log('wrote', out)
}
