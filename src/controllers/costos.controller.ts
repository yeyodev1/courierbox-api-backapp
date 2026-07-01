import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { uploadGastoFactura } from "../services/upload.service";
import { canonicalProveedorNombre, normalizeProveedorNombre } from "../services/proveedor-normalize";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

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

export async function listGastos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, proveedor, desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (tipo) query.tipo = tipo;
    if (categoria) query.categoria = categoria;
    if (proveedor) query.proveedor = new RegExp(String(proveedor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (desde || hasta) {
      query.fecha = {};
      if (desde) query.fecha.$gte = new Date(desde as string);
      if (hasta) query.fecha.$lte = new Date(hasta as string);
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
    } = req.body;

    if (!tipo || !categoria || monto === undefined || !descripcion) {
      res.status(400).json({ error: "tipo, categoria, monto, descripcion are required" });
      return;
    }

    const proveedorResolved = await resolveProveedor(proveedor);

    const gasto = await models.gastos.create({
      tipo,
      categoria,
      monto,
      descripcion,
      fecha: fecha ? new Date(fecha) : new Date(),
      proveedor: proveedorResolved?.nombre || proveedor || "",
      proveedorId: proveedorResolved?._id,
      referencia: referencia || "",
      numeroFactura: numeroFactura || "",
      fechaFactura: fechaFactura ? new Date(fechaFactura) : undefined,
      libras: Number(libras) || 0,
      valorPorLibra: Number(valorPorLibra) || 0,
      valorTotal: Number(valorTotal) || Number(monto) || 0,
      valorPagado: Number(valorPagado) || 0,
      paqueteId: paqueteId || undefined,
      creadoPor: user.userId,
      updatedBy: user.userId,
    });

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

    const updates = req.body;
    delete updates._id;
    delete updates.creadoPor;
    delete updates.updatedBy;
    delete updates.createdAt;
    delete updates.updatedAt;

    if (typeof updates.proveedor === "string") {
      const proveedorResolved = await resolveProveedor(updates.proveedor);
      updates.proveedor = proveedorResolved?.nombre || canonicalProveedorNombre(updates.proveedor);
      updates.proveedorId = proveedorResolved?._id;
    }

    const gasto = await models.gastos
      .findByIdAndUpdate(req.params.id, { $set: { ...updates, updatedBy: user.userId } }, { new: true })
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

export async function deleteGasto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const gasto = await models.gastos.findByIdAndDelete(req.params.id).lean();
    if (!gasto) {
      res.status(404).json({ error: "Gasto not found" });
      return;
    }
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
      .findByIdAndUpdate(req.params.id, { $set: { comprobanteUrl: upload.url, updatedBy: user.userId } }, { new: true })
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
    const { tipo, categoria, proveedor, desde, hasta } = _req.query;
    const now = new Date();
    const desdeDefault = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const match: Record<string, any> = {};
    if (tipo) match.tipo = tipo;
    if (categoria) match.categoria = categoria;
    if (proveedor) match.proveedor = new RegExp(String(proveedor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.fecha = {};
    match.fecha.$gte = desde ? new Date(String(desde)) : desdeDefault;
    if (hasta) match.fecha.$lte = new Date(String(hasta));

    const [totales, porTipo, porMes, porCategoria, porProveedor] = await Promise.all([
      models.gastos.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: "$monto" },
            facturas: { $sum: 1 },
            libras: { $sum: "$libras" },
          },
        },
      ]),
      models.gastos.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$tipo",
            total: { $sum: "$monto" },
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
            total: { $sum: "$monto" },
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
            total: { $sum: "$monto" },
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
            total: { $sum: "$monto" },
            facturas: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.status(200).json({
      resumen: {
        total: totales[0] || { total: 0, facturas: 0, libras: 0 },
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
