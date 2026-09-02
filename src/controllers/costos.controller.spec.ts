import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  findByIdAndDelete: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  aggregate: vi.fn(),
  find: vi.fn(),
  countDocuments: vi.fn(),
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
      find: mocks.find,
      countDocuments: mocks.countDocuments,
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

import { createGasto, deleteGasto, listGastos, resumenGastos, updateGasto, uploadGastoArchivo } from './costos.controller'

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

/**
 * Cost Centre splits the ledger into general expenses, shipping expenses and
 * receptions. The split is by weight, not by a migration, so expenses filed
 * before the split still land in the right section.
 */
describe('costos.controller · secciones del centro de costos', () => {
  function mockList() {
    const chain = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    }
    mocks.find.mockReturnValue(chain)
    mocks.countDocuments.mockResolvedValue(0)
    return chain
  }

  async function listWith(query: Record<string, unknown>) {
    mockList()
    await listGastos({ query, user: { userId: 'u1', role: 'admin' } } as any, makeRes() as any, vi.fn())
    return mocks.find.mock.calls[0][0]
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lleva a recepciones todo lo que trae libras, aunque se haya guardado como logistico', async () => {
    expect(await listWith({ seccion: 'recepciones' })).toEqual({
      $or: [{ tipo: 'recepcion' }, { libras: { $gt: 0 } }],
    })
  })

  it('deja fuera de gastos generales lo que ya cuenta como recepción', async () => {
    expect(await listWith({ seccion: 'generales' })).toEqual({
      tipo: { $in: ['operacional', 'logistico'] },
      libras: { $not: { $gt: 0 } },
    })
  })

  it('restringe la sección de envíos a su propio tipo', async () => {
    expect(await listWith({ seccion: 'envios' })).toEqual({ tipo: 'envio' })
  })

  it('no filtra nada cuando no se pide una sección', async () => {
    expect(await listWith({})).toEqual({})
  })

  it('ignora una sección que no existe en vez de devolver una lista vacía', async () => {
    expect(await listWith({ seccion: 'inventada' })).toEqual({})
  })

  it('combina la sección con el rango de fechas', async () => {
    const query = await listWith({ seccion: 'envios', desde: '2026-08-01', hasta: '2026-08-31' })
    expect(query.tipo).toBe('envio')
    expect(query.fecha.$gte.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(query.fecha.$lte.toISOString()).toBe('2026-08-31T23:59:59.999Z')
  })
})

describe('costos.controller · recepciones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.postFinancialMovement.mockResolvedValue({})
    mocks.proveedorFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
  })

  it('guarda el número de paquetes junto con las libras', async () => {
    mocks.create.mockResolvedValue({ _id: 'g1', valorTotal: 379.2, monto: 379.2, fecha: new Date() })
    const res = makeRes() as any

    await createGasto({
      body: {
        tipo: 'recepcion',
        categoria: 'IMPORTACIONES',
        monto: 379.2,
        descripcion: 'Carga TMA',
        libras: 126.4,
        valorPorLibra: 3,
        numeroPaquetes: 58,
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any, res, vi.fn())

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'recepcion',
      libras: 126.4,
      valorPorLibra: 3,
      numeroPaquetes: 58,
      valorTotal: 379.2,
    }))
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('rechaza una recepción sin valor por libra, que es lo único que la hace una recepción', async () => {
    const res = makeRes() as any

    await createGasto({
      body: {
        tipo: 'recepcion',
        categoria: 'IMPORTACIONES',
        monto: 367.82,
        descripcion: 'Carga TMA',
        libras: 126.4,
      },
      user: { userId: 'user-1', email: 'admin@example.com', role: 'admin' },
    } as any, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('deriva el costo por libra de los totales, no del promedio de cada registro', async () => {
    // 100 lb a $2 y 10 lb a $10: el promedio simple daría $6, el real es $2.72.
    mocks.aggregate.mockResolvedValue([])
    mocks.aggregate.mockResolvedValueOnce([{ _id: null, total: 300, facturas: 2, libras: 110, paquetes: 12 }])
    const res = makeRes() as any

    await resumenGastos({ query: { seccion: 'recepciones' } } as any, res, vi.fn())

    const { resumen } = res.json.mock.calls[0][0]
    expect(resumen.total.costoPorLibra).toBeCloseTo(2.7273, 4)
    expect(resumen.total.paquetes).toBe(12)
  })

  it('no divide por cero cuando el período no tuvo libras', async () => {
    mocks.aggregate.mockResolvedValue([])
    mocks.aggregate.mockResolvedValueOnce([{ _id: null, total: 500, facturas: 3, libras: 0, paquetes: 0 }])
    const res = makeRes() as any

    await resumenGastos({ query: {} } as any, res, vi.fn())

    expect(res.json.mock.calls[0][0].resumen.total.costoPorLibra).toBe(0)
  })
})
