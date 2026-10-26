import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Font, Glyph, PathCommand } from 'opentype.js'
import polygonClipping, { type MultiPolygon, type Pair, type Polygon, type Ring } from 'polygon-clipping'
import * as ClipperNs from 'clipper-lib'

export type Align = 'left' | 'center' | 'right'
export type EdgeStyle = 'flat' | 'chamfer' | 'round'
export type PlateShape = 'none' | 'outline' | 'rect' | 'rounded' | 'pill'
export type TextStyle = 'raised' | 'engraved'

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
  textStyle: TextStyle
  engraveDepth: number
  plateThickness: number
  platePadding: number
  cornerRadius: number
  secondLayer: boolean
  secondLayerWidth: number
  secondLayerThickness: number
  hole: boolean
  holeDiameter: number
  quality: number
  textColor: string
  plateColor: string
  secondLayerColor: string
}

export interface ModelResult {
  /** Raised letters (raised mode only). */
  text: THREE.BufferGeometry | null
  /** Base plate; in engraved mode it has the letters cut into it. */
  plate: THREE.BufferGeometry | null
  /** Engraved mode: letter-shaped pieces that fill the engraving, for 2-color prints. */
  inlay: THREE.BufferGeometry | null
  /** Optional wider layer under the plate (stepped border). */
  base2: THREE.BufferGeometry | null
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

interface NestedPolygon {
  outer: Contour
  holes: Contour[]
}

/** Groups contours into polygons with holes using nesting depth, independent of winding direction. */
function nestContours(contours: Contour[]): NestedPolygon[] {
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
  const polys = new Map<number, NestedPolygon>()
  items.forEach((it, i) => {
    if (depth[i] % 2 === 0) polys.set(i, { outer: it.pts, holes: [] })
  })
  items.forEach((it, i) => {
    if (depth[i] % 2 === 1) polys.get(parent[i])?.holes.push(it.pts)
  })
  return [...polys.values()]
}

function nestedToShape(p: NestedPolygon): THREE.Shape {
  const shape = new THREE.Shape(p.outer)
  for (const h of p.holes) shape.holes.push(new THREE.Path(h))
  return shape
}

function contoursToShapes(contours: Contour[]): THREE.Shape[] {
  return nestContours(contours).map(nestedToShape)
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

function shapeToPolygon(shape: THREE.Shape, segments: number): Polygon {
  const { shape: outer, holes } = shape.extractPoints(segments)
  const ring = (pts: THREE.Vector2[]): Ring => {
    const r = cleanContour(pts).map((p) => [p.x, p.y] as [number, number])
    if (r.length) r.push([r[0][0], r[0][1]])
    return r
  }
  return [ring(outer), ...holes.map(ring)].filter((r) => r.length >= 4)
}

/**
 * Builds a single closed (manifold) solid: a plate whose top surface is `top`
 * (plate minus letters) with the letters sunk down to `floorZ`.
 */
function buildEngravedPlate(top: MultiPolygon, platePolys: MultiPolygon, T: number, floorZ: number) {
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`
  const plateKeys = new Set(platePolys.flat().flatMap((r) => r.map(([x, y]) => key(x, y))))
  const pos: number[] = []

  const ringPts = (r: Ring) => cleanContour(r.map(([x, y]) => new THREE.Vector2(x, y)))
  const tri = (a: THREE.Vector2, az: number, b: THREE.Vector2, bz: number, c: THREE.Vector2, cz: number) =>
    pos.push(a.x, a.y, az, b.x, b.y, bz, c.x, c.y, cz)

  const cap = (outer: Contour, holes: Contour[], z: number, up: boolean) => {
    const all = [outer, ...holes].flat()
    const faces = THREE.ShapeUtils.triangulateShape(
      outer.map((p) => p.clone()),
      holes.map((h) => h.map((p) => p.clone())),
    )
    for (const [i, j, k] of faces) {
      const a = all[i], b = all[j], c = all[k]
      const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
      if (ccw === up) tri(a, z, b, z, c, z)
      else tri(a, z, c, z, b, z)
    }
  }

  // Walls: orient each ring so the solid is on its left; then (a,b) quads face outward.
  const wall = (ring: Contour, solidInside: boolean, z0: number, z1: number) => {
    const ccw = signedArea(ring) > 0
    const pts = ccw === solidInside ? ring : [...ring].reverse()
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      tri(a, z0, b, z0, b, z1)
      tri(a, z0, b, z1, a, z1)
    }
  }

  const plateRings: Contour[] = []
  const grooveRings: Contour[] = []
  for (const poly of top) {
    poly.forEach((r, ri) => {
      const pts = ringPts(r)
      if (pts.length < 3) return
      const onPlate = pts.filter((p) => plateKeys.has(key(p.x, p.y))).length > pts.length / 2
      ;(onPlate ? plateRings : grooveRings).push(pts)
      // Outer rings of `top` enclose solid; holes have solid outside.
      wall(pts, ri === 0, onPlate ? 0 : floorZ, T)
    })
    const outer = ringPts(poly[0])
    if (outer.length >= 3) cap(outer, poly.slice(1).map(ringPts).filter((h) => h.length >= 3), T, true)
  }
  for (const p of nestContours(plateRings)) cap(p.outer, p.holes, 0, false)
  const floorStart = pos.length / 3
  const floors = nestContours(grooveRings)
  for (const p of floors) cap(p.outer, p.holes, floorZ, true)

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geom.computeVertexNormals()
  // Group 1 = engraving floor, so the preview can color it like the letters.
  geom.addGroup(0, floorStart, 0)
  geom.addGroup(floorStart, pos.length / 3 - floorStart, 1)
  return { plate: geom, letterShapes: floors.map(nestedToShape) }
}

function shapesBox(shapes: THREE.Shape[]): THREE.Box2 {
  const box = new THREE.Box2()
  for (const shape of shapes) for (const p of shape.getPoints(1)) box.expandByPoint(p)
  return box
}

interface PlateLayer {
  polys: MultiPolygon
  hole: Pair | null
}

// clipper-lib is CommonJS; bundlers expose it as the namespace, Node as `default`.
const ClipperLib = ((ClipperNs as unknown as { default?: typeof ClipperNs }).default ?? ClipperNs) as typeof ClipperNs
const CLIP_SCALE = 1000

function ringArea(r: Pair[]): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return a / 2
}

const closeRing = (r: Pair[]): Ring => [...r, [r[0][0], r[0][1]]]

/** Grows (or shrinks) a multipolygon by `delta` mm. */
function offsetMultiPolygon(mp: MultiPolygon, delta: number, fillHoles: boolean, round = true): MultiPolygon {
  const paths: ClipperNs.Paths = mp.flatMap((poly) =>
    poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ X: Math.round(x * CLIP_SCALE), Y: Math.round(y * CLIP_SCALE) }))),
  )
  const co = new ClipperLib.ClipperOffset(2, 0.01 * CLIP_SCALE)
  co.AddPaths(paths, round ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const out: ClipperNs.Paths = []
  co.Execute(out, delta * CLIP_SCALE)
  const rings = out
    .filter((p) => p.length >= 3)
    .map((p) => p.map((pt) => [pt.X / CLIP_SCALE, pt.Y / CLIP_SCALE] as Pair))
  const outers = rings.filter((r) => ringArea(r) > 0).map((r) => [closeRing(r)] as Polygon)
  if (!outers.length) return []
  let result = polygonClipping.union(outers[0], ...outers.slice(1))
  const holes = rings.filter((r) => ringArea(r) < 0).map((r) => [closeRing([...r].reverse())] as Polygon)
  if (!fillHoles && holes.length) result = polygonClipping.difference(result, ...holes)
  return result
}

function circlePolygon(cx: number, cy: number, r: number, segments: number): Polygon {
  const n = Math.max(24, segments * 4)
  const ring: Pair[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return [closeRing(ring)]
}

/** Adds a round tab with a keychain hole to the left of an outline-shaped plate. */
function addKeychainTab(mp: MultiPolygon, s: Settings, segments: number): PlateLayer {
  let lx = Infinity
  let ly = 0
  for (const poly of mp) for (const [x, y] of poly[0]) if (x < lx) [lx, ly] = [x, y]
  const r = s.holeDiameter / 2
  const wall = holeWall(s)
  const R = r + wall
  const cx = lx - r
  const bridgeH = R * 0.8
  const bridge: Polygon = [closeRing([[cx, ly - bridgeH], [lx + wall, ly - bridgeH], [lx + wall, ly + bridgeH], [cx, ly + bridgeH]])]
  const merged = polygonClipping.union(mp, circlePolygon(cx, ly, R, segments), bridge)
  return { polys: polygonClipping.difference(merged, circlePolygon(cx, ly, r, segments)), hole: [cx, ly] }
}

function plateShape(s: Settings, textBox: THREE.Box2): { shape: THREE.Shape; hole: Pair | null } {
  const pad = s.platePadding
  let x0 = textBox.min.x - pad
  const x1 = textBox.max.x + pad
  let y0 = textBox.min.y - pad
  let y1 = textBox.max.y + pad
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
  let hole: Pair | null = null
  if (s.hole) {
    const cx = s.plate === 'pill' ? x0 + Math.max(wall + holeR, h / 2) : x0 + wall + holeR
    const path = new THREE.Path()
    path.absarc(cx, (y0 + y1) / 2, holeR, 0, Math.PI * 2, true)
    shape.holes.push(path)
    hole = [cx, (y0 + y1) / 2]
  }
  return { shape, hole }
}

function plateLayer(s: Settings, letters: MultiPolygon, textBox: THREE.Box2, segments: number): PlateLayer {
  if (s.plate === 'outline' && letters.length) {
    const grown = offsetMultiPolygon(letters, Math.max(0.3, s.platePadding), true)
    if (grown.length) return s.hole ? addKeychainTab(grown, s, segments) : { polys: grown, hole: null }
  }
  const plate = s.plate === 'outline' ? 'rounded' : s.plate
  const { shape, hole } = plateShape({ ...s, plate }, textBox)
  return { polys: [shapeToPolygon(shape, segments)], hole }
}

function multiPolygonToShapes(mp: MultiPolygon): THREE.Shape[] {
  const toPts = (r: Ring) => cleanContour(r.map(([x, y]) => new THREE.Vector2(x, y)))
  return mp
    .map((poly) => poly.map(toPts).filter((r) => r.length >= 3))
    .filter((rings) => rings.length)
    .map(([outer, ...holes]) => nestedToShape({ outer, holes }))
}

function flatExtrude(shapes: THREE.Shape | THREE.Shape[], depth: number, curveSegments: number, z = 0) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, steps: 1, curveSegments, bevelEnabled: false })
  g.translate(0, 0, z)
  return g
}

export function buildModel(font: Font, s: Settings): ModelResult {
  const glyphShapes = layoutText(font, s)
  const allShapes = glyphShapes.flat()
  const hasPlate = s.plate !== 'none'
  const engraved = hasPlate && s.textStyle === 'engraved'
  const plateSegments = Math.max(12, s.quality * 3)

  const textBox = allShapes.length
    ? shapesBox(allShapes)
    : new THREE.Box2(new THREE.Vector2(-10, -5), new THREE.Vector2(10, 5))

  let text: THREE.BufferGeometry | null = null
  let plate: THREE.BufferGeometry | null = null
  let inlay: THREE.BufferGeometry | null = null
  let base2: THREE.BufferGeometry | null = null

  const glyphPolys = allShapes.map((sh) => shapeToPolygon(sh, 1)).filter((p) => p.length)
  const needsUnion = hasPlate && (engraved || s.plate === 'outline')
  const letters: MultiPolygon =
    needsUnion && glyphPolys.length ? polygonClipping.union(glyphPolys[0], ...glyphPolys.slice(1)) : []

  let layer: PlateLayer | null = null
  let plateZ = 0
  if (hasPlate) {
    const plateSettings = engraved ? { ...s, platePadding: Math.max(s.platePadding, 1) } : s
    layer = plateLayer(plateSettings, letters, textBox, plateSegments)
    if (s.secondLayer && s.secondLayerWidth > 0 && s.secondLayerThickness > 0) {
      let polys2 = offsetMultiPolygon(layer.polys, s.secondLayerWidth, false, s.plate !== 'rect')
      if (layer.hole) {
        polys2 = polygonClipping.difference(polys2, circlePolygon(layer.hole[0], layer.hole[1], s.holeDiameter / 2, plateSegments))
      }
      base2 = flatExtrude(multiPolygonToShapes(polys2), s.secondLayerThickness, 1)
      plateZ = s.secondLayerThickness
    }
  }

  if (engraved && layer) {
    const T = s.plateThickness
    const d = Math.max(0.2, Math.min(s.engraveDepth, T - 0.4))
    const floorZ = T - d
    const top = letters.length ? polygonClipping.difference(layer.polys, letters) : layer.polys
    const built = buildEngravedPlate(top, layer.polys, T, floorZ)
    plate = built.plate
    plate.translate(0, 0, plateZ)
    if (built.letterShapes.length) inlay = flatExtrude(built.letterShapes, d, 1, plateZ + floorZ)
  } else {
    const bevel = s.edge !== 'flat' && s.edgeSize > 0
    const maxBevel = Math.min(s.letterHeight * 0.06, s.textDepth / 2 - 0.05)
    const bt = bevel ? Math.max(0, Math.min(s.edgeSize, maxBevel)) : 0
    const useBevel = bt > 0.01
    const sink = hasPlate ? Math.max(bt, 0.05) : 0
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
      const base = hasPlate ? plateZ + s.plateThickness - sink : 0
      text?.translate(0, 0, base + (useBevel ? bt : 0))
    }
    if (layer) {
      plate = flatExtrude(multiPolygonToShapes(layer.polys), s.plateThickness, 1, plateZ)
      plate.clearGroups()
      plate.addGroup(0, Infinity, 0)
    }
  }

  const full = new THREE.Box3()
  for (const g of [text, plate, base2]) {
    if (!g) continue
    g.computeBoundingBox()
    full.union(g.boundingBox!)
  }
  const center = full.isEmpty() ? new THREE.Vector3() : full.getCenter(new THREE.Vector3())
  const minZ = full.isEmpty() ? 0 : full.min.z
  for (const g of [text, plate, inlay, base2]) {
    if (!g) continue
    g.translate(-center.x, -center.y, -minZ)
    g.computeBoundingBox()
    g.computeBoundingSphere()
  }
  const size = full.isEmpty() ? new THREE.Vector3() : full.getSize(new THREE.Vector3())
  const tri = (g: THREE.BufferGeometry | null) =>
    g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0
  return { text, plate, inlay, base2, size, triangles: tri(text) + tri(plate) + tri(base2) }
}
