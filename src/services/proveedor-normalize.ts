export function normalizeProveedorNombre(nombre: string): string {
  return String(nombre || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function canonicalProveedorNombre(nombre: string): string {
  return String(nombre || '')
    .trim()
    .replace(/\s+/g, ' ')
}
