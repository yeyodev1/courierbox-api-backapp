import { describe, expect, it } from 'vitest'
import { parseFecha } from './fecha'

// Filas reales del historial de TLMD2067A0092204, consultado el 22/09/2026.
const AHORA = new Date('2026-09-22T20:00:00Z')

describe('parseFecha', () => {
  it('lee las filas con AM/PM como MM/DD', () => {
    expect(parseFecha('09/11/2026 14:02 PM', AHORA)).toBe('2026-09-11T19:02:00.000Z')
    expect(parseFecha('09/16/2026 11:29 AM', AHORA)).toBe('2026-09-16T16:29:00.000Z')
  })

  it('lee las filas 24h con segundos como DD/MM', () => {
    expect(parseFecha('11/09/2026 19:07:37', AHORA)).toBe('2026-09-12T00:07:37.000Z')
  })

  it('respeta el componente mayor a 12 sin importar el formato', () => {
    expect(parseFecha('16/09/2026 11:29 AM', AHORA)).toBe('2026-09-16T16:29:00.000Z')
    expect(parseFecha('09/16/2026 19:07:37', AHORA)).toBe('2026-09-17T00:07:37.000Z')
  })

  it('invierte día y mes si la lectura cae en el futuro', () => {
    expect(parseFecha('09/11/2026 19:07:37', AHORA)).toBe('2026-09-12T00:07:37.000Z')
  })

  it('ancla la hora a Ecuador', () => {
    expect(parseFecha('09/11/2026 12:00 AM', AHORA)).toBe('2026-09-11T05:00:00.000Z')
  })

  it('devuelve null para vacío o basura', () => {
    expect(parseFecha('', AHORA)).toBeNull()
    expect(parseFecha(null, AHORA)).toBeNull()
    expect(parseFecha('sin fecha', AHORA)).toBeNull()
  })
})
