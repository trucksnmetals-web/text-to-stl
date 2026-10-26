import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import opentype, { type Font } from 'opentype.js'
import { buildModel, type Settings } from './geometry.ts'
import { CUSTOM_FONT_ID, FONTS, fontUrl } from './fonts.ts'

const STORAGE_KEY = 'text-to-stl:settings:v1'

const DEFAULTS: Settings = {
  text: 'Hello',
  fontId: 'poppins',
  letterHeight: 20,
  textDepth: 4,
  letterSpacing: 0,
  lineSpacing: 1.4,
  align: 'center',
  edge: 'flat',
  edgeSize: 0.6,
  plate: 'rounded',
  textStyle: 'raised',
  engraveDepth: 1,
  plateThickness: 3,
  platePadding: 5,
  cornerRadius: 4,
  hole: false,
  holeDiameter: 5,
  quality: 8,
  textColor: '#ff7a1a',
  plateColor: '#334155',
}

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const s = { ...DEFAULTS, ...saved }
    if (s.fontId === CUSTOM_FONT_ID) s.fontId = DEFAULTS.fontId
    return s
  } catch {
    return { ...DEFAULTS }
  }
}

const settings = loadSettings()

interface NumberField {
  key: keyof Settings
  label: string
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
}

const numberRow = (f: NumberField) => `
  <label class="row" data-row="${f.key}">
    <span class="row-label">${f.label}${f.hint ? `<small>${f.hint}</small>` : ''}</span>
    <span class="row-input">
      <input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />
      <span class="num"><input type="number" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />${f.unit ? `<em>${f.unit}</em>` : ''}</span>
    </span>
  </label>`

