import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { postFinancialMovement, reverseFinancialMovements } from "../services/financial-movement.service";
import { deleteCloudinaryAsset, extractCloudinaryAssetRef, uploadGastoFactura } from "../services/upload.service";
import { canonicalProveedorNombre, normalizeProveedorNombre } from "../services/proveedor-normalize";
import { endOfCalendarDate, toCalendarDate, todayAsCalendarDate } from "../utils/calendar-date";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateValorTotal(libras: unknown, valorPorLibra: unknown, fallback: unknown): number {
  const librasNumber = toNumber(libras);
  const valorPorLibraNumber = toNumber(valorPorLibra);
  if (librasNumber > 0 && valorPorLibraNumber > 0) {
    return Number((librasNumber * valorPorLibraNumber).toFixed(2));
  }
  return toNumber(fallback);
}

const gastoTotalExpression = {
  $cond: [{ $gt: ["$valorTotal", 0] }, "$valorTotal", "$monto"],
};

async function resolveProveedor(proveedor?: string) {
  const input = canonicalProveedorNombre(proveedor || "");
  if (!input) return null;

  const normalized = normalizeProveedorNombre(input);
  const existing = await models.proveedores.findOne({ nombreNormalizado: normalized }).lean();
  if (existing) return existing;

  const created = await models.proveedores.create({
    nombre: input,
    nombreNormalizado: normalized,
    tipo: "",
    pais: "",
    ciudad: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
  });

  return created.toObject();
}

/**
 * Cost Centre splits the ledger three ways: general expenses, shipping expenses,
 * and receptions — the cargo Courier Box pays for by the pound. What separates a
 * reception is that it carries weight, so the split is by weight rather than by a
 * migration: every expense filed before the split still lands in the section it
 * belongs to, and nothing had to be rewritten to get there.
 *
 * `logistico` predates the split and no longer has a tab of its own; without
 * weight it reads as a general expense, which is what those records are.
 */
const SECTION_FILTERS: Record<string, Record<string, any>> = {
  generales: { tipo: { $in: ["operacional", "logistico"] }, libras: { $not: { $gt: 0 } } },
  envios: { tipo: "envio" },
  recepciones: { $or: [{ tipo: "recepcion" }, { libras: { $gt: 0 } }] },
};

function sectionFilter(seccion: unknown): Record<string, any> {
  const filter = SECTION_FILTERS[String(seccion || "")];
  return filter ? { ...filter } : {};
}

