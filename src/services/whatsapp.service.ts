import { whatsappLink } from "../config/contact";
import type { NotificacionEvento } from "../models/notificacion.model";

/**
 * WhatsApp channel.
 *
 * Courier Box runs no CRM and has no WhatsApp Business API credentials, so
 * nothing can be delivered programmatically. This service composes the message
 * for each event and returns a click-to-chat link to Courier Box's own line;
 * an operator opens it and hits send, then marks the channel as sent.
 *
 * That is why the result is `ready` rather than `success`: the message exists,
 * the delivery has not happened yet.
 */

export interface WhatsappComposeResult {
  /** The message is composed and the link is usable. */
  ready: boolean;
  mensaje?: string;
  enlace?: string;
  error?: string;
  /** True when there is nothing worth composing (no client name/context). */
  skipped?: boolean;
}

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Message bodies. Written first person from the client, because the link opens
 * a chat *to* Courier Box — the client is the one who ends up sending it.
 */
const EVENT_MESSAGE: Record<
  NotificacionEvento,
  (p: Record<string, unknown>, nombre: string) => string
> = {
  gestion_creada: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Registré una compra por ${money(p.valorTotal)}` +
    (text(p.gestionId) ? ` (referencia ${text(p.gestionId).slice(-8).toUpperCase()})` : "") +
    ". Quiero confirmar los siguientes pasos.",

  pago_confirmado: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Me confirmaron el pago de ${money(p.valorTotal)} y quiero ` +
    "consultar el estado de mi gestión.",

  compra_realizada: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Me avisaron que ya realizaron mi compra` +
    (text(p.numeroOrden) ? ` (orden ${text(p.numeroOrden)})` : "") +
    ". Quiero saber cuándo llega a bodega.",

  recepcion_bodega: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Mi producto ya llegó a bodega` +
    (text(p.entregaEstimada) ? ` con entrega estimada ${text(p.entregaEstimada)}` : "") +
    ". Quiero coordinar la entrega.",

  envio_en_camino: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Mi envío va en camino` +
    (text(p.direccion) ? ` a ${text(p.direccion)}` : "") +
    ". Quiero confirmar la hora de entrega.",

  entrega_completada: (_p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Recibí mi paquete y quiero dejar un comentario.`,

  solicitud_recibida: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Envié una solicitud de compra` +
    (text(p.folio) ? ` (folio ${text(p.folio)})` : "") +
    ` por ${money(p.totalEstimado)}. Quiero confirmarla.`,

  factura_emitida: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Recibí la factura ${text(p.numeroFactura)} por ${money(p.totalGeneral)}` +
    (text(p.codigoCasillero) ? ` (casillero ${text(p.codigoCasillero)})` : "") +
    ". Quiero coordinar el pago y el retiro.",

  retiro_counter: (p, nombre) =>
    `Hola Courier Box, soy ${nombre}. Retiré ${text(p.totalPaquetes) || "mis"} paquete(s) en counter` +
    (text(p.folio) ? ` (comprobante #${text(p.folio)})` : "") +
    ". Tengo una consulta sobre este retiro.",
};

export function buildWhatsappMessage(
  evento: NotificacionEvento,
  payload: Record<string, unknown>,
  nombre: string
): string {
  const build = EVENT_MESSAGE[evento];
  const cliente = nombre?.trim() || "un cliente";
  return build
    ? build(payload, cliente)
    : `Hola Courier Box, soy ${cliente}. Quiero consultar sobre mi pedido.`;
}

/**
 * Composes the message and the click-to-chat link. Never performs I/O — there
 * is no transport to call.
 */
export function composeWhatsappNotification(params: {
  evento: NotificacionEvento;
  nombre?: string;
  payload: Record<string, unknown>;
}): WhatsappComposeResult {
  const nombre = params.nombre?.trim() ?? "";
  if (!nombre) {
    return { ready: false, skipped: true, error: "Contacto sin nombre para redactar el mensaje" };
  }

  const mensaje = buildWhatsappMessage(params.evento, params.payload, nombre);
  return { ready: true, mensaje, enlace: whatsappLink(mensaje) };
}

/**
 * Normalises a phone into E.164. Not used for delivery (there is none) — the
 * counter and admin screens show it next to the WhatsApp row so an operator can
 * dial or copy it.
 */
export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("593")) return `+${digits}`;
  if (digits.startsWith("0")) return `+593${digits.slice(1)}`;
  if (digits.length === 9) return `+593${digits}`;
  return `+${digits}`;
}