const segmented = (key: keyof Settings, options: [string, string][]) => `
  <div class="segmented" data-seg="${key}">
    ${options.map(([v, l]) => `<button type="button" data-value="${v}">${l}</button>`).join('')}
  </div>`

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<aside class="panel">
  <header class="brand">
    <img src="./favicon.svg" alt="" width="32" height="32" />
    <div>
      <h1>Text to STL</h1>
      <p>Type it, style it, print it.</p>
    </div>
  </header>

  <section class="card">
    <h2>1. Your text</h2>
    <textarea data-key="text" rows="3" placeholder="Type your text here" spellcheck="false"></textarea>
    <div class="row-label">Alignment (for several lines)</div>
    ${segmented('align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])}
  </section>

  <section class="card">
    <h2>2. Font</h2>
    <div class="fonts" id="fonts"></div>
    <label class="upload">
      <input type="file" id="font-upload" accept=".ttf,.otf,font/ttf,font/otf" />
      <span>Upload your own font (.ttf or .otf)</span>
    </label>
    <div class="custom-font" id="custom-font" hidden></div>
  </section>

  <section class="card">
    <h2>3. Size (millimetres)</h2>
    ${numberRow({ key: 'letterHeight', label: 'Letter height', hint: 'Height of a capital letter', min: 3, max: 200, step: 0.5, unit: 'mm' })}
    ${numberRow({ key: 'textDepth', label: 'Letter thickness', hint: 'How tall the letters stand up', min: 0.4, max: 50, step: 0.2, unit: 'mm' })}
    ${numberRow({ key: 'letterSpacing', label: 'Letter spacing', hint: 'Extra space between letters', min: -10, max: 30, step: 0.1, unit: 'mm' })}
    ${numberRow({ key: 'lineSpacing', label: 'Line spacing', hint: 'Times the letter height', min: 0.8, max: 3, step: 0.05, unit: '×' })}
  </section>

  <section class="card" data-row="edgeCard">
    <h2>4. Letter edges</h2>
    ${segmented('edge', [['flat', 'Flat'], ['chamfer', 'Chamfer'], ['round', 'Rounded']])}
    ${numberRow({ key: 'edgeSize', label: 'Edge size', min: 0.1, max: 3, step: 0.1, unit: 'mm' })}
  </section>

  <section class="card">
    <h2>5. Base plate</h2>
    ${segmented('plate', [['none', 'None'], ['rect', 'Square'], ['rounded', 'Rounded'], ['pill', 'Pill']])}
    <p class="note" data-note="no-plate">Without a plate, letters that don't touch will print as separate pieces.</p>
    <div data-row="textStyle">
      <div class="row-label">Text on plate</div>
      ${segmented('textStyle', [['raised', 'Raised (embossed)'], ['engraved', 'Cut in (engraved)']])}
    </div>
    ${numberRow({ key: 'engraveDepth', label: 'Engrave depth', hint: 'How deep the letters are cut in', min: 0.2, max: 10, step: 0.1, unit: 'mm' })}
    ${numberRow({ key: 'plateThickness', label: 'Plate thickness', min: 0.6, max: 20, step: 0.2, unit: 'mm' })}
    ${numberRow({ key: 'platePadding', label: 'Border around text', min: 0, max: 40, step: 0.5, unit: 'mm' })}
    ${numberRow({ key: 'cornerRadius', label: 'Corner roundness', min: 0, max: 40, step: 0.5, unit: 'mm' })}
    <label class="check" data-row="hole">
      <input type="checkbox" data-key="hole" />
      <span>Add keychain hole</span>
    </label>
    ${numberRow({ key: 'holeDiameter', label: 'Hole diameter', min: 2, max: 20, step: 0.5, unit: 'mm' })}
  </section>

  <section class="card">
    <h2>6. Look &amp; quality</h2>
    <div class="row-label">Curve smoothness</div>
    ${segmented('quality', [['4', 'Low'], ['8', 'Medium'], ['16', 'High']])}
    <div class="colors">
      <label><input type="color" data-key="textColor" /> Letter color</label>
      <label data-row="plateColor"><input type="color" data-key="plateColor" /> Plate color</label>
    </div>
    <p class="note">Colors are only for the preview. STL files don't store color.</p>
    <button type="button" class="link" id="reset">Reset all settings</button>
  </section>
</aside>

<main class="viewer">
  <div id="canvas-wrap"></div>
  <div class="hud">
    <div class="stats" id="stats">Loading font…</div>
    <button type="button" class="ghost" id="fit">Fit view</button>
  </div>
  <div class="downloads">
    <button type="button" class="primary" id="download">Download STL</button>
    <button type="button" class="secondary" id="download-split" title="Two files that line up, for printing letters and plate in different colors">Separate letters &amp; plate (2-color)</button>
  </div>
  <div class="error" id="error" hidden></div>
</main>
`

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

// ---------- Fonts ----------
const fontCache = new Map<string, Promise<Font>>()
let customFont: { name: string; font: Font } | null = null

function loadFont(id: string): Promise<Font> {
  if (id === CUSTOM_FONT_ID && customFont) return Promise.resolve(customFont.font)
  const opt = FONTS.find((f) => f.id === id) ?? FONTS[0]
  let p = fontCache.get(opt.id)
  if (!p) {
    p = fetch(fontUrl(opt))
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load font ${opt.name}`)
        return r.arrayBuffer()
      })
      .then((buf) => opentype.parse(buf))
    p.catch(() => fontCache.delete(opt.id))
    fontCache.set(opt.id, p)
  }
  return p
}

const fontsEl = $('#fonts')
fontsEl.innerHTML = FONTS.map(
  (f) => `<button type="button" class="font" data-font="${f.id}" title="${f.name}">
    <span class="sample" style="font-family:'tts-${f.id}', sans-serif">Abc</span>
    <span class="font-name">${f.name}</span>
  </button>`,
).join('')
for (const f of FONTS) {
  const face = new FontFace(`tts-${f.id}`, `url(${fontUrl(f)})`)
  face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {})
}

