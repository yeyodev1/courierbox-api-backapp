import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
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
      if (hasta) query.fecha.$lte = new Date(hasta as string);
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

    const { tipo, categoria, monto, clienteNombre, clienteId, descripcion, referencia, comprobanteUrl, fecha } = req.body;
    if (!tipo || !categoria || monto === undefined) {
      return void res.status(400).json({ error: "tipo, categoria, monto are required" });
    }

    const movimiento = await models.cajaMovimientos.create({
      tipo,
      categoria,
      monto: Number(monto) || 0,
      clienteNombre: clienteNombre || "",
      clienteId: clienteId || undefined,
      descripcion: descripcion || "",
      referencia: referencia || "",
      comprobanteUrl: comprobanteUrl || "",
      fecha: fecha ? new Date(fecha) : new Date(),
      creadoPor: user.userId,
    });

    res.status(201).json({ movimiento });
  } catch (error) {
    next(error);
  }
}

export async function resumenCaja(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [ingresos, egresos] = await Promise.all([
      models.cajaMovimientos.aggregate([{ $match: { tipo: "ingreso" } }, { $group: { _id: null, total: { $sum: "$monto" }, count: { $sum: 1 } } }]),
      models.cajaMovimientos.aggregate([{ $match: { tipo: "egreso" } }, { $group: { _id: null, total: { $sum: "$monto" }, count: { $sum: 1 } } }]),
    ]);

    res.status(200).json({ ingresos: ingresos[0] || { total: 0, count: 0 }, egresos: egresos[0] || { total: 0, count: 0 } });
  } catch (error) {
    next(error);
  }
}
