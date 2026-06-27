import axios from "axios";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

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