export async function listGastos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, proveedor, desde, hasta, limit, offset, seccion } = req.query;
    const query: Record<string, any> = sectionFilter(seccion);
    if (tipo) query.tipo = tipo;
    if (categoria) query.categoria = categoria;
    if (proveedor) query.proveedor = new RegExp(String(proveedor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (desde || hasta) {
      query.fecha = {};
      const from = toCalendarDate(desde);
      const to = endOfCalendarDate(hasta);
      if (from) query.fecha.$gte = from;
      if (to) query.fecha.$lte = to;
    }

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [gastos, total] = await Promise.all([
      models.gastos
        .find(query)
        .populate("creadoPor", "name email")
        .populate("updatedBy", "name email")
        .sort({ fecha: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      models.gastos.countDocuments(query),
    ]);

    res.status(200).json({ gastos, total });
  } catch (error) {
    next(error);
  }
}

export async function getGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const gasto = await models.gastos
      .findById(req.params.id)
      .populate("creadoPor", "name email")
      .populate("updatedBy", "name email")
      .lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
    res.status(200).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function createGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const {
      tipo,
      categoria,
      monto,
      descripcion,
      fecha,
      proveedor,
      referencia,
      paqueteId,
      numeroFactura,
      fechaFactura,
      libras,
      valorPorLibra,
      valorTotal,
      valorPagado,
      numeroPaquetes,
      idempotencyKey,
    } = req.body;

    if (!tipo || !categoria || monto === undefined || !descripcion) {
      res.status(400).json({ error: "tipo, categoria, monto, descripcion are required" });
      return;
    }
    // A reception exists to record what a pound costs; without both figures the
    // rate cannot be derived and the record would be indistinguishable from a
    // plain expense, which is the mixing Cost Centre was built to undo.
    if (tipo === "recepcion" && !(toNumber(libras) > 0 && toNumber(valorPorLibra) > 0)) {
      res.status(400).json({ error: "Una recepción necesita libras y valor por libra mayores a cero" });
      return;
    }
    if (idempotencyKey) {
      const existing = await models.gastos.findOne({ idempotencyKey: String(idempotencyKey), creadoPor: user.userId });
      if (existing) return void res.status(200).json({ gasto: existing });
    }

    const proveedorResolved = await resolveProveedor(proveedor);

    const gasto = await models.gastos.create({
      tipo,
      categoria,
      monto,
      descripcion,
      fecha: toCalendarDate(fecha) ?? todayAsCalendarDate(),
      proveedor: proveedorResolved?.nombre || proveedor || "",
      proveedorId: proveedorResolved?._id,
      referencia: referencia || "",
      numeroFactura: numeroFactura || "",
      fechaFactura: toCalendarDate(fechaFactura),
      libras: toNumber(libras),
      valorPorLibra: toNumber(valorPorLibra),
      numeroPaquetes: toNumber(numeroPaquetes),
      valorTotal: calculateValorTotal(libras, valorPorLibra, toNumber(valorTotal) || toNumber(monto)),
      valorPagado: toNumber(valorPagado),
      paqueteId: paqueteId || undefined,
      creadoPor: user.userId,
      updatedBy: user.userId,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
    });

    try {
      await postFinancialMovement({
        direccion: "egreso",
        base: "devengado",
        origen: "gasto",
        origenId: String(gasto._id),
        concepto: "gasto_operativo",
        categoria: String(categoria),
        monto: Number(gasto.valorTotal || gasto.monto || 0),
        estado: "confirmado",
        fechaOperacion: gasto.fecha,
        proveedorId: gasto.proveedorId,
        creadoPor: user.userId,
        metadata: { tipo: gasto.tipo, numeroFactura: gasto.numeroFactura },
      });
    } catch (error) {
      await models.gastos.findByIdAndDelete(gasto._id);
      throw error;
    }

    res.status(201).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function updateGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const allowedFields = [
      "tipo", "categoria", "monto", "descripcion", "fecha", "proveedor", "referencia",
      "paqueteId", "numeroFactura", "fechaFactura", "libras", "valorPorLibra", "valorTotal", "valorPagado",
      "numeroPaquetes",
    ];
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))) as Record<string, any>;

    if (typeof updates.proveedor === "string") {
      const proveedorResolved = await resolveProveedor(updates.proveedor);
      updates.proveedor = proveedorResolved?.nombre || canonicalProveedorNombre(updates.proveedor);
      updates.proveedorId = proveedorResolved?._id;
    }

    if (updates.fecha !== undefined) updates.fecha = toCalendarDate(updates.fecha) ?? todayAsCalendarDate();
    if (updates.fechaFactura !== undefined) updates.fechaFactura = toCalendarDate(updates.fechaFactura);
    if (updates.numeroPaquetes !== undefined) updates.numeroPaquetes = toNumber(updates.numeroPaquetes);
    if (updates.libras !== undefined) updates.libras = toNumber(updates.libras);
    if (updates.valorPorLibra !== undefined) updates.valorPorLibra = toNumber(updates.valorPorLibra);
    if (updates.valorPagado !== undefined) updates.valorPagado = toNumber(updates.valorPagado);
    if (updates.monto !== undefined) updates.monto = toNumber(updates.monto);
    if (updates.valorTotal !== undefined) updates.valorTotal = toNumber(updates.valorTotal);
    if (updates.libras !== undefined && updates.valorPorLibra !== undefined) {
      updates.valorTotal = calculateValorTotal(updates.libras, updates.valorPorLibra, toNumber(updates.valorTotal) || toNumber(updates.monto));
    }

    const gasto = await models.gastos
      .findByIdAndUpdate(req.params.id, { $set: { ...updates, updatedBy: user.userId } }, { new: true, runValidators: true })
      .populate("creadoPor", "name email")
      .populate("updatedBy", "name email")
      .lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
    const changesFinancials = ["tipo", "categoria", "monto", "fecha", "proveedor", "libras", "valorPorLibra", "valorTotal"].some((key) => key in updates);
    if (changesFinancials) {
      await reverseFinancialMovements("gasto", String(gasto._id), user.userId);
      await postFinancialMovement({
        direccion: "egreso",
        base: "devengado",
        origen: "gasto",
        origenId: String(gasto._id),
        concepto: `gasto_operativo:${Date.now()}`,
        categoria: String(gasto.categoria),
        monto: Number(gasto.valorTotal || gasto.monto || 0),
        estado: "confirmado",
        fechaOperacion: gasto.fecha,
        proveedorId: gasto.proveedorId,
        creadoPor: user.userId,
        metadata: { tipo: gasto.tipo, numeroFactura: gasto.numeroFactura, replacesPrevious: true },
      });
    }
    res.status(200).json({ gasto });
  } catch (error) {
    next(error);
  }
}

