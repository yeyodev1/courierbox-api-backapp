import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { resumenFinanciero } from "../services/financial-movement.service";
import xlsx from "xlsx";
import { htmlToPdf } from "../services/pdf.service";

function period(req: Request) {
  const now = new Date();
  const parseDate = (value: unknown, exclusiveEnd = false) => {
    const raw = String(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return new Date(raw);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (exclusiveEnd ? 1 : 0), 5));
  };
  const desde = req.query.desde ? parseDate(req.query.desde) : new Date(now.getFullYear(), now.getMonth(), 1);
  const hasta = req.query.hasta ? parseDate(req.query.hasta, true) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || desde >= hasta) throw new Error("Rango de fechas inválido");
  return { desde, hasta };
}

export async function getReporteEjecutivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { desde, hasta } = period(req);
    const match = { createdAt: { $gte: desde, $lt: hasta } };
    const [finanzas, gastos, caja, envios, produccion, proveedores, embudo] = await Promise.all([
      resumenFinanciero(desde, hasta, "devengado"),
      models.gastos.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta } } }, { $group: { _id: null, total: { $sum: { $cond: [{ $gt: ["$valorTotal", 0] }, "$valorTotal", "$monto"] } }, pagado: { $sum: "$valorPagado" } } }]),
      resumenFinanciero(desde, hasta, "caja"),
      models.enviosDomicilio.aggregate([{ $match: match }, { $group: { _id: "$modo", total: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, costo: { $sum: { $add: ["$trayectoUsa.costo", "$trayectoLocal.costo"] } } } }]),
      models.produccionDiaria.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta } } }, { $group: { _id: null, facturado: { $sum: "$facturado" }, clientesNuevos: { $sum: "$clientesNuevos" } } }]),
      models.enviosDomicilio.aggregate([{ $match: { ...match, proveedorUtilizado: { $ne: "" } } }, { $group: { _id: "$proveedorUtilizado", total: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, costo: { $sum: "$valorPagadoProveedor" } } }, { $sort: { total: -1 } }, { $limit: 10 }]),
      buildEmbudo(desde, hasta),
    ]);

    const report = {
      periodo: { desde, hasta },
      finanzas,
      gastos: gastos[0] || { total: 0, pagado: 0 },
      caja,
      envios,
      produccion: produccion[0] || { facturado: 0, clientesNuevos: 0 },
      proveedores,
      embudo,
    };
    const format = String(req.query.formato || "json").toLowerCase();
    if (["csv", "xlsx", "pdf"].includes(format)) {
      const rows = [
        { Seccion: "Finanzas", Metrica: "Ingresos", Valor: finanzas.ingresos },
        { Seccion: "Finanzas", Metrica: "Egresos", Valor: finanzas.egresos },
        { Seccion: "Finanzas", Metrica: "Utilidad", Valor: finanzas.utilidad },
        { Seccion: "Caja", Metrica: "Ingresos", Valor: caja.ingresos },
        { Seccion: "Caja", Metrica: "Egresos", Valor: caja.egresos },
        { Seccion: "Caja", Metrica: "Saldo", Valor: caja.utilidad },
        { Seccion: "Embudo", Metrica: "Gestiones creadas", Valor: embudo.creadas.cantidad },
        { Seccion: "Embudo", Metrica: "Pagos confirmados", Valor: embudo.pagadas.cantidad },
        { Seccion: "Embudo", Metrica: "Entregas", Valor: embudo.entregadas.cantidad },
        ...envios.map((item: any) => ({ Seccion: "Envíos", Metrica: String(item._id), Valor: Number(item.total || 0) })),
      ];
      const stamp = `${String(req.query.desde || desde.toISOString().slice(0, 10))}_${String(req.query.hasta || new Date(hasta.getTime() - 1).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }))}`;
      if (format === "csv") {
        const csv = ["Seccion,Metrica,Valor", ...rows.map((row) => [row.Seccion, row.Metrica, row.Valor].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="reporte_ejecutivo_${stamp}.csv"`);
        return void res.send(`\uFEFF${csv}`);
      }
      if (format === "xlsx") {
        const sheet = xlsx.utils.json_to_sheet(rows);
        for (let row = 2; row <= rows.length + 1; row += 1) if (sheet[`C${row}`]) sheet[`C${row}`].z = "0.00";
        const book = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(book, sheet, "Resumen ejecutivo");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="reporte_ejecutivo_${stamp}.xlsx"`);
        return void res.send(xlsx.write(book, { type: "buffer", bookType: "xlsx" }));
      }
      const body = rows.map((row) => `<tr><td>${row.Seccion}</td><td>${row.Metrica}</td><td>${Number(row.Valor).toFixed(2)}</td></tr>`).join("");
      const pdf = await htmlToPdf(`<html><head><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd;text-align:left}</style></head><body><h1>Reporte ejecutivo</h1><p>${stamp.replace("_", " al ")}</p><table><thead><tr><th>Sección</th><th>Métrica</th><th>Valor</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_ejecutivo_${stamp}.pdf"`);
      return void res.send(pdf);
    }
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
}

