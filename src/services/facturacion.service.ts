import { models } from "../models/index";
import { contificoService } from "./contifico.service";
import { enviarWebhookFactura } from "./ghl-webhook.service";
import { createAndSendNotification } from "./notification.service";
import { logger } from "../utils/logger";
import { env } from "../config/env";

const TARIFA_FLETE_LB = 6.50;
const TARIFA_ARANCEL_LB = 1.99;
const IVA = 0.15;

/** Published so the counter screen can show live totals as packages are ticked. */
export const TARIFAS = {
  fleteLb: TARIFA_FLETE_LB,
  arancelLb: TARIFA_ARANCEL_LB,
  iva: IVA,
} as const;

export interface TotalesFactura {
  pesoTotalLb: number;
  totalFlete: number;
  totalArancel: number;
  subtotal: number;
  totalIva: number;
  totalGeneral: number;
}

/** Single source of truth for the tariff maths, shared by preview and emission. */
export function calcularTotales(pesos: number[]): TotalesFactura {
  const pesoTotalLb = pesos.reduce((sum, p) => sum + (Number(p) || 0), 0);
  const totalFlete = parseFloat((pesoTotalLb * TARIFA_FLETE_LB).toFixed(2));
  const totalArancel = parseFloat((pesoTotalLb * TARIFA_ARANCEL_LB).toFixed(2));
  const subtotal = parseFloat((totalFlete + totalArancel).toFixed(2));
  // Only the freight line carries IVA, matching the Contifico item breakdown.
  const totalIva = parseFloat((totalFlete * IVA).toFixed(2));
  const totalGeneral = parseFloat((subtotal + totalIva).toFixed(2));
  return { pesoTotalLb, totalFlete, totalArancel, subtotal, totalIva, totalGeneral };
}

/**
 * Packages the counter can invoice right now: already validated, still without
 * an invoice, and attached to a master client.
 */
export async function listarFacturables(q: string) {
  const term = (q ?? "").trim();
  if (term.length < 2) return { paquetes: [], tarifas: TARIFAS };

  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const paquetes = await models.paquetes
    .find({
      estado: { $in: ["validado", "pendiente_validacion"] },
      facturaId: null,
      masterClienteId: { $ne: null },
      $or: [{ wr: rx }, { sh: rx }, { trackingOriginal: rx }, { consigneeNombre: rx }, { consigneeLimpio: rx }],
    })
    .populate("masterClienteId", "nombreOficial cedulaRuc email telefono codigoCasillero")
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();

  return { paquetes, tarifas: TARIFAS };
}

export async function facturarPaquetes(paqueteIds: string[]): Promise<{
  exito: boolean;
  facturaId?: string;
  error?: string;
}> {
  const paquetes = await models.paquetes.find({ _id: { $in: paqueteIds } }).lean();
  if (!paquetes.length) {
    return { exito: false, error: "No se encontraron paquetes" };
  }

  const masterId = paquetes[0].masterClienteId;
  for (const p of paquetes) {
    if (p.masterClienteId?.toString() !== masterId?.toString()) {
      return { exito: false, error: "Todos los paquetes deben pertenecer al mismo cliente" };
    }
  }

  const cliente = masterId
    ? await models.masterClientes.findById(masterId).lean()
    : null;

  if (!cliente) {
    return { exito: false, error: "Cliente no encontrado" };
  }

  // NOTE: this used to charge IVA on freight + duty (`subtotal * IVA`) while the
  // Contifico item breakdown below declares the duty line at 0% IVA. Our stored
  // total therefore disagreed with the invoice Contifico actually issued.
  // calcularTotales() applies IVA to the freight line only, matching the items.
  const {
    pesoTotalLb: pesoTotal,
    totalFlete,
    totalArancel,
    subtotal,
    totalIva,
    totalGeneral,
  } = calcularTotales(paquetes.map((p) => p.pesoLb || 0));

  const contificoResult = await contificoService.emitirContifico({
    clienteId: cliente._id.toString(),
    clienteNombre: cliente.nombreOficial,
    clienteIdentificacion: cliente.cedulaRuc || "9999999999999",
    clienteEmail: cliente.email,
    clienteTelefono: cliente.telefono,
    items: [
      {
        descripcion: `Flete courier (${pesoTotal.toFixed(2)} lb)`,
        cantidad: 1,
        precioUnitario: totalFlete,
        porcentajeIva: 15,
      },
      {
        descripcion: `Arancel 4x4 (${pesoTotal.toFixed(2)} lb)`,
        cantidad: 1,
        precioUnitario: totalArancel,
        porcentajeIva: 0,
      },
    ],
    totalSinIva: subtotal,
    totalConIva: totalGeneral,
  });

  const factura = await models.facturas.create({
    numeroFactura: contificoResult.numeroFactura || `TEMP-${Date.now()}`,
    masterClienteId: cliente._id,
    paquetes: paqueteIds,
    pesoTotalLb: pesoTotal,
    totalFlete,
    totalArancel,
    totalGeneral,
    iva: totalIva,
    pdfUrl: contificoResult.pdfUrl || "",
    contificoResponse: contificoResult.respuestaRaw || {},
    estado: "pendiente",
  });

  await models.paquetes.updateMany(
    { _id: { $in: paqueteIds } },
    { $set: { estado: "facturado", facturaId: factura._id } }
  );

  if (contificoResult.exito) {
    // Legacy CRM webhook: no-ops when its URL is unset, which it now is.
    enviarWebhookFactura({
      facturaId: factura._id.toString(),
      numeroFactura: factura.numeroFactura,
      totalAmount: factura.totalGeneral,
      pdfUrl: factura.pdfUrl,
      clienteNombre: cliente.nombreOficial,
      clienteTelefono: cliente.telefono,
      clienteEmail: cliente.email,
      codigoCasillero: cliente.codigoCasillero,
    }).catch((err) => logger.error("[facturacion] webhook error:", err));

    // The real channel: the shared ledger, so the invoice reaches the client by
    // email and leaves a ready-to-send WhatsApp message like every other event.
    if (cliente.email || cliente.telefono) {
      createAndSendNotification({
        evento: "factura_emitida",
        destinatario: cliente.email ?? "",
        destinatarioTelefono: cliente.telefono ?? "",
        destinatarioNombre: cliente.nombreOficial,
        operacionTipo: "factura",
        operacionId: factura._id.toString(),
        payload: {
          to: cliente.email ?? "",
          clienteNombre: cliente.nombreOficial,
          numeroFactura: factura.numeroFactura,
          codigoCasillero: cliente.codigoCasillero,
          pesoTotalLb: pesoTotal,
          totalFlete,
          totalArancel,
          totalIva,
          totalGeneral: factura.totalGeneral,
          pdfUrl: factura.pdfUrl,
          paquetes: paquetes.map((p) => ({
            referencia: p.wr || p.sh || p.trackingOriginal,
            descripcion: p.contenido,
            pesoLb: p.pesoLb,
          })),
          portalUrl: `${env.FRONTEND_ORIGIN[0] ?? "https://courierboxlogistics.com"}/pagos`,
        },
      }).catch((err) => logger.error("[facturacion] notificación error:", err));
    }
  }

  return { exito: true, facturaId: factura._id.toString() };
}
