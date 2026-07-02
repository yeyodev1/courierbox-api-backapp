import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByIdAndDelete: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
  uploadGastoFactura: vi.fn(),
}))

vi.mock('../models/index', () => ({
  models: {
    gastos: {
      findById: mocks.findById,
      findByIdAndDelete: mocks.findByIdAndDelete,
      findByIdAndUpdate: mocks.findByIdAndUpdate,
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

import { deleteGasto, uploadGastoArchivo } from './costos.controller'

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
}

describe('costos.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const req = { params: { id: 'g1' } } as any
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

    const req = { params: { id: 'g2' } } as any
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
