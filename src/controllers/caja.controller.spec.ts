import mongoose from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
  aggregate: vi.fn(),
  postFinancialMovement: vi.fn(),
}))

vi.mock('../services/financial-movement.service', () => ({
  postFinancialMovement: mocks.postFinancialMovement,
  reverseFinancialMovements: vi.fn(),
}))

// Ningún test de aquí sube un comprobante; el mock evita instanciar el cliente
// real de subidas al importar el controller.
vi.mock('../services/upload.service', () => ({
  uploadComprobante: vi.fn(),
}))

vi.mock('../models/index', () => ({
  models: {
    masterClientes: { findOne: mocks.findOne },
    cajaMovimientos: { create: mocks.create, aggregate: mocks.aggregate },
  },
}))

import { createCaja, resumenCaja } from './caja.controller'

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
}

describe('createCaja', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.postFinancialMovement.mockResolvedValue({})
  })

  it('persists a valid master client id directly', async () => {
    const clienteId = new mongoose.Types.ObjectId().toString()
    const movimiento = { _id: new mongoose.Types.ObjectId().toString() }
    mocks.create.mockResolvedValue(movimiento)

    const req = {
      body: {
        tipo: 'ingreso',
        categoria: 'Pago',
        monto: 12.5,
        clienteNombre: 'Diego Reyes',
        clienteId,
        descripcion: 'Ingreso test',
        referencia: 'REF-001',
        fecha: '2026-07-01',
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createCaja(req, res, vi.fn())

    expect(mocks.findOne).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: expect.any(mongoose.Types.ObjectId),
      clienteNombre: 'Diego Reyes',
    }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ movimiento })
  })

  it('resolves composite contacto identifiers into a master client id', async () => {
    const resolvedId = new mongoose.Types.ObjectId()
    mocks.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: resolvedId }),
    })
    const movimiento = { _id: new mongoose.Types.ObjectId().toString() }
    mocks.create.mockResolvedValue(movimiento)

    const req = {
      body: {
        tipo: 'ingreso',
        categoria: 'Pago',
        monto: 20,
        clienteNombre: 'diego reyes',
        clienteId: 'diego reyes|diegorele13@gmail.com|0995254965',
        descripcion: 'Ingreso con contacto',
        referencia: 'REF-002',
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createCaja(req, res, vi.fn())

    expect(mocks.findOne).toHaveBeenCalledWith(expect.objectContaining({
      nombreOficial: expect.any(RegExp),
      email: expect.any(RegExp),
      telefono: expect.any(RegExp),
    }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: resolvedId,
      clienteNombre: 'diego reyes',
    }))
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('resolves when email and phone are provided separately', async () => {
    const resolvedId = new mongoose.Types.ObjectId()
    mocks.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: resolvedId }),
    })
    const movimiento = { _id: new mongoose.Types.ObjectId().toString() }
    mocks.create.mockResolvedValue(movimiento)

    const req = {
      body: {
        tipo: 'ingreso',
        categoria: 'Pago',
        monto: 20,
        clienteNombre: 'diego reyes',
        clienteId: 'diego reyes',
        clienteEmail: 'diegorele13@gmail.com',
        clientePhone: '0995254965',
        descripcion: 'Ingreso con contacto',
        referencia: 'REF-004',
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createCaja(req, res, vi.fn())

    expect(mocks.findOne).toHaveBeenCalledWith(expect.objectContaining({
      nombreOficial: expect.any(RegExp),
      email: expect.any(RegExp),
      telefono: expect.any(RegExp),
    }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: resolvedId,
    }))
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('allows saving when composite identifier cannot be resolved', async () => {
    mocks.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    })
    const movimiento = { _id: new mongoose.Types.ObjectId().toString() }
    mocks.create.mockResolvedValue(movimiento)

    const req = {
      body: {
        tipo: 'ingreso',
        categoria: 'Pago',
        monto: 9,
        clienteNombre: 'Persona nueva',
        clienteId: 'persona nueva|new@example.com|0991112222',
        descripcion: 'Ingreso sin master',
        referencia: 'REF-003',
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createCaja(req, res, vi.fn())

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: undefined,
      clienteNombre: 'Persona nueva',
    }))
    expect(res.status).toHaveBeenCalledWith(201)
  })
})

