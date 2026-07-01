import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

export async function listProduccion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { desde, hasta, limit, offset } = req.query;
    const query: Record<string, any> = {};
    if (desde || hasta) {
      query.fecha = {};
      if (desde) query.fecha.$gte = new Date(desde as string);
      if (hasta) query.fecha.$lte = new Date(hasta as string);
    }
    const take = Math.min(parseInt(limit as string) || 50, 200);
    const skip = parseInt(offset as string) || 0;

    const [items, total] = await Promise.all([
      models.produccionDiaria.find(query).populate("creadoPor", "name email").sort({ fecha: -1 }).skip(skip).limit(take).lean(),
      models.produccionDiaria.countDocuments(query),
    ]);

    res.status(200).json({ items, total });
  } catch (error) {
    next(error);
  }
}

export async function createProduccion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const { fecha, supervisorNombre, facturado, clientesNuevos, notas } = req.body;
    const item = await models.produccionDiaria.create({
      fecha: fecha ? new Date(fecha) : new Date(),
      supervisorNombre: supervisorNombre || user.email,
      facturado: Number(facturado) || 0,
      clientesNuevos: Number(clientesNuevos) || 0,
      notas: notas || "",
      creadoPor: user.userId,
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
}

export async function resumenProduccion(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [last30] = await Promise.all([
      models.produccionDiaria.aggregate([
        { $sort: { fecha: -1 } },
        { $limit: 30 },
        { $group: { _id: null, facturado: { $sum: "$facturado" }, clientesNuevos: { $sum: "$clientesNuevos" }, dias: { $sum: 1 } } },
      ]),
    ]);
    res.status(200).json({ resumen: last30 || { facturado: 0, clientesNuevos: 0, dias: 0 } });
  } catch (error) {
    next(error);
  }
}
