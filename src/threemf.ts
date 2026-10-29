import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { strToU8, zipSync } from 'fflate'

export interface ColoredPart {
  name: string
  color: string
  geometry: THREE.BufferGeometry
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (n: number) => String(Math.round(n * 1e4) / 1e4)

function meshXml(geometry: THREE.BufferGeometry): string {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', geometry.getAttribute('position'))
  if (geometry.index) g.setIndex(geometry.index)
  const merged = mergeVertices(g, 1e-5)
  const pos = merged.getAttribute('position')
  const index = merged.index!
  const vertices: string[] = []
  for (let i = 0; i < pos.count; i++) {
    vertices.push(`<vertex x="${num(pos.getX(i))}" y="${num(pos.getY(i))}" z="${num(pos.getZ(i))}"/>`)
  }
  const triangles: string[] = []
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2)
    if (a === b || b === c || a === c) continue
    triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
  }
  merged.dispose()
  g.dispose()
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`
}

/**
 * Builds a 3MF with one object made of colored parts. Colors are stored as core-spec
 * base materials; Metadata/model_settings.config assigns each part its own filament
 * slot so Orca/Bambu Studio keep the parts together and pre-assign filaments 1, 2, 3...
 */
export function build3mf(parts: ColoredPart[], name: string): Uint8Array {
  const materials = parts
    .map((p) => `<base name="${esc(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`)
    .join('')
  const groupId = 1
  const objectId = parts.length + 2
  const meshes = parts
    .map((p, i) => `<object id="${i + 2}" type="model" name="${esc(p.name)}" pid="${groupId}" pindex="${i}">${meshXml(p.geometry)}</object>`)
    .join('\n')
  const components = parts.map((_, i) => `<component objectid="${i + 2}"/>`).join('')
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(name)}</metadata>
<metadata name="Application">Text to STL</metadata>
<resources>
<basematerials id="${groupId}">${materials}</basematerials>
${meshes}
<object id="${objectId}" type="model" name="${esc(name)}"><components>${components}</components></object>
</resources>
<build><item objectid="${objectId}"/></build>
</model>`

  const config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${objectId}">
    <metadata key="name" value="${esc(name)}"/>
    <metadata key="extruder" value="1"/>
${parts
  .map(
    (p, i) => `    <part id="${i + 2}" subtype="normal_part">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="extruder" value="${i + 1}"/>
    </part>`,
  )
  .join('\n')}
  </object>
</config>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="text/xml"/>
</Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(config),
    },
    { level: 6 },
  )
}
