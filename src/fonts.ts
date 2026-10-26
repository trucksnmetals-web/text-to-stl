export interface FontOption {
  id: string
  name: string
  file: string
  style: string
}

export const FONTS: FontOption[] = [
  { id: 'poppins', name: 'Poppins Bold', file: 'Poppins-Bold.ttf', style: 'Clean' },
  { id: 'archivo', name: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', style: 'Heavy' },
  { id: 'anton', name: 'Anton', file: 'Anton-Regular.ttf', style: 'Tall' },
  { id: 'bebas', name: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', style: 'Tall' },
  { id: 'alfa', name: 'Alfa Slab One', file: 'AlfaSlabOne-Regular.ttf', style: 'Slab' },
  { id: 'rubikmono', name: 'Rubik Mono One', file: 'RubikMonoOne-Regular.ttf', style: 'Wide' },
  { id: 'righteous', name: 'Righteous', file: 'Righteous-Regular.ttf', style: 'Retro' },
  { id: 'blackops', name: 'Black Ops One', file: 'BlackOpsOne-Regular.ttf', style: 'Military' },
  { id: 'allerta', name: 'Allerta Stencil', file: 'AllertaStencil-Regular.ttf', style: 'Stencil' },
  { id: 'stardos', name: 'Stardos Stencil', file: 'StardosStencil-Bold.ttf', style: 'Stencil' },
  { id: 'bangers', name: 'Bangers', file: 'Bangers-Regular.ttf', style: 'Comic' },
  { id: 'luckiest', name: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', style: 'Fun' },
  { id: 'marker', name: 'Permanent Marker', file: 'PermanentMarker-Regular.ttf', style: 'Handwritten' },
  { id: 'pacifico', name: 'Pacifico', file: 'Pacifico-Regular.ttf', style: 'Script' },
  { id: 'lobster', name: 'Lobster', file: 'Lobster-Regular.ttf', style: 'Script' },
  { id: 'greatvibes', name: 'Great Vibes', file: 'GreatVibes-Regular.ttf', style: 'Script' },
]

export const CUSTOM_FONT_ID = 'custom'

export function fontUrl(f: FontOption): string {
  return `${import.meta.env.BASE_URL}fonts/${f.file}`
}