$<HTMLInputElement>('#font-upload').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const font = opentype.parse(await file.arrayBuffer())
    customFont = { name: file.name.replace(/\.(ttf|otf)$/i, ''), font }
    const box = $('#custom-font')
    box.hidden = false
    box.innerHTML = `<button type="button" class="font wide" data-font="${CUSTOM_FONT_ID}">
      <span class="font-name">Your font: ${escapeHtml(customFont.name)}</span></button>`
    settings.fontId = CUSTOM_FONT_ID
    syncUi()
    schedule()
  } catch {
    showError('That font file could not be read. Please use a .ttf or .otf file.')
  }
})

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-font]')
  if (!btn) return
  settings.fontId = btn.dataset.font!
  syncUi()
  schedule()
})

// ---------- Form binding ----------
function syncUi() {
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-key]').forEach((el) => {
    const key = el.dataset.key as keyof Settings
    const v = settings[key]
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
    else if (el !== document.activeElement) el.value = String(v)
  })
  document.querySelectorAll<HTMLElement>('[data-seg]').forEach((seg) => {
    const key = seg.dataset.seg as keyof Settings
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === String(settings[key]))
    })
  })
  document.querySelectorAll<HTMLButtonElement>('button[data-font]').forEach((b) => {
    b.classList.toggle('active', b.dataset.font === settings.fontId)
  })
  const hasPlate = settings.plate !== 'none'
  const show = (key: string, on: boolean) =>
    document.querySelectorAll<HTMLElement>(`[data-row="${key}"]`).forEach((r) => r.classList.toggle('hidden', !on))
  show('plateThickness', hasPlate)
  show('platePadding', hasPlate)
  show('cornerRadius', settings.plate === 'rounded')
  show('hole', hasPlate)
  show('holeDiameter', hasPlate && settings.hole)
  show('plateColor', hasPlate)
  const engraved = hasPlate && settings.textStyle === 'engraved'
  show('textStyle', hasPlate)
  show('engraveDepth', engraved)
  show('textDepth', !engraved)
  show('edgeCard', !engraved)
  show('edgeSize', settings.edge !== 'flat')
  $('[data-note="no-plate"]').classList.toggle('hidden', hasPlate)
  const split = $('#download-split')
  split.classList.toggle('hidden', !hasPlate)
  split.innerHTML = engraved ? 'Separate plate &amp; letter inlay (2-color)' : 'Separate letters &amp; plate (2-color)'
}

function setValue(key: keyof Settings, raw: string | boolean) {
  const current = DEFAULTS[key]
  let value: unknown = raw
  if (typeof current === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    value = n
  }
  ;(settings as unknown as Record<string, unknown>)[key] = value
}

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement
  const key = el.dataset?.key as keyof Settings | undefined
  if (!key) return
  if (el.type === 'number' && el.value === '') return
  setValue(key, el.type === 'checkbox' ? el.checked : el.value)
  syncUi()
  schedule()
})

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-seg] button')
  if (!btn) return
  const key = btn.closest<HTMLElement>('[data-seg]')!.dataset.seg as keyof Settings
  setValue(key, btn.dataset.value!)
  syncUi()
  schedule()
})

$('#reset').addEventListener('click', () => {
  Object.assign(settings, DEFAULTS)
  syncUi()
  schedule()
})

// ---------- 3D scene ----------
const wrap = $('#canvas-wrap')
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
wrap.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#e9edf2')
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000)
camera.up.set(0, 0, 1)
camera.position.set(0, -120, 110)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.HemisphereLight('#ffffff', '#8792a2', 1.6))
const sun = new THREE.DirectionalLight('#ffffff', 2.2)
sun.position.set(-60, -100, 160)
scene.add(sun)
const fill = new THREE.DirectionalLight('#ffffff', 0.6)
fill.position.set(80, 60, 40)
scene.add(fill)

const grid = new THREE.GridHelper(300, 30, '#9aa4b2', '#c9d0d9')
grid.rotation.x = Math.PI / 2
grid.position.z = -0.01
scene.add(grid)

