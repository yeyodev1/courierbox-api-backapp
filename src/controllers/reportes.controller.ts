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

/**
 * What an envío actually costs us: the interprovincial provider payment plus any
 * leg costs carried by older records. Leaving valorPagadoProveedor out overstated
 * the margin on every interprovincial delivery.
 */
const COSTO_ENVIO = {
  $add: [
    { $ifNull: ["$valorPagadoProveedor", 0] },
    { $ifNull: ["$trayectoUsa.costo", 0] },
    { $ifNull: ["$trayectoLocal.costo", 0] },
  ],
};

export async function getReporteEjecutivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { desde, hasta } = period(req);
    const match = { createdAt: { $gte: desde, $lt: hasta } };
    const [finanzas, gastos, caja, envios, produccion, proveedores, embudo] = await Promise.all([
      resumenFinanciero(desde, hasta, "devengado"),
      models.gastos.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta } } }, { $group: { _id: null, total: { $sum: { $cond: [{ $gt: ["$valorTotal", 0] }, "$valorTotal", "$monto"] } }, pagado: { $sum: "$valorPagado" } } }]),
      resumenFinanciero(desde, hasta, "caja"),
      models.enviosDomicilio.aggregate([{ $match: match }, { $group: { _id: "$modo", total: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, costo: { $sum: COSTO_ENVIO } } }]),
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
    const match = { createdAt: { $gte: desde, $lt: hasta } };

    const [rentabilidad, totales, detalle] = await Promise.all([
      models.enviosDomicilio.aggregate([
        { $match: match },
        { $addFields: { costoTransporte: COSTO_ENVIO } },
        { $group: { _id: "$modo", envios: { $sum: 1 }, cobrado: { $sum: "$valorCobrado" }, costo: { $sum: "$costoTransporte" } } },
        { $addFields: { margen: { $subtract: ["$cobrado", "$costo"] } } },
      ]),
      models.enviosDomicilio.aggregate([
        { $match: match },
        { $addFields: { costoTransporte: COSTO_ENVIO } },
        {
          $group: {
            _id: null,
            envios: { $sum: 1 },
            cobrado: { $sum: "$valorCobrado" },
            costo: { $sum: "$costoTransporte" },
            entregados: { $sum: { $cond: [{ $eq: ["$estado", "entregado"] }, 1, 0] } },
          },
        },
        { $addFields: { margen: { $subtract: ["$cobrado", "$costo"] } } },
      ]),
      models.enviosDomicilio
        .find(match)
        .select("createdAt entregadoEn modo clienteNombre ciudadDestino proveedorUtilizado valorCobrado valorPagadoProveedor trayectoUsa.costo trayectoLocal.costo estado asignadoNombre")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const resumen = totales[0] || { envios: 0, cobrado: 0, costo: 0, margen: 0, entregados: 0 };
    const format = String(req.query.formato || "json").toLowerCase();

    if (!["csv", "xlsx", "pdf"].includes(format)) {
      res.json({ periodo: { desde, hasta }, rentabilidad, resumen });
      return;
    }

    const rows = detalle.map((e: any) => {
      const costo = Number(e.valorPagadoProveedor || 0) + Number(e.trayectoUsa?.costo || 0) + Number(e.trayectoLocal?.costo || 0);
      const cobrado = Number(e.valorCobrado || 0);
      return {
        Fecha: new Date(e.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }),
        Modo: e.modo || "local",
        Cliente: e.clienteNombre || "",
        Ciudad: e.ciudadDestino || "",
        Motorizado: e.asignadoNombre || "",
        Proveedor: e.proveedorUtilizado || "",
        Estado: e.estado || "",
        Cobrado: cobrado,
        Costo: costo,
        Margen: cobrado - costo,
      };
    });

    const stamp = `${desde.toISOString().slice(0, 10)}_${new Date(hasta.getTime() - 1).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" })}`;
    const money = (value: number) => Number(value || 0).toFixed(2);

    if (format === "csv") {
      const headers = ["Fecha", "Modo", "Cliente", "Ciudad", "Motorizado", "Proveedor", "Estado", "Cobrado", "Costo", "Margen"];
      const csv = [
        headers.join(","),
        ...rows.map((row: any) => headers.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(",")),
        "",
        `"TOTAL","","","","","","${resumen.envios} envíos","${money(resumen.cobrado)}","${money(resumen.costo)}","${money(resumen.margen)}"`,
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_envios_${stamp}.csv"`);
      return void res.send(`\uFEFF${csv}`);
    }

    if (format === "xlsx") {
      const sheet = xlsx.utils.json_to_sheet([
        ...rows,
        {},
        { Cliente: "TOTAL", Estado: `${resumen.envios} envíos`, Cobrado: resumen.cobrado, Costo: resumen.costo, Margen: resumen.margen },
      ]);
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, sheet, "Envíos");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="reporte_envios_${stamp}.xlsx"`);
      return void res.send(xlsx.write(book, { type: "buffer", bookType: "xlsx" }));
    }

    const body = rows
      .map(
        (row: any) =>
          `<tr><td>${row.Fecha}</td><td>${row.Modo}</td><td>${row.Cliente}</td><td>${row.Proveedor}</td><td>${row.Estado}</td><td class="n">${money(row.Cobrado)}</td><td class="n">${money(row.Costo)}</td><td class="n">${money(row.Margen)}</td></tr>`
      )
      .join("");
    const pdf = await htmlToPdf(
      `<html><head><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:6px;border:1px solid #ddd;text-align:left}.n{text-align:right}tfoot td{font-weight:700;background:#f5f5f5}</style></head><body>` +
        `<h1>Reporte de envíos</h1><p>${stamp.replace("_", " al ")}</p>` +
        `<p><strong>${resumen.envios}</strong> envíos · <strong>${resumen.entregados}</strong> entregados · cobrado <strong>$${money(resumen.cobrado)}</strong> · costo <strong>$${money(resumen.costo)}</strong> · margen <strong>$${money(resumen.margen)}</strong></p>` +
        `<table><thead><tr><th>Fecha</th><th>Modo</th><th>Cliente</th><th>Proveedor</th><th>Estado</th><th>Cobrado</th><th>Costo</th><th>Margen</th></tr></thead><tbody>${body}</tbody>` +
        `<tfoot><tr><td colspan="5">TOTAL</td><td class="n">${money(resumen.cobrado)}</td><td class="n">${money(resumen.costo)}</td><td class="n">${money(resumen.margen)}</td></tr></tfoot></table></body></html>`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="reporte_envios_${stamp}.pdf"`);
    return void res.send(pdf);
  } catch (error) {
    next(error);
  }
}