describe('resumenCaja', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The aggregates resolve through Promise.all in a fixed order: period income,
   * period expenses, by category, by type, and the accumulated income and
   * expenses last.
   */
  function stubAggregates(rows: any[][]) {
    rows.forEach((value) => mocks.aggregate.mockResolvedValueOnce(value))
  }

  function matchOfCall(index: number) {
    return mocks.aggregate.mock.calls[index][0][0].$match
  }

  it('reports the balance for the whole history, not just the filtered range', async () => {
    // Junio dejó $500 en caja; en el mes filtrado sólo hubo un egreso de $32.
    stubAggregates([
      [],                                   // ingresos del periodo
      [{ total: 32, count: 1 }],            // egresos del periodo
      [{ _id: 'TRANSPORTE', total: 32, count: 1 }],
      [{ _id: 'egreso', total: 32, count: 1 }],
      [{ total: 500, count: 3 }],           // ingresos acumulados
      [{ total: 32, count: 1 }],            // egresos acumulados
    ])

    const req = { query: { desde: '2026-08-01', hasta: '2026-08-28' } } as any
    const res = makeRes() as any

    await resumenCaja(req, res, vi.fn())

    const body = res.json.mock.calls[0][0]
    expect(body.saldo).toBe(-32)
    expect(body.acumulado.saldo).toBe(468)
    expect(body.acumulado.hasta).toBe('2026-08-28')
  })

  it('ignores desde, tipo and categoria when accumulating the balance', async () => {
    stubAggregates([[], [], [], [], [], []])

    const req = {
      query: { desde: '2026-08-01', hasta: '2026-08-28', tipo: 'egreso', categoria: 'TRANSPORTE' },
    } as any
    await resumenCaja(req, makeRes() as any, vi.fn())

    const periodo = matchOfCall(0)
    expect(periodo.tipo).toBe('ingreso')
    expect(periodo.categoria).toBe('TRANSPORTE')
    expect(periodo.fecha.$gte).toEqual(new Date('2026-08-01'))

    const acumulado = matchOfCall(4)
    expect(acumulado.categoria).toBeUndefined()
    expect(acumulado.fecha.$gte).toBeUndefined()
    expect(acumulado.fecha.$lte).toBeInstanceOf(Date)
  })

  it('keeps porCategoria grouped by category and porTipo by movement type', async () => {
    stubAggregates([
      [{ total: 10, count: 1 }],
      [],
      [{ _id: 'VENTA', total: 10, count: 1 }],
      [{ _id: 'ingreso', total: 10, count: 1 }],
      [{ total: 10, count: 1 }],
      [],
    ])

    const res = makeRes() as any
    await resumenCaja({ query: {} } as any, res, vi.fn())

    const body = res.json.mock.calls[0][0]
    expect(body.porCategoria).toEqual([{ _id: 'VENTA', total: 10, count: 1 }])
    expect(body.porTipo).toEqual([{ _id: 'ingreso', total: 10, count: 1 }])
  })

  it('returns zeroes instead of NaN when the ledger is empty', async () => {
    stubAggregates([[], [], [], [], [], []])

    const res = makeRes() as any
    await resumenCaja({ query: {} } as any, res, vi.fn())

    const body = res.json.mock.calls[0][0]
    expect(body.saldo).toBe(0)
    expect(body.acumulado.saldo).toBe(0)
    expect(body.acumulado.ingresos).toEqual({ total: 0, count: 0 })
    expect(body.acumulado.hasta).toBeNull()
  })
})
