import type { Request, Response, NextFunction } from "express";
import { models } from "../models/index";
import { facturarPaquetes } from "../services/facturacion.service";
import { uploadComprobante } from "../services/upload.service";

export async function generarFactura(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paqueteIds } = req.body;
    if (!Array.isArray(paqueteIds) || paqueteIds.length === 0) {
      res.status(400).json({ error: "Se requiere un array de paqueteIds" });
      return;
    }
    const result = await facturarPaquetes(paqueteIds);
    if (!result.exito) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ message: "Factura generada", facturaId: result.facturaId });
  } catch (err: any) {
    console.error("[facturacion] error:", err.message);
    next(err);
  }
}

export async function getFacturasPendientes(req: Request<{ casillero: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const casillero = req.params.casillero;
    if (!casillero) {
      res.status(400).json({ error: "Código de casillero requerido" });
      return;
    }

    const cliente = await models.masterClientes.findOne({ codigoCasillero: casillero.toUpperCase() }).lean();
    if (!cliente) {
      res.status(404).json({ error: "Cliente no encontrado", facturas: [], cliente: null });
      return;
    }

    const facturas = await models.facturas
      .find({ masterClienteId: cliente._id, estado: { $in: ["pendiente", "verificando"] } })
      .populate("paquetes")
      .sort({ createdAt: -1 })
      .lean();

    const totalDeuda = facturas.reduce((sum, f) => sum + (f.totalGeneral || 0), 0);

    res.status(200).json({
      cliente: { id: cliente._id, nombre: cliente.nombreOficial, casillero: cliente.codigoCasillero },
      facturas,
      totalDeuda,
    });
  } catch (err: any) {
    console.error("[facturacion] pendientes error:", err.message);
    next(err);
  }
}

export async function registrarPago(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { facturaIds, referenciaPago } = req.body;
    if (!Array.isArray(facturaIds) || !facturaIds.length || !referenciaPago) {
      res.status(400).json({ error: "facturaIds y referenciaPago son requeridos" });
      return;
    }

    let comprobanteUrl = "";
    if (req.file) {
      const upload = await uploadComprobante(req.file.buffer);
      comprobanteUrl = upload.url;
    }

    await models.facturas.updateMany(
      { _id: { $in: facturaIds }, estado: "pendiente" },
      { $set: { estado: "verificando", referenciaPago, comprobanteUrl } }
    );

    res.status(200).json({ message: "Pago registrado, pendiente de verificación" });
  } catch (err: any) {
    console.error("[facturacion] registrarPago error:", err.message);
    next(err);
  }
}

export async function confirmarPago(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { facturaId } = req.params;
    const factura = await models.facturas.findById(facturaId);
    if (!factura) {
      res.status(404).json({ error: "Factura no encontrada" });
      return;
    }
    factura.estado = "pagada";
    factura.pagadaEn = new Date();
    await factura.save();

    await models.paquetes.updateMany(
      { facturaId: factura._id },
      { $set: { estado: "pagado" } }
    );

    const { enviarWebhookDespacho } = await import("../services/ghl-webhook.service");
    enviarWebhookDespacho({
      facturaId: factura._id.toString(),
      numeroFactura: factura.numeroFactura,
      codigoCasillero: "",
      evento: "package_dispatched",
    }).catch(() => {});

    res.status(200).json({ message: "Pago confirmado, paquetes marcados como pagados" });
  } catch (err: any) {
    console.error("[facturacion] confirmar error:", err.message);
    next(err);
  }
}

export async function getHistorialFacturas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const facturas = await models.facturas
      .find()
      .populate("paquetes")
      .populate("masterClienteId", "nombreOficial codigoCasillero")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.status(200).json({ facturas });
  } catch (err: any) {
    next(err);
  }
}
