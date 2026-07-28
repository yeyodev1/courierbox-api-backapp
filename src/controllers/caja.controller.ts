import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { models } from "../models/index";
import { postFinancialMovement, reverseFinancialMovements } from "../services/financial-movement.service";
import { uploadComprobante } from "../services/upload.service";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function buildDateMatch(desde?: unknown, hasta?: unknown) {
  if (!desde && !hasta) return undefined;
  const match: Record<string, Date> = {};
  if (desde) match.$gte = new Date(String(desde));
  if (hasta) {
    const end = new Date(String(hasta));
    end.setHours(23, 59, 59, 999);
    match.$lte = end;
  }
  return match;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveClienteId(clienteNombre?: unknown, clienteId?: unknown, clienteEmail?: unknown, clientePhone?: unknown) {
  const rawClienteId = typeof clienteId === "string" ? clienteId.trim() : "";
  if (rawClienteId && mongoose.isValidObjectId(rawClienteId)) {
    return new mongoose.Types.ObjectId(rawClienteId);
  }

  const parsed = rawClienteId.includes("|") ? rawClienteId.split("|") : [];
  const nombre = String(parsed[0] || clienteNombre || "").trim();
  const email = String(parsed[1] || clienteEmail || "").trim();
  const telefono = String(parsed[2] || clientePhone || "").trim();

  const query: Record<string, any> = {};
  if (nombre) query.nombreOficial = new RegExp(`^${escapeRegExp(nombre)}$`, "i");
  if (email) query.email = new RegExp(`^${escapeRegExp(email)}$`, "i");
  if (telefono) query.telefono = new RegExp(`^${escapeRegExp(telefono)}$`, "i");

  if (!Object.keys(query).length) return undefined;

  const cliente = await models.masterClientes.findOne(query).select("_id").lean();
  return cliente?._id;
}

export async function listCaja(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (tipo) query.tipo = tipo;
    if (categoria) query.categoria = categoria;
    if (desde || hasta) {
      query.fecha = {};
      if (desde) query.fecha.$gte = new Date(desde as string);
      if (hasta) {
        const end = new Date(hasta as string);
        end.setHours(23, 59, 59, 999);
        query.fecha.$lte = end;
      }
    }

    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [movimientos, total] = await Promise.all([
      models.cajaMovimientos.find(query).populate("creadoPor", "name email").sort({ fecha: -1 }).skip(skip).limit(take).lean(),
      models.cajaMovimientos.countDocuments(query),
    ]);

    res.status(200).json({ movimientos, total });
  } catch (error) {
    next(error);
  }
}

export async function createCaja(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const { tipo, categoria, monto, clienteNombre, clienteId, clienteEmail, clientePhone, descripcion, referencia, comprobanteUrl, fecha, idempotencyKey } = req.body;
    if (!tipo || !categoria || monto === undefined) {
      return void res.status(400).json({ error: "tipo, categoria, monto are required" });
    }
    if (idempotencyKey) {
      const existing = await models.cajaMovimientos.findOne({ idempotencyKey: String(idempotencyKey), creadoPor: user.userId });
      if (existing) return void res.status(200).json({ movimiento: existing });
    }

    const resolvedClienteId = await resolveClienteId(clienteNombre, clienteId, clienteEmail, clientePhone);

    const movimiento = await models.cajaMovimientos.create({
      tipo,
      categoria,
      monto: Number(monto) || 0,
      clienteNombre: clienteNombre || "",
      clienteId: resolvedClienteId,
      descripcion: descripcion || "",
      referencia: referencia || "",
      comprobanteUrl: comprobanteUrl || "",
      fecha: fecha ? new Date(fecha) : new Date(),
      creadoPor: user.userId,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
    });

    try {
      await postFinancialMovement({
        direccion: movimiento.tipo,
        base: "caja",
        origen: "caja",
        origenId: String(movimiento._id),
        concepto: "movimiento_caja",
        categoria: movimiento.categoria,
        monto: movimiento.monto,
        estado: "confirmado",
        fechaOperacion: movimiento.fecha,
        fechaPago: movimiento.fecha,
        clienteId: movimiento.clienteId,
        creadoPor: user.userId,
        metadata: { referencia: movimiento.referencia },
      });
    } catch (error) {
      await models.cajaMovimientos.findByIdAndDelete(movimiento._id);
      throw error;
    }

    res.status(201).json({ movimiento });
  } catch (error) {
    next(error);
  }
}

export async function resumenCaja(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tipo, categoria, desde, hasta } = _req.query;
    const match: Record<string, any> = {};
    if (tipo) match.tipo = tipo;
    if (categoria) match.categoria = categoria;
    const dateMatch = buildDateMatch(desde, hasta);
    if (dateMatch) match.fecha = dateMatch;

    const [ingresos, egresos, porTipo, porCategoria] = await Promise.all([
      models.cajaMovimientos.aggregate([
        { $match: { ...match, tipo: "ingreso" } },
        { $group: { _id: null, total: { $sum: "$monto" }, count: { $sum: 1 } } },
      ]),
      models.cajaMovimientos.aggregate([
        { $match: { ...match, tipo: "egreso" } },
        { $group: { _id: null, total: { $sum: "$monto" }, count: { $sum: 1 } } },
      ]),
      models.cajaMovimientos.aggregate([
        { $match: match },
        { $group: { _id: "$categoria", total: { $sum: "$monto" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      models.cajaMovimientos.aggregate([
        { $match: match },
        { $group: { _id: "$tipo", total: { $sum: "$monto" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
    ]);

    const ingresosTotal = ingresos[0] || { total: 0, count: 0 };
    const egresosTotal = egresos[0] || { total: 0, count: 0 };

    res.status(200).json({
      ingresos: ingresosTotal,
      egresos: egresosTotal,
      saldo: (ingresosTotal.total || 0) - (egresosTotal.total || 0),
      porTipo: porCategoria,
      porCategoria: porTipo,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadCajaArchivo(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const upload = await uploadComprobante(req.file.buffer);
    const movimiento = await models.cajaMovimientos
      .findByIdAndUpdate(req.params.id, { $set: { comprobanteUrl: upload.url } }, { new: true })
      .populate("creadoPor", "name email")
      .lean();

    if (!movimiento) {
      res.status(404).json({ error: "Movimiento not found" });
      return;
    }

    res.status(200).json({ movimiento, upload });
  } catch (error) {
    next(error);
  }
}

export async function deleteCaja(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    const movimiento = await models.cajaMovimientos.findById(req.params.id).lean();
    if (!movimiento) {
      res.status(404).json({ error: "Movimiento not found" });
      return;
    }

    const referenceDate = movimiento.fecha ? new Date(movimiento.fecha) : new Date(movimiento.createdAt);
    const diffDays = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 7) {
      res.status(403).json({ error: "No se puede eliminar un movimiento con más de 7 días de antigüedad" });
      return;
    }

    await reverseFinancialMovements("caja", String(movimiento._id), user.userId);
    await models.cajaMovimientos.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Movimiento eliminado" });
  } catch (error) {
    next(error);
  }
}