const textMat = new THREE.MeshStandardMaterial({ color: settings.textColor, roughness: 0.55, metalness: 0.05 })
const plateMat = new THREE.MeshStandardMaterial({ color: settings.plateColor, roughness: 0.7, metalness: 0.05 })
const textMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMat)
const plateMesh = new THREE.Mesh(new THREE.BufferGeometry(), [plateMat, textMat])
const inlayMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMat)
scene.add(textMesh, plateMesh)

function resize() {
  const { clientWidth: w, clientHeight: h } = wrap
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(wrap)
resize()

let fittedRadius = 0
function fitView(force = false) {
  const box = new THREE.Box3()
  if (textMesh.visible) box.expandByObject(textMesh)
  if (plateMesh.visible) box.expandByObject(plateMesh)
  if (box.isEmpty()) return
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  if (!force && fittedRadius && Math.abs(sphere.radius - fittedRadius) / fittedRadius < 0.15) return
  fittedRadius = sphere.radius
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const fitFov = camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * camera.aspect) : fov
  const dist = (sphere.radius / Math.sin(fitFov / 2)) * 1.1
  const dir = force
    ? new THREE.Vector3(0, -0.75, 1).normalize()
    : camera.position.clone().sub(controls.target).normalize()
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).addScaledVector(dir, dist)
  const gridSize = Math.max(300, Math.ceil((sphere.radius * 3) / 100) * 100)
  grid.scale.setScalar(gridSize / 300)
}
$('#fit').addEventListener('click', () => fitView(true))

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})

// ---------- Build ----------
let timer: number | undefined
let buildId = 0
let firstBuild = true

function schedule() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  textMat.color.set(settings.textColor)
  plateMat.color.set(settings.plateColor)
  window.clearTimeout(timer)
  timer = window.setTimeout(rebuild, 120)
}

function showError(msg: string | null) {
  const el = $('#error')
  el.hidden = !msg
  el.textContent = msg ?? ''
}

async function rebuild() {
  const id = ++buildId
  let font: Font
  try {
    font = await loadFont(settings.fontId)
  } catch (err) {
    showError((err as Error).message)
    return
  }
  if (id !== buildId) return
  try {
    const model = buildModel(font, settings)
    const assign = (mesh: THREE.Mesh, geom: THREE.BufferGeometry | null) => {
      mesh.geometry.dispose()
      mesh.geometry = geom ?? new THREE.BufferGeometry()
      mesh.visible = Boolean(geom)
    }
    assign(textMesh, model.text)
    assign(plateMesh, model.plate)
    assign(inlayMesh, model.inlay)
    const { x, y, z } = model.size
    $('#stats').innerHTML = model.text || model.plate
      ? `<strong>${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm</strong><span>width × depth × height · ${model.triangles.toLocaleString()} triangles</span>`
      : 'Type some text to get started'
    showError(null)
    fitView(firstBuild)
    firstBuild = false
  } catch (err) {
    console.error(err)
    showError('Something went wrong building this text. Try a different font or setting.')
  }
}

// ---------- Export ----------
function fileBase() {
  const slug = settings.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'text'
}

function downloadStl(meshes: THREE.Mesh[], name: string) {
  const group = new THREE.Group()
  for (const m of meshes) {
    if (m.visible && m.geometry.getAttribute('position')) group.add(new THREE.Mesh(m.geometry))
  }
  if (!group.children.length) {
    showError('Nothing to download yet. Type some text first.')
    return
  }
  group.updateMatrixWorld(true)
  const data = new STLExporter().parse(group, { binary: true }) as DataView
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.stl`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

$('#download').addEventListener('click', () => downloadStl([textMesh, plateMesh], fileBase()))
$('#download-split').addEventListener('click', () => {
  const engraved = inlayMesh.visible && !textMesh.visible
  downloadStl([engraved ? inlayMesh : textMesh], `${fileBase()}-${engraved ? 'inlay' : 'letters'}`)
  setTimeout(() => downloadStl([plateMesh], `${fileBase()}-plate`), 400)
})

syncUi()
schedule()
