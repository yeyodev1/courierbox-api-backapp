import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index.js";
import { logger } from "../utils/logger.js";

export async function cargarCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Archivo CSV requerido" });
      return;
    }

    const csvText = req.file.buffer.toString("utf-8");
    const lineas = csvText.split("\n").filter(Boolean);
    const referenciasBancarias: string[] = [];

    for (const linea of lineas) {
      const cols = linea.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      for (const col of cols) {
        const ref = col.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        if (ref.length >= 4) referenciasBancarias.push(ref);
      }
    }

    const facturasVerificando = await models.facturas.find({ estado: "verificando" }).lean();
    let conciliadas = 0;

    for (const factura of facturasVerificando) {
      if (!factura.referenciaPago) continue;
      const refCliente = factura.referenciaPago.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const match = referenciasBancarias.some(
        (refBancaria) => refBancaria.includes(refCliente) || refCliente.includes(refBancaria)
      );

      if (match) {
        await models.facturas.updateOne(
          { _id: factura._id },
          { $set: { estado: "pagada", pagadaEn: new Date() } }
        );
        await models.paquetes.updateMany(
          { facturaId: factura._id },
          { $set: { estado: "pagado" } }
        );
        conciliadas++;
      }
    }

    const { enviarWebhookDespacho } = await import("../services/ghl-webhook.service.js");

    res.status(200).json({
      message: "CSV procesado",
      totalReferencias: referenciasBancarias.length,
      facturasVerificando: facturasVerificando.length,
      conciliadas,
    });
  } catch (err: any) {
    logger.error("[conciliacion] csv error:", err.message);
    next(err);
  }
}

export async function getPagosVerificando(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const facturas = await models.facturas
      .find({ estado: "verificando" })
      .populate("masterClienteId", "nombreOficial codigoCasillero")
      .populate("paquetes")
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ facturas });
  } catch (err: any) {
    next(err);
  }
}

export async function getResumenConciliacion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [pendientes, verificando, pagadas] = await Promise.all([
      models.facturas.countDocuments({ estado: "pendiente" }),
      models.facturas.countDocuments({ estado: "verificando" }),
      models.facturas.countDocuments({ estado: "pagada" }),
    ]);

    res.status(200).json({
      resumen: { pendientes, verificando, pagadas, total: pendientes + verificando + pagadas },
    });
  } catch (err: any) {
    next(err);
  }
}
