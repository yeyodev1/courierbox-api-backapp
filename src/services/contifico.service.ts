import axios from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface FacturaPayload {
  clienteId: string;
  clienteNombre: string;
  clienteIdentificacion: string;
  clienteEmail: string;
  clienteTelefono: string;
  items: Array<{
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    porcentajeIva: number;
  }>;
  totalSinIva: number;
  totalConIva: number;
}

export interface FacturaResult {
  exito: boolean;
  numeroFactura?: string;
  pdfUrl?: string;
  error?: string;
  respuestaRaw?: unknown;
}

async function emitirContifico(payload: FacturaPayload): Promise<FacturaResult> {
  if (!env.CONTIFICO_TOKEN || !env.CONTIFICO_API_KEY) {
    logger.warn("[contifico] API key o token no configurado — simulando emisión");
    return {
      exito: true,
      numeroFactura: `FAC-SIM-${Date.now().toString(36).toUpperCase()}`,
      pdfUrl: "",
      respuestaRaw: { simulado: true },
    };
  }

  try {
    const body = {
      puntoEmision: env.CONTIFICO_PUNTO_EMISION,
      establecimiento: env.CONTIFICO_ESTABLECIMIENTO,
      tipoDocumento: "FACTURA",
      cliente: {
        identificacion: payload.clienteIdentificacion,
        nombre: payload.clienteNombre,
        email: payload.clienteEmail,
        telefono: payload.clienteTelefono,
      },
      items: payload.items,
      totalSinIva: payload.totalSinIva,
      totalConIva: payload.totalConIva,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.CONTIFICO_TOKEN}`,
      "Content-Type": "application/json",
    };
    if (env.CONTIFICO_API_KEY) {
      headers["api-key"] = env.CONTIFICO_API_KEY;
    }

    const { data } = await axios.post(`${env.CONTIFICO_API_URL}/documento`, body, {
      headers,
      timeout: 30000,
    });

    return {
      exito: true,
      numeroFactura: data.numeroFactura || data.numeroDocumento,
      pdfUrl: data.pdfUrl || "",
      respuestaRaw: data,
    };
  } catch (err: any) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error("[contifico] Error emitiendo factura:", msg);
    return { exito: false, error: msg };
  }
}

async function getPdfUrl(numeroFactura: string): Promise<string> {
  if (!env.CONTIFICO_TOKEN || !env.CONTIFICO_API_KEY) return "";
  try {
    const pdfHeaders: Record<string, string> = { Authorization: `Bearer ${env.CONTIFICO_TOKEN}` };
    if (env.CONTIFICO_API_KEY) pdfHeaders["api-key"] = env.CONTIFICO_API_KEY;

    const { data } = await axios.get(`${env.CONTIFICO_API_URL}/documento/${numeroFactura}/pdf`, {
      headers: pdfHeaders,
      timeout: 15000,
    });
    return data.pdfUrl || data.url || "";
  } catch {
    return "";
  }
}

export const contificoService = { emitirContifico, getPdfUrl };
