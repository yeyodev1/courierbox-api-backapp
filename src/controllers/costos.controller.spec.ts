import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  findByIdAndDelete: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  aggregate: vi.fn(),
  proveedorFindOne: vi.fn(),
  proveedorCreate: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
  uploadGastoFactura: vi.fn(),
  postFinancialMovement: vi.fn(),
  reverseFinancialMovements: vi.fn(),
}))

vi.mock('../services/financial-movement.service', () => ({
  postFinancialMovement: mocks.postFinancialMovement,
  reverseFinancialMovements: mocks.reverseFinancialMovements,
}))

vi.mock('../models/index', () => ({
  models: {
    gastos: {
      create: mocks.create,
      findById: mocks.findById,
      findByIdAndDelete: mocks.findByIdAndDelete,
      findByIdAndUpdate: mocks.findByIdAndUpdate,
      aggregate: mocks.aggregate,
    },
    proveedores: {
      findOne: mocks.proveedorFindOne,
      create: mocks.proveedorCreate,
    },
  },
}))

vi.mock('../services/upload.service', () => ({
  deleteCloudinaryAsset: mocks.deleteCloudinaryAsset,
  uploadGastoFactura: mocks.uploadGastoFactura,
  extractCloudinaryAssetRef: (url: string) => {
    const match = url.match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./?#]+)?(?:[?#].*)?$/i)
    return match
      ? { resourceType: match[1].toLowerCase(), publicId: match[2] }
      : null
  },
}))

import { createGasto, deleteGasto, resumenGastos, updateGasto, uploadGastoArchivo } from './costos.controller'

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
}

describe('costos.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.postFinancialMovement.mockResolvedValue({})
    mocks.reverseFinancialMovements.mockResolvedValue(undefined)
    mocks.proveedorFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
  })

  it('calcula valorTotal desde libras por valorPorLibra al crear un gasto', async () => {
    mocks.create.mockResolvedValue({ _id: 'g1', valorTotal: 32.5 })

    const req = {
      body: {
        tipo: 'logistico',
        categoria: 'Flete',
        monto: 10,
        descripcion: 'Factura por libras',
        proveedor: '',
        libras: 5,
        valorPorLibra: 6.5,
        valorTotal: 10,
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createGasto(req, res, vi.fn())

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      libras: 5,
      valorPorLibra: 6.5,
      valorTotal: 32.5,
    }))
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('usa monto como fallback al crear un gasto sin cálculo por libras', async () => {
    mocks.create.mockResolvedValue({ _id: 'g1', valorTotal: 42 })

    const req = {
      body: {
        tipo: 'operacional',
        categoria: 'Renta',
        monto: 42,
        descripcion: 'Pago mensual',
        proveedor: '',
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await createGasto(req, res, vi.fn())

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      monto: 42,
      libras: 0,
      valorPorLibra: 0,
      valorTotal: 42,
    }))
  })

  it('recalcula valorTotal al actualizar libras y valorPorLibra juntos', async () => {
    const lean = vi.fn().mockResolvedValue({ _id: 'g1', valorTotal: 19.9 })
    const populate = vi.fn().mockReturnThis()
    mocks.findByIdAndUpdate.mockReturnValue({ populate, lean })

    const req = {
      params: { id: 'g1' },
      body: { libras: '10', valorPorLibra: '1.99', valorTotal: 5 },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await updateGasto(req, res, vi.fn())

    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith('g1', expect.objectContaining({
      $set: expect.objectContaining({
        libras: 10,
        valorPorLibra: 1.99,
        valorTotal: 19.9,
      }),
    }), { new: true, runValidators: true })
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('no cambia valorTotal en actualizaciones parciales por libras', async () => {
    const lean = vi.fn().mockResolvedValue({ _id: 'g1' })
    const populate = vi.fn().mockReturnThis()
    mocks.findByIdAndUpdate.mockReturnValue({ populate, lean })

    const req = {
      params: { id: 'g1' },
      body: { libras: '8' },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await updateGasto(req, res, vi.fn())

    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith('g1', expect.objectContaining({
      $set: expect.not.objectContaining({ valorTotal: expect.any(Number) }),
    }), { new: true, runValidators: true })
  })

  it('resume gastos usando valorTotal cuando existe y monto como fallback', async () => {
    mocks.aggregate
      .mockResolvedValueOnce([{ total: 32.5, facturas: 1, libras: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const req = { query: {} } as any
    const res = makeRes() as any

    await resumenGastos(req, res, vi.fn())

    expect(mocks.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $group: expect.objectContaining({
          total: { $sum: { $cond: [{ $gt: ['$valorTotal', 0] }, '$valorTotal', '$monto'] } },
        }),
      }),
    ]))
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('borra el asset de Cloudinary antes de eliminar un gasto', async () => {
    mocks.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'g1',
        comprobanteUrl: 'https://res.cloudinary.com/demo/image/upload/v1/courierbox/gastos/facturas/factura-1.pdf',
        comprobantePublicId: 'courierbox/gastos/facturas/factura-1',
        comprobanteResourceType: 'image',
      }),
    })
    mocks.findByIdAndDelete.mockReturnValue({ lean: vi.fn().mockResolvedValue({}) })

    const req = { params: { id: 'g1' }, user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' } } as any
    const res = makeRes() as any

    await deleteGasto(req, res, vi.fn())

    expect(mocks.deleteCloudinaryAsset).toHaveBeenCalledWith({
      publicId: 'courierbox/gastos/facturas/factura-1',
      resourceType: 'image',
    })
    expect(mocks.findByIdAndDelete).toHaveBeenCalledWith('g1')
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('usa la URL para compatibilidad con gastos antiguos sin publicId guardado', async () => {
    mocks.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'g2',
        comprobanteUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/courierbox/gastos/facturas/factura-legacy.pdf',
      }),
    })
    mocks.findByIdAndDelete.mockReturnValue({ lean: vi.fn().mockResolvedValue({}) })

    const req = { params: { id: 'g2' }, user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' } } as any
    const res = makeRes() as any

    await deleteGasto(req, res, vi.fn())

    expect(mocks.deleteCloudinaryAsset).toHaveBeenCalledWith({
      publicId: 'courierbox/gastos/facturas/factura-legacy',
      resourceType: 'raw',
    })
  })

  it('persiste publicId y resourceType al subir comprobante', async () => {
    mocks.uploadGastoFactura.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/courierbox/gastos/facturas/factura-2.jpg',
      publicId: 'courierbox/gastos/facturas/factura-2',
      resourceType: 'image',
    })
    mocks.findByIdAndUpdate.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: 'g1' }),
    })

    const req = {
      params: { id: 'g1' },
      file: { buffer: Buffer.from('fake') },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any
    const res = makeRes() as any

    await uploadGastoArchivo(req, res, vi.fn())

    expect(mocks.findByIdAndUpdate).toHaveBeenCalledWith('g1', expect.objectContaining({
      $set: expect.objectContaining({
        comprobanteUrl: 'https://res.cloudinary.com/demo/image/upload/v1/courierbox/gastos/facturas/factura-2.jpg',
        comprobantePublicId: 'courierbox/gastos/facturas/factura-2',
        comprobanteResourceType: 'image',
      }),
    }), { new: true })
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
