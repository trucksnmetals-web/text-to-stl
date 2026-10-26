import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Font, Glyph, PathCommand } from 'opentype.js'

export type Align = 'left' | 'center' | 'right'
export type EdgeStyle = 'flat' | 'chamfer' | 'round'
export type PlateShape = 'none' | 'rect' | 'rounded' | 'pill'

export interface Settings {
  text: string
  fontId: string
  letterHeight: number
  textDepth: number
  letterSpacing: number
  lineSpacing: number
  align: Align
  edge: EdgeStyle
  edgeSize: number
  plate: PlateShape
  plateThickness: number
  platePadding: number
  cornerRadius: number
  hole: boolean
  holeDiameter: number
  quality: number
  textColor: string
  plateColor: string
}

export interface ModelResult {
  text: THREE.BufferGeometry | null
  plate: THREE.BufferGeometry | null
  size: THREE.Vector3
  triangles: number
}

type Contour = THREE.Vector2[]

const EPS = 1e-6

function signedArea(pts: Contour): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y
  }
  return a / 2
}

function pointInPolygon(p: THREE.Vector2, poly: Contour): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function contains(outer: Contour, inner: Contour): boolean {
  const samples = Math.min(inner.length, 24)
  const step = inner.length / samples
  let hits = 0
  for (let k = 0; k < samples; k++) {
    if (pointInPolygon(inner[Math.floor(k * step)], outer)) hits++
  }
  return hits > samples / 2
}

function cleanContour(pts: THREE.Vector2[]): Contour {
  const out: Contour = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || last.distanceToSquared(p) > EPS) out.push(p.clone())
  }
  while (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) <= EPS) out.pop()
  return out
}

function commandsToContours(cmds: PathCommand[], ox: number, oy: number, segments: number): Contour[] {
  const contours: Contour[] = []
  let cur: THREE.Path | null = null
  const flush = () => {
    if (cur) {
      const pts = cleanContour(cur.getPoints(segments))
      if (pts.length >= 3) contours.push(pts)
      cur = null
    }
  }
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        flush()
        cur = new THREE.Path()
        cur.moveTo(ox + c.x, oy - c.y)
        break
      case 'L':
        cur?.lineTo(ox + c.x, oy - c.y)
        break
      case 'Q':
        cur?.quadraticCurveTo(ox + c.x1, oy - c.y1, ox + c.x, oy - c.y)
        break
      case 'C':
        cur?.bezierCurveTo(ox + c.x1, oy - c.y1, ox + c.x2, oy - c.y2, ox + c.x, oy - c.y)
        break
      case 'Z':
        flush()
        break
    }
  }
  flush()
  return contours
}

/** Groups contours into shapes with holes using nesting depth, independent of winding direction. */
function contoursToShapes(contours: Contour[]): THREE.Shape[] {
  const items = contours
    .map((pts) => ({ pts, area: Math.abs(signedArea(pts)) }))
    .filter((c) => c.area > 1e-4)
    .sort((a, b) => b.area - a.area)
  const parent: number[] = []
  const depth: number[] = []
  for (let i = 0; i < items.length; i++) {
    parent[i] = -1
    for (let j = i - 1; j >= 0; j--) {
      if (items[j].area > items[i].area && contains(items[j].pts, items[i].pts)) {
        parent[i] = j
        break
      }
    }
    depth[i] = parent[i] === -1 ? 0 : depth[parent[i]] + 1
  }
  const shapes = new Map<number, THREE.Shape>()
  items.forEach((it, i) => {
    if (depth[i] % 2 === 0) shapes.set(i, new THREE.Shape(it.pts))
  })
  items.forEach((it, i) => {
    if (depth[i] % 2 === 1) shapes.get(parent[i])?.holes.push(new THREE.Path(it.pts))
  })
  return [...shapes.values()]
}

function capHeightUnits(font: Font): number {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined
  if (os2?.sCapHeight && os2.sCapHeight > 0) return os2.sCapHeight
  const h = font.charToGlyph('H')
  const box = h.getBoundingBox()
  if (box.y2 > 0) return box.y2
  return font.unitsPerEm * 0.7
}