export async function deleteGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    const gasto = await models.gastos.findById(req.params.id).lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }

    const assetRef = gasto.comprobantePublicId
      ? {
          publicId: gasto.comprobantePublicId,
          resourceType: gasto.comprobanteResourceType || extractCloudinaryAssetRef(gasto.comprobanteUrl || "")?.resourceType || "image",
        }
      : extractCloudinaryAssetRef(gasto.comprobanteUrl || "");

    if (assetRef?.publicId) {
      await deleteCloudinaryAsset(assetRef);
    }

    await reverseFinancialMovements("gasto", String(gasto._id), user.userId);
    await models.gastos.findByIdAndDelete(req.params.id).lean();
    res.status(200).json({ message: "Gasto deleted" });
  } catch (error) {
    next(error);
  }
}

export async function uploadGastoArchivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const upload = await uploadGastoFactura(req.file.buffer);
    const gasto = await models.gastos
      .findByIdAndUpdate(req.params.id, { $set: { comprobanteUrl: upload.url, comprobantePublicId: upload.publicId, comprobanteResourceType: upload.resourceType, updatedBy: user.userId } }, { new: true })
      .populate("creadoPor", "name email")
      .populate("updatedBy", "name email")
      .lean();

    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }

    res.status(200).json({ gasto, upload });
  } catch (error) {
    next(error);
  }
}

export async function resumenGastos(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, proveedor, desde, hasta, seccion } = _req.query;
    const now = new Date();
    const desdeDefault = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const match: Record<string, any> = sectionFilter(seccion);
    if (tipo) match.tipo = tipo;
    if (categoria) match.categoria = categoria;
    if (proveedor) match.proveedor = new RegExp(String(proveedor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.fecha = {};
    match.fecha.$gte = toCalendarDate(desde) ?? desdeDefault;
    const hastaFecha = endOfCalendarDate(hasta);
    if (hastaFecha) match.fecha.$lte = hastaFecha;

    const [totales, porTipo, porMes, porCategoria, porProveedor] = await Promise.all([
      models.gastos.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: gastoTotalExpression },
            facturas: { $sum: 1 },
            libras: { $sum: "$libras" },
            paquetes: { $sum: "$numeroPaquetes" },
          },
        },
      ]),
      models.gastos.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$tipo",
            total: { $sum: gastoTotalExpression },
            facturas: { $sum: 1 },
            libras: { $sum: "$libras" },
          },
        },
        { $sort: { total: -1 } },
      ]),
      models.gastos.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$fecha" } },
            total: { $sum: gastoTotalExpression },
            facturas: { $sum: 1 },
            libras: { $sum: "$libras" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      models.gastos.aggregate([
        { $match: { ...match, categoria: { $ne: "" } } },
        {
          $group: {
            _id: "$categoria",
            total: { $sum: gastoTotalExpression },
            facturas: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
      models.gastos.aggregate([
        { $match: { ...match, proveedor: { $ne: "" } } },
        {
          $group: {
            _id: "$proveedor",
            total: { $sum: gastoTotalExpression },
            facturas: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const total = totales[0] || { total: 0, facturas: 0, libras: 0, paquetes: 0 };
    // What a pound actually cost over the period. On the receptions tab this is the
    // number Oscar is checking his supplier against, and it has to come from the
    // totals rather than from averaging each record's rate, which would weight a
    // 12 lb parcel the same as a 126 lb one.
    const costoPorLibra = Number(total.libras) > 0
      ? Number((Number(total.total) / Number(total.libras)).toFixed(4))
      : 0;

    res.status(200).json({
      resumen: {
        total: { ...total, costoPorLibra },
        porTipo,
        porMes,
        porCategoria,
        porProveedor,
      },
    });
  } catch (error) {
    next(error);
  }
}
