import axios from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface FacturaWebhookPayload {
  facturaId: string;
  numeroFactura: string;
  totalAmount: number;
  pdfUrl: string;
  clienteNombre: string;
  clienteTelefono: string;
  clienteEmail: string;
  codigoCasillero: string;
}

export interface PagoWebhookPayload {
  facturaId: string;
  numeroFactura: string;
  codigoCasillero: string;
  evento: "invoice_authorized" | "package_dispatched";
}

export async function enviarWebhookFactura(data: FacturaWebhookPayload): Promise<void> {
  const url = env.GHL_WEBHOOK_INVOICE_URL;
  if (!url) {
    logger.warn("[ghl-webhook] GHL_WEBHOOK_INVOICE_URL no configurado");
    return;
  }

  const nombres = data.clienteNombre.split(" ");
  const firstName = nombres[0] || data.clienteNombre;
  const lastName = nombres.slice(1).join(" ") || "";

  const payload = {
    event_type: "invoice_authorized",
    client: {
      first_name: firstName,
      last_name: lastName,
      phone: data.clienteTelefono,
      email: data.clienteEmail,
      casillero: data.codigoCasillero,
    },
    invoice: {
      invoice_number: data.numeroFactura,
      total_amount: data.totalAmount,
      pdf_url: data.pdfUrl,
    },
  };

  try {
    await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    logger.info("[ghl-webhook] Factura enviada a GHL", { factura: data.numeroFactura });
  } catch (err: any) {
    logger.error("[ghl-webhook] Error enviando a GHL:", err.message);
  }
}

export interface CompraWebhookPayload {
  gestionId: string;
  clienteNombre: string;
  clienteTelefono: string;
  clienteEmail: string;
  valorTotal: number;
  fechaEntregaTentativa: Date;
  viewUrl: string;
  asesorNombre: string;
}

export async function enviarWebhookCompraRegistrada(data: CompraWebhookPayload): Promise<void> {
  const url = env.GHL_WEBHOOK_COMPRA_URL;
  if (!url) {
    logger.warn("[ghl-webhook] GHL_WEBHOOK_COMPRA_URL no configurado — omitiendo webhook de compra");
    return;
  }

  const nombres = data.clienteNombre.split(" ");
  const firstName = nombres[0] || data.clienteNombre;
  const lastName = nombres.slice(1).join(" ") || "";

  // Fecha formateada en español para WhatsApp (sin ISO, directo legible)
  const fechaFormateada = new Date(data.fechaEntregaTentativa).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Valor formateado como moneda
  const valorFormateado = `$${data.valorTotal.toFixed(2)}`;

  const payload = {
    event_type: "compra_registrada",
    // Campos del contacto — GHL los usa para identificar/crear el contacto
    client: {
      first_name: firstName,
      last_name: lastName,
      phone: data.clienteTelefono,
      email: data.clienteEmail,
    },
    // Custom values — mapeados a las variables {{1}}-{{5}} del template WA
    // {{1}} = first_name  (viene de client.first_name arriba)
    // {{2}} = valor_total_formateado
    // {{3}} = fecha_entrega_formateada
    // {{4}} = asesor
    // {{5}} = view_url
    compra: {
      gestion_id: data.gestionId,
      valor_total: data.valorTotal,
      valor_total_formateado: valorFormateado,
      fecha_entrega_tentativa: data.fechaEntregaTentativa.toISOString(),
      fecha_entrega_formateada: fechaFormateada,
      view_url: data.viewUrl,
      asesor: data.asesorNombre,
    },
  };

  try {
    await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    logger.info("[ghl-webhook] Compra registrada enviada a GHL", { gestionId: data.gestionId });
  } catch (err: any) {
    logger.error("[ghl-webhook] Error enviando compra a GHL:", err.message);
  }
}

export async function enviarWebhookDespacho(data: PagoWebhookPayload): Promise<void> {
  const url = env.GHL_WEBHOOK_INVOICE_URL;
  if (!url) return;

  try {
    await axios.post(url, { ...data, event_type: "package_dispatched" }, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    logger.info("[ghl-webhook] Despacho notificado a GHL");
  } catch (err: any) {
    logger.error("[ghl-webhook] Error notificando despacho:", err.message);
  }
}
