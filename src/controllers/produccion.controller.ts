import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";

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
      if (hasta) {
        const end = new Date(hasta as string);
        end.setHours(23, 59, 59, 999);
        query.fecha.$lte = end;
      }
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

    const { fecha, supervisorNombre, ventaCourier, ventaGestionCompra, ventaVentas, facturado, clientesNuevos, notas } = req.body;

    const courier = Math.max(Number(ventaCourier) || 0, 0);
    const gestionCompra = Math.max(Number(ventaGestionCompra) || 0, 0);
    const ventas = Math.max(Number(ventaVentas) || 0, 0);
    const desglose = courier + gestionCompra + ventas;
    // The three lines are the source of truth; `facturado` only stands in when a
    // caller still posts the old single-total shape.
    const total = desglose > 0 ? desglose : Math.max(Number(facturado) || 0, 0);

    const item = await models.produccionDiaria.create({
      fecha: fecha ? new Date(fecha) : new Date(),
      supervisorNombre: supervisorNombre || user.email,
      ventaCourier: courier,
      ventaGestionCompra: gestionCompra,
      ventaVentas: ventas,
      facturado: total,
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
    const rows = await models.produccionDiaria.aggregate([
      { $sort: { fecha: -1 } },
      { $limit: 30 },
      {
        $group: {
          _id: null,
          facturado: { $sum: "$facturado" },
          ventaCourier: { $sum: { $ifNull: ["$ventaCourier", 0] } },
          ventaGestionCompra: { $sum: { $ifNull: ["$ventaGestionCompra", 0] } },
          ventaVentas: { $sum: { $ifNull: ["$ventaVentas", 0] } },
          clientesNuevos: { $sum: "$clientesNuevos" },
          dias: { $sum: 1 },
        },
      },
    ]);
    const resumen = rows[0] || {
      facturado: 0, ventaCourier: 0, ventaGestionCompra: 0, ventaVentas: 0, clientesNuevos: 0, dias: 0,
    };
    res.status(200).json({ resumen });
  } catch (error) {
    next(error);
  }
}