/** Returns glyph shapes per glyph, laid out in millimetres with y up. */
export function layoutText(font: Font, s: Settings): THREE.Shape[][] {
  const fontSize = (s.letterHeight * font.unitsPerEm) / capHeightUnits(font)
  const scale = fontSize / font.unitsPerEm
  const lines = s.text.replace(/\r/g, '').split('\n')
  const lineAdvance = s.letterHeight * s.lineSpacing

  const laidOut = lines.map((line) => {
    const glyphs: Glyph[] = font.stringToGlyphs(line)
    const positions: number[] = []
    let x = 0
    glyphs.forEach((g, i) => {
      positions.push(x)
      x += (g.advanceWidth ?? 0) * scale
      const next = glyphs[i + 1]
      if (next) x += font.getKerningValue(g, next) * scale + s.letterSpacing
    })
    return { glyphs, positions, width: x }
  })
  const maxWidth = Math.max(0, ...laidOut.map((l) => l.width))

  const out: THREE.Shape[][] = []
  laidOut.forEach((l, li) => {
    const offset = s.align === 'center' ? (maxWidth - l.width) / 2 : s.align === 'right' ? maxWidth - l.width : 0
    const baseline = -li * lineAdvance
    l.glyphs.forEach((g, gi) => {
      const path = g.getPath(0, 0, fontSize)
      const contours = commandsToContours(path.commands, offset + l.positions[gi], baseline, s.quality)
      const shapes = contoursToShapes(contours)
      if (shapes.length) out.push(shapes)
    })
  })
  return out
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): THREE.Shape {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  const s = new THREE.Shape()
  if (r <= EPS) {
    s.moveTo(x, y)
    s.lineTo(x + w, y)
    s.lineTo(x + w, y + h)
    s.lineTo(x, y + h)
    s.closePath()
    return s
  }
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

export function holeWall(s: Settings): number {
  return Math.max(2.5, s.holeDiameter * 0.6)
}

export function buildModel(font: Font, s: Settings): ModelResult {
  const glyphShapes = layoutText(font, s)
  const allShapes = glyphShapes.flat()

  const bevel = s.edge !== 'flat' && s.edgeSize > 0
  const maxBevel = Math.min(s.letterHeight * 0.06, s.textDepth / 2 - 0.05)
  const bt = bevel ? Math.max(0, Math.min(s.edgeSize, maxBevel)) : 0
  const useBevel = bt > 0.01
  const hasPlate = s.plate !== 'none'
  const sink = hasPlate ? Math.max(bt, 0.05) : 0

  let text: THREE.BufferGeometry | null = null
  if (allShapes.length) {
    const geoms = allShapes.map(
      (shape) =>
        new THREE.ExtrudeGeometry(shape, {
          depth: Math.max(0.01, s.textDepth + sink - (useBevel ? 2 * bt : 0)),
          steps: 1,
          curveSegments: s.quality,
          bevelEnabled: useBevel,
          bevelThickness: bt,
          bevelSize: bt,
          bevelOffset: -bt,
          bevelSegments: s.edge === 'round' ? 4 : 1,
        }),
    )
    text = mergeGeometries(geoms, false)
    geoms.forEach((g) => g.dispose())
    if (text) {
      const base = hasPlate ? s.plateThickness - sink : 0
      text.translate(0, 0, base + (useBevel ? bt : 0))
    }
  }

  const box = new THREE.Box3()
  if (text) {
    text.computeBoundingBox()
    box.copy(text.boundingBox!)
  } else {
    box.set(new THREE.Vector3(-10, -5, 0), new THREE.Vector3(10, 5, 0))
  }

  let plate: THREE.BufferGeometry | null = null
  if (hasPlate) {
    const pad = s.platePadding
    let x0 = box.min.x - pad
    const x1 = box.max.x + pad
    let y0 = box.min.y - pad
    let y1 = box.max.y + pad
    const wall = holeWall(s)
    const holeR = s.holeDiameter / 2
    if (s.hole) {
      const minH = s.holeDiameter + 2 * wall
      if (y1 - y0 < minH) {
        const cy = (y0 + y1) / 2
        y0 = cy - minH / 2
        y1 = cy + minH / 2
      }
      x0 -= s.holeDiameter + wall
    }
    const w = x1 - x0
    const h = y1 - y0
    const r = s.plate === 'rect' ? 0 : s.plate === 'pill' ? h / 2 : s.cornerRadius
    const shape = roundedRect(x0, y0, w, h, r)
    if (s.hole) {
      const cx = s.plate === 'pill' ? x0 + Math.max(wall + holeR, h / 2) : x0 + wall + holeR
      const hole = new THREE.Path()
      hole.absarc(cx, (y0 + y1) / 2, holeR, 0, Math.PI * 2, true)
      shape.holes.push(hole)
    }
    plate = new THREE.ExtrudeGeometry(shape, {
      depth: s.plateThickness,
      steps: 1,
      curveSegments: Math.max(12, s.quality * 3),
      bevelEnabled: false,
    })
  }

  const full = new THREE.Box3()
  for (const g of [text, plate]) {
    if (!g) continue
    g.computeBoundingBox()
    full.union(g.boundingBox!)
  }
  const center = full.getCenter(new THREE.Vector3())
  for (const g of [text, plate]) {
    if (!g) continue
    g.translate(-center.x, -center.y, -full.min.z)
    g.computeBoundingBox()
    g.computeBoundingSphere()
  }
  const size = full.isEmpty() ? new THREE.Vector3() : full.getSize(new THREE.Vector3())
  const tri = (g: THREE.BufferGeometry | null) =>
    g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0
  return { text, plate, size, triangles: tri(text) + tri(plate) }
}
