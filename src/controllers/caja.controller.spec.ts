import mongoose from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
}))

vi.mock('../models/index', () => ({
  models: {
    masterClientes: { findOne: mocks.findOne },
    cajaMovimientos: { create: mocks.create },
  },
}))

import { createCaja } from './caja.controller'

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
}

describe('createCaja', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