async function buildEmbudo(desde: Date, hasta: Date) {
  const [creadas, pagadas, entregadas] = await Promise.all([
    models.gestionesCompra.aggregate([{ $match: { createdAt: { $gte: desde, $lt: hasta }, estado: { $ne: "cancelado" } } }, { $group: { _id: null, cantidad: { $sum: 1 }, valor: { $sum: "$valorTotal" } } }]),
    models.gestionesCompra.aggregate([{ $match: { pagoConfirmadoEn: { $gte: desde, $lt: hasta }, estadoPago: "confirmado" } }, { $group: { _id: null, cantidad: { $sum: 1 }, valor: { $sum: "$valorPagado" } } }]),
    models.enviosDomicilio.aggregate([{ $match: { entregadoEn: { $gte: desde, $lt: hasta }, estado: "entregado" } }, { $group: { _id: null, cantidad: { $sum: 1 }, valor: { $sum: "$valorCobrado" } } }]),
  ]);
  return {
    creadas: creadas[0] || { cantidad: 0, valor: 0 },
    pagadas: pagadas[0] || { cantidad: 0, valor: 0 },
    entregadas: entregadas[0] || { cantidad: 0, valor: 0 },
  };
}

export async function getEmbudoOperativo(req: Request, res: Response, next: NextFunction) {
  try {
    const { desde, hasta } = period(req);
    res.json({ periodo: { desde, hasta }, embudo: await buildEmbudo(desde, hasta) });
  } catch (error) {
    next(error);
  }
}

export async function getVentasDiarias(req: Request, res: Response, next: NextFunction) {
  try {
    const { desde, hasta } = period(req);
    const ventas = await models.movimientosFinancieros.aggregate([
      { $match: { base: "devengado", direccion: "ingreso", concepto: "venta_confirmada", estado: "confirmado", fechaOperacion: { $gte: desde, $lt: hasta } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$fechaOperacion", timezone: "America/Guayaquil" } }, total: { $sum: "$monto" }, cantidad: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ periodo: { desde, hasta }, ventas });
  } catch (error) {
    next(error);
  }
}

export async function getComisiones(req: Request, res: Response, next: NextFunction) {
  try {
    const { desde, hasta } = period(req);
    const comisiones = await models.gestionesCompra.aggregate([
      { $match: { estadoPago: "confirmado", pagoConfirmadoEn: { $gte: desde, $lt: hasta } } },
      { $group: { _id: "$asesorId", gestiones: { $sum: 1 }, ventas: { $sum: "$valorPagado" }, comision: { $sum: "$valorComision" }, costoVenta: { $sum: "$costoVenta" } } },
      { $addFields: { margenNeto: { $subtract: [{ $subtract: ["$ventas", "$comision"] }, "$costoVenta"] } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "asesor" } },
      { $unwind: { path: "$asesor", preserveNullAndEmptyArrays: true } },
      { $project: { gestiones: 1, ventas: 1, comision: 1, costoVenta: 1, margenNeto: 1, asesorNombre: "$asesor.name", asesorEmail: "$asesor.email" } },
      { $sort: { ventas: -1 } },
    ]);
    res.json({ periodo: { desde, hasta }, comisiones });
  } catch (error) {
    next(error);
  }
}

export async function getRentabilidadEnvios(req: Request, res: Response, next: NextFunction) {
  try {
    const { desde, hasta } = period(req);
    const rentabilidad = await models.enviosDomicilio.aggregate([
      { $match: { createdAt: { $gte: desde, $lt: hasta } } },
      { $addFields: { costoTransporte: { $add: ["$trayectoUsa.costo", "$trayectoLocal.costo"] } } },
      { $group: { _id: "$modo", envios: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, costo: { $sum: "$costoTransporte" } } },
      { $addFields: { margen: { $subtract: ["$cobrado", "$costo"] } } },
    ]);
    res.json({ periodo: { desde, hasta }, rentabilidad });
  } catch (error) {
    next(error);
  }
}
