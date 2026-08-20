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

    const { fecha, supervisorNombre, ventaCourier, ventaGestionCompra, ventaVentas, facturado, clientesNuevos, libras, notas } = req.body;

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
      libras: Math.max(Number(libras) || 0, 0),
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
          libras: { $sum: { $ifNull: ["$libras", 0] } },
          clientesNuevos: { $sum: "$clientesNuevos" },
          dias: { $sum: 1 },
        },
      },
    ]);
    const resumen = rows[0] || {
      facturado: 0, ventaCourier: 0, ventaGestionCompra: 0, ventaVentas: 0, libras: 0, clientesNuevos: 0, dias: 0,
    };
    res.status(200).json({ resumen });
  } catch (error) {
    next(error);
  }
}

/**
 * Month-by-month contrast: pounds and billing grouped by calendar month, most
 * recent first, each row carrying its delta vs. the previous month.
 */
export async function comparativoMensual(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses as string) || 12, 1), 36);
    const rows = await models.produccionDiaria.aggregate([
      {
        $group: {
          _id: { anio: { $year: "$fecha" }, mes: { $month: "$fecha" } },
          libras: { $sum: { $ifNull: ["$libras", 0] } },
          facturado: { $sum: { $ifNull: ["$facturado", 0] } },
          clientesNuevos: { $sum: { $ifNull: ["$clientesNuevos", 0] } },
          dias: { $sum: 1 },
        },
      },
      { $sort: { "_id.anio": 1, "_id.mes": 1 } },
    ]);

    const meic = rows.map((r) => ({
      anio: r._id.anio,
      mes: r._id.mes,
      libras: r.libras,
      facturado: r.facturado,
      clientesNuevos: r.clientesNuevos,
      dias: r.dias,
    }));

    // Attach month-over-month deltas while data is still oldest-first…
    const withDelta = meic.map((row, i) => {
      const prev = meic[i - 1];
      const librasPrev = prev ? prev.libras : 0;
      const deltaLibras = row.libras - librasPrev;
      const deltaPct = librasPrev > 0 ? (deltaLibras / librasPrev) * 100 : null;
      return { ...row, deltaLibras, deltaPct };
    });

    // …then return newest-first, capped to the requested window.
    const items = withDelta.reverse().slice(0, meses);
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}
