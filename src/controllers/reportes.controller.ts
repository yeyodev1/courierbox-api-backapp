import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";

export async function getReporteEjecutivo(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [gastos, caja, envios, produccion, proveedores] = await Promise.all([
      models.gastos.aggregate([{ $group: { _id: null, total: { $sum: "$valorTotal" }, pagado: { $sum: "$valorPagado" } } }]),
      models.cajaMovimientos.aggregate([
        { $group: { _id: "$tipo", total: { $sum: "$monto" }, count: { $sum: 1 } } },
      ]),
      models.enviosDomicilio.aggregate([
        { $group: { _id: "$modo", total: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, pagadoProveedor: { $sum: "$valorPagadoProveedor" } } },
      ]),
      models.produccionDiaria.aggregate([{ $group: { _id: null, facturado: { $sum: "$facturado" }, clientesNuevos: { $sum: "$clientesNuevos" } } }]),
      models.enviosDomicilio.aggregate([
        { $match: { proveedorUtilizado: { $ne: "" } } },
        { $group: { _id: "$proveedorUtilizado", total: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, pagadoProveedor: { $sum: "$valorPagadoProveedor" } } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.status(200).json({
      gastos: gastos[0] || { total: 0, pagado: 0 },
      caja,
      envios,
      produccion: produccion[0] || { facturado: 0, clientesNuevos: 0 },
      proveedores,
    });
  } catch (error) {
    next(error);
  }
}
