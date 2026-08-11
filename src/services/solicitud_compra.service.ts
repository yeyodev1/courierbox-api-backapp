import mongoose from "mongoose";
import { models } from "../models/index";
import type { ISolicitudItem, SolicitudEstado } from "../models/solicitud_compra.model";
import { calculateFeeFromConfig, getDefaultFeeConfig } from "./fee.service";
import { createAndSendNotification } from "./notification.service";
import { logger } from "../utils/logger";

/** Stores we quote for. Anything else is refused rather than silently accepted. */
const TIENDAS_PERMITIDAS = [
  "amazon.com",
  "amazon.es",
  "ebay.com",
  "walmart.com",
  "bestbuy.com",
  "shein.com",
  "aliexpress.com",
  "target.com",
  "homedepot.com",
  "apple.com",
];

const MAX_ITEMS = 15;

export interface SolicitudItemInput {
  url: string;
  titulo?: string;
  cantidad?: number;
  valorProducto?: number;
  valorEnvio?: number;
  notas?: string;
}

export interface CrearSolicitudInput {
  clienteNombre: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  clienteCedula?: string;
  codigoCasillero?: string;
  items: SolicitudItemInput[];
  origenIp?: string;
}

const badRequest = (message: string) => Object.assign(new Error(message), { status: 400 });

/** Accepts a product URL only if it points at a store we actually buy from. */
export function tiendaDeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const match = TIENDAS_PERMITIDAS.find((t) => host === t || host.endsWith(`.${t}`));
  return match ?? null;
}

export function listarTiendasPermitidas(): string[] {
  return [...TIENDAS_PERMITIDAS];
}

export interface CotizacionResult {
  subtotal: number;
  comisionEstimada: number;
  totalEstimado: number;
  comisionDetalle: string;
  feeConfigId?: string;
  configNombre: string;
}

/**
 * Quotes a basket using the same fee configuration the advisors' calculator
 * uses, so the number the client sees on the public page is the number the
 * team will honour.
 */
export async function cotizar(
  items: Array<{ cantidad?: number; valorProducto?: number; valorEnvio?: number }>
): Promise<CotizacionResult> {
  const productos = items.reduce(
    (sum, i) => sum + (Number(i.valorProducto) || 0) * Math.max(1, Number(i.cantidad) || 1),
    0
  );
  const envios = items.reduce(
    (sum, i) => sum + (Number(i.valorEnvio) || 0) * Math.max(1, Number(i.cantidad) || 1),
    0
  );
  const subtotal = Number((productos + envios).toFixed(2));

  const config = await getDefaultFeeConfig();
  if (!config) {
    // No configured tariff: quote the goods honestly rather than invent a fee.
    return {
      subtotal,
      comisionEstimada: 0,
      totalEstimado: subtotal,
      comisionDetalle: "Sin tarifa configurada — un asesor confirmará la comisión",
      configNombre: "",
    };
  }

  const fee = calculateFeeFromConfig(config, productos, envios);
  return {
    subtotal,
    comisionEstimada: Number(fee.feeAmount.toFixed(2)),
    totalEstimado: Number((subtotal + fee.feeAmount).toFixed(2)),
    comisionDetalle: fee.breakdown,
    feeConfigId: String((config as any)._id),
    configNombre: fee.configName,
  };
}

export async function crearSolicitud(input: CrearSolicitudInput) {
  const nombre = input.clienteNombre?.trim();
  if (!nombre) throw badRequest("Necesitamos tu nombre");
  if (!input.clienteEmail?.trim() && !input.clienteTelefono?.trim()) {
    throw badRequest("Déjanos un correo o un teléfono para contactarte");
  }
  if (!input.items?.length) throw badRequest("Agrega al menos un producto");
  if (input.items.length > MAX_ITEMS) {
    throw badRequest(`Máximo ${MAX_ITEMS} productos por solicitud`);
  }

  const items: ISolicitudItem[] = [];
  for (const item of input.items) {
    const tienda = tiendaDeUrl(item.url ?? "");
    if (!tienda) {
      throw badRequest(
        `El link "${String(item.url ?? "").slice(0, 60)}" no es de una tienda que compremos. Permitidas: ${TIENDAS_PERMITIDAS.join(", ")}`
      );
    }
    items.push({
      url: item.url.trim(),
      titulo: item.titulo?.trim() || tienda,
      cantidad: Math.max(1, Number(item.cantidad) || 1),
      valorProducto: Math.max(0, Number(item.valorProducto) || 0),
      valorEnvio: Math.max(0, Number(item.valorEnvio) || 0),
      notas: item.notas?.trim() ?? "",
    });
  }

  const cotizacion = await cotizar(items);

  const solicitud = await models.solicitudesCompra.create({
    clienteNombre: nombre,
    clienteEmail: input.clienteEmail?.trim() ?? "",
    clienteTelefono: input.clienteTelefono?.trim() ?? "",
    clienteCedula: input.clienteCedula?.trim() ?? "",
    codigoCasillero: input.codigoCasillero?.trim() ?? "",
    items,
    subtotal: cotizacion.subtotal,
    comisionEstimada: cotizacion.comisionEstimada,
    totalEstimado: cotizacion.totalEstimado,
    comisionDetalle: cotizacion.comisionDetalle,
    feeConfigId: cotizacion.feeConfigId
      ? new mongoose.Types.ObjectId(cotizacion.feeConfigId)
      : undefined,
    origenIp: input.origenIp ?? "",
  });

  // Best-effort acknowledgement: the request is already saved, so a mail
  // failure must not make the client think the form broke.
  if (solicitud.clienteEmail || solicitud.clienteTelefono) {
    createAndSendNotification({
      evento: "solicitud_recibida",
      destinatario: solicitud.clienteEmail,
      destinatarioTelefono: solicitud.clienteTelefono,
      destinatarioNombre: solicitud.clienteNombre,
      operacionTipo: "solicitud",
      operacionId: String(solicitud._id),
      payload: {
        to: solicitud.clienteEmail,
        clienteNombre: solicitud.clienteNombre,
        folio: String(solicitud._id).slice(-8).toUpperCase(),
        totalItems: items.length,
        subtotal: cotizacion.subtotal,
        comisionEstimada: cotizacion.comisionEstimada,
        totalEstimado: cotizacion.totalEstimado,
        items: items.map((i) => ({ titulo: i.titulo, url: i.url, cantidad: i.cantidad })),
      },
    }).catch((err) => logger.error("[solicitud] notificación falló", { error: String(err) }));
  }

  return solicitud.toObject();
}

export async function listarSolicitudes(filters: { estado?: string; limit?: number }) {
  const query: Record<string, unknown> = {};
  if (filters.estado) query.estado = filters.estado;
  return models.solicitudesCompra
    .find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(filters.limit) || 100, 300))
    .lean();
}

export async function actualizarEstadoSolicitud(
  id: string,
  estado: SolicitudEstado,
  userId?: string,
  notasInternas?: string
) {
  if (!mongoose.isValidObjectId(id)) {
    throw Object.assign(new Error("Solicitud no encontrada"), { status: 404 });
  }

  const update: Record<string, unknown> = { estado };
  if (notasInternas !== undefined) update.notasInternas = notasInternas;
  if (userId) update.atendidaPor = new mongoose.Types.ObjectId(userId);

  const solicitud = await models.solicitudesCompra.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true }
  );
  if (!solicitud) {
    throw Object.assign(new Error("Solicitud no encontrada"), { status: 404 });
  }
  return solicitud.toObject();
}
