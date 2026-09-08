import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { models } from "../models/index";
import {
  calcularTotales,
  completarDatosCliente,
  facturarPaquetes,
  listarFacturables,
  registrarCobroContifico,
  sincronizarFacturaSri,
  validarSeleccion,
} from "../services/facturacion.service";
import { uploadComprobante } from "../services/upload.service";
import { contificoService } from "../services/contifico.service";

export async function generarFactura(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paqueteIds, consumidorFinal } = req.body;
    if (!Array.isArray(paqueteIds) || paqueteIds.length === 0) {
      res.status(400).json({ error: "Se requiere un array de paqueteIds" });
      return;
    }
    const result = await facturarPaquetes(paqueteIds, { consumidorFinal: Boolean(consumidorFinal) });
    if (!result.exito) {
      // 422: faltan datos del cliente, el counter puede completarlos. 502: Contifico no la aceptó.
      const status = result.faltantes ? 422 : /Contifico/.test(result.error) ? 502 : 400;
      res.status(status).json({ error: result.error, faltantes: result.faltantes, consumidorFinalPosible: result.consumidorFinalPosible });
      return;
    }
    res.status(201).json({ message: "Factura generada", facturaId: result.factura.facturaId, factura: result.factura });
  } catch (err: any) {
    console.error("[facturacion] error:", err.message);
    next(err);
  }
}

/** Antes de emitir: cliente, totales y qué le falta para que el SRI la autorice. */
export async function validarFactura(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paqueteIds } = req.body;
    if (!Array.isArray(paqueteIds) || paqueteIds.length === 0) {
      res.status(400).json({ error: "Se requiere un array de paqueteIds" });
      return;
    }
    const result = await validarSeleccion(paqueteIds);
    if (!result.exito) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/** El counter completa cédula/RUC, correo, teléfono o dirección sin salir de la pantalla. */
export async function completarCliente(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { nombreOficial, cedulaRuc, email, telefono, direccion } = req.body ?? {};
    const result = await completarDatosCliente(String(req.params.id), { nombreOficial, cedulaRuc, email, telefono, direccion });
    if (!result.exito) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(200).json({ cliente: result.cliente });
  } catch (err) {
    next(err);
  }
}

/** Vuelve a consultar (y reenvía si hace falta) el estado de la factura en el SRI. */
export async function sincronizarSri(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await sincronizarFacturaSri(String(req.params.facturaId));
    if (!result.exito) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(200).json({ factura: result.factura });
  } catch (err) {
    next(err);
  }
}

/** Packages the counter can still invoice, plus the tariffs the UI previews with. */
export async function getFacturables(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paquetes, tarifas } = await listarFacturables(String(req.query.q ?? ""));
    res.status(200).json({ paquetes, tarifas });
  } catch (err) {
    next(err);
  }
}

/** Server-side total for a selection, so the counter never bills a stale figure. */
export async function previewFactura(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paqueteIds } = req.body;
    if (!Array.isArray(paqueteIds) || paqueteIds.length === 0) {
      res.status(400).json({ error: "Se requiere un array de paqueteIds" });
      return;
    }
    const paquetes = await models.paquetes.find({ _id: { $in: paqueteIds } }).select("pesoLb").lean();
    res.status(200).json({ totales: calcularTotales(paquetes.map((p) => p.pesoLb || 0)) });
  } catch (err) {
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

/**
 * Accepts either a real array or the JSON string a multipart form produces.
 * The portal posts FormData (it carries the transfer screenshot), so multer
 * hands every text field over as a string — `Array.isArray` was always false
 * here and every payment attempt died with a 400.
 */
function parseIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    // Also tolerate a plain comma-separated list.
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export async function registrarPago(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const facturaIds = parseIdList(req.body?.facturaIds);
    const referenciaPago = String(req.body?.referenciaPago ?? "").trim();

    if (!facturaIds.length || !referenciaPago) {
      res.status(400).json({ error: "facturaIds y referenciaPago son requeridos" });
      return;
    }

    const validIds = facturaIds.filter((id) => mongoose.isValidObjectId(id));
    if (!validIds.length) {
      res.status(400).json({ error: "Ninguna factura válida en la selección" });
      return;
    }

    let comprobanteUrl = "";
    if (req.file) {
      const upload = await uploadComprobante(req.file.buffer);
      comprobanteUrl = upload.url;
    }

    const result = await models.facturas.updateMany(
      { _id: { $in: validIds }, estado: "pendiente" },
      { $set: { estado: "verificando", referenciaPago, comprobanteUrl } }
    );

    if (result.modifiedCount === 0) {
      res.status(409).json({
        error: "Esas facturas ya no están pendientes de pago. Actualiza la página y vuelve a intentar.",
      });
      return;
    }

    res.status(200).json({
      message: "Pago registrado, pendiente de verificación",
      facturasActualizadas: result.modifiedCount,
    });
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

    registrarCobroContifico(factura).catch((err) => console.error("[facturacion] cobro contifico:", err?.message));

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

/** Salud de la integración con Contifico, sin emitir nada. Para verificar un despliegue. */
export async function diagnosticoContifico(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const d = await contificoService.diagnostico();
    res.status(d.error ? 503 : 200).json(d);
  } catch (err) {
    next(err);
  }
}
