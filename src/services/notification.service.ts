import mongoose from "mongoose";
import { models } from "../models/index";
import type {
  EntregaEstado,
  INotificacion,
  NotificacionCanal,
  NotificacionEvento,
} from "../models/notificacion.model";
import {
  sendEntregaConfirmacion,
  sendEnvioEnCaminoCliente,
  sendGestionCompraConfirmacion,
  sendGestionLifecycleEmail,
  sendRecepcionBodegaCliente,
  sendRetiroCounterComprobante,
  sendFacturaEmitida,
  sendSolicitudRecibida,
  type EmailDeliveryResult,
} from "./email.service";
import { composeWhatsappNotification } from "./whatsapp.service";

interface NotificationInput {
  evento: NotificacionEvento;
  destinatario: string;
  /** Enables the WhatsApp channel when `canales` includes it. */
  destinatarioTelefono?: string;
  destinatarioNombre?: string;
  operacionTipo: "gestion_compra" | "envio" | "factura" | "solicitud";
  operacionId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  /** Defaults to email + WhatsApp; WhatsApp self-skips when unconfigured. */
  canales?: NotificacionCanal[];
  force?: boolean;
}

interface ChannelResult {
  success: boolean;
  providerId?: string;
  error?: string;
  skipped?: boolean;
  /** Composed but not delivered — waiting for an operator (WhatsApp). */
  ready?: boolean;
  mensaje?: string;
  enlace?: string;
}

const DEFAULT_CANALES: NotificacionCanal[] = ["email", "whatsapp"];

async function deliverEmail(
  evento: NotificacionEvento,
  payload: Record<string, unknown>
): Promise<EmailDeliveryResult> {
  switch (evento) {
    case "gestion_creada":
      return sendGestionCompraConfirmacion(payload as Parameters<typeof sendGestionCompraConfirmacion>[0]);
    case "pago_confirmado":
      return sendGestionLifecycleEmail(payload as Parameters<typeof sendGestionLifecycleEmail>[0]);
    case "compra_realizada":
      return sendGestionLifecycleEmail(payload as Parameters<typeof sendGestionLifecycleEmail>[0]);
    case "recepcion_bodega":
      return sendRecepcionBodegaCliente(payload as Parameters<typeof sendRecepcionBodegaCliente>[0]);
    case "envio_en_camino":
      return sendEnvioEnCaminoCliente(payload as Parameters<typeof sendEnvioEnCaminoCliente>[0]);
    case "entrega_completada":
      return sendEntregaConfirmacion(payload as Parameters<typeof sendEntregaConfirmacion>[0]);
    case "retiro_counter":
      return sendRetiroCounterComprobante(payload as Parameters<typeof sendRetiroCounterComprobante>[0]);
    case "factura_emitida":
      return sendFacturaEmitida(payload as Parameters<typeof sendFacturaEmitida>[0]);
    case "solicitud_recibida":
      return sendSolicitudRecibida(payload as Parameters<typeof sendSolicitudRecibida>[0]);
    default:
      return { success: false, error: `Evento ${evento} todavía no tiene plantilla` };
  }
}

async function deliverChannel(
  canal: NotificacionCanal,
  notification: INotificacion
): Promise<ChannelResult> {
  if (canal === "email") {
    if (!notification.destinatario) {
      return { success: false, skipped: true, error: "Contacto sin correo" };
    }
    return deliverEmail(notification.evento, notification.payload);
  }

  // WhatsApp has no automated transport here: we compose the message and hand
  // back a click-to-chat link for a human to send.
  const composed = composeWhatsappNotification({
    evento: notification.evento,
    nombre: notification.destinatarioNombre || notification.destinatario,
    payload: notification.payload,
  });

  return {
    success: false,
    ready: composed.ready,
    skipped: composed.skipped,
    error: composed.error,
    mensaje: composed.mensaje,
    enlace: composed.enlace,
  };
}

/**
 * Roll per-channel outcomes up into the single status the admin list shows.
 * `listo` counts as outstanding — the message exists but nobody sent it yet.
 */
function aggregateEstado(entregas: INotificacion["entregas"]): INotificacion["estado"] {
  const attempted = entregas.filter((e) => e.estado !== "omitida");
  if (attempted.length === 0) return "fallida";

  const sent = attempted.filter((e) => e.estado === "enviada");
  if (sent.length === attempted.length) return "enviada";
  if (sent.length > 0) return "parcial";

  // Nothing delivered: a pending manual send is not a failure.
  return attempted.some((e) => e.estado === "fallida") ? "fallida" : "pendiente";
}

function ensureEntregas(notification: INotificacion): void {
  const canales = notification.canales?.length ? notification.canales : ["email" as const];
  for (const canal of canales) {
    if (!notification.entregas.some((e) => e.canal === canal)) {
      notification.entregas.push({ canal, estado: "pendiente", intentos: 0 });
    }
  }
}

export async function createAndSendNotification(input: NotificationInput) {
  const idempotencyKey =
    input.idempotencyKey ?? `${input.operacionTipo}:${input.operacionId}:${input.evento}`;
  const canales = input.canales?.length ? input.canales : DEFAULT_CANALES;

  const base = {
    evento: input.evento,
    operacionTipo: input.operacionTipo,
    operacionId: input.operacionId,
    canales,
    canal: canales[0] ?? "email",
    idempotencyKey,
    intentos: 0,
  };

  const mutable = {
    destinatario: input.destinatario,
    destinatarioTelefono: input.destinatarioTelefono ?? "",
    destinatarioNombre: input.destinatarioNombre ?? "",
    payload: input.payload,
  };

  const update = input.force
    ? { $setOnInsert: base, $set: { ...mutable, estado: "pendiente" } }
    : { $setOnInsert: { ...base, ...mutable, estado: "pendiente" } };

  const notification = await models.notificaciones.findOneAndUpdate({ idempotencyKey }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  if (notification.estado === "enviada") return notification.toObject();
  return retryNotification(String(notification._id));
}

/**
 * Sends every channel that has not landed yet. Channels are independent: a
 * WhatsApp failure never blocks the email, and retrying only re-runs what is
 * still outstanding.
 */
export async function retryNotification(id: string, canal?: NotificacionCanal) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const notification = await models.notificaciones.findOneAndUpdate(
    {
      _id: id,
      $or: [{ estado: { $ne: "enviando" } }, { estado: "enviando", updatedAt: { $lt: staleBefore } }],
    },
    { $set: { estado: "enviando", ultimoError: "" }, $inc: { intentos: 1 } },
    { new: true }
  );
  if (!notification) throw new Error("Notificación no encontrada o en proceso");

  ensureEntregas(notification);

  const pending = notification.entregas.filter((entrega) => {
    if (canal && entrega.canal !== canal) return false;
    // A forced single-channel retry may revive a skipped channel (e.g. the
    // contact name was filled in afterwards); a bulk retry leaves settled ones
    // be — including WhatsApp rows already composed and awaiting a human.
    if (canal) return entrega.estado !== "enviada";
    return !["enviada", "omitida", "listo"].includes(entrega.estado);
  });

  await Promise.all(
    pending.map(async (entrega) => {
      entrega.intentos += 1;
      const result = await deliverChannel(entrega.canal, notification);
      const estado: EntregaEstado = result.success
        ? "enviada"
        : result.ready
          ? "listo"
          : result.skipped
            ? "omitida"
            : "fallida";
      entrega.estado = estado;
      entrega.providerId = result.providerId;
      entrega.ultimoError = result.error;
      entrega.mensaje = result.mensaje ?? entrega.mensaje;
      entrega.enlace = result.enlace ?? entrega.enlace;
      entrega.enviadaEn = result.success ? new Date() : undefined;
    })
  );

  notification.estado = aggregateEstado(notification.entregas);
  const emailEntrega = notification.entregas.find((e) => e.canal === "email");
  // Legacy top-level mirrors: older screens and integrations still read these.
  notification.providerId = emailEntrega?.providerId;
  notification.ultimoError = notification.entregas
    .filter((e) => e.ultimoError)
    .map((e) => `${e.canal}: ${e.ultimoError}`)
    .join(" · ");
  notification.enviadaEn =
    notification.estado === "enviada" || notification.estado === "parcial" ? new Date() : undefined;

  notification.markModified("entregas");
  await notification.save();
  return notification.toObject();
}

/**
 * Confirms a manual send (WhatsApp). The operator opened the click-to-chat
 * link and hit send; this records that so the ledger stops flagging it.
 */
export async function marcarEntregaEnviada(
  id: string,
  canal: NotificacionCanal,
  userId?: string
) {
  const notification = await models.notificaciones.findById(id);
  if (!notification) throw new Error("Notificación no encontrada");

  ensureEntregas(notification);
  const entrega = notification.entregas.find((e) => e.canal === canal);
  if (!entrega) throw new Error(`La notificación no tiene canal ${canal}`);

  entrega.estado = "enviada";
  entrega.enviadaEn = new Date();
  entrega.ultimoError = "";
  if (userId) entrega.enviadaPor = new mongoose.Types.ObjectId(userId);

  notification.estado = aggregateEstado(notification.entregas);
  notification.enviadaEn =
    notification.estado === "enviada" || notification.estado === "parcial" ? new Date() : undefined;

  notification.markModified("entregas");
  await notification.save();
  return notification.toObject();
}

export async function listNotifications(filters: {
  estado?: string;
  operacionTipo?: string;
  operacionId?: string;
  canal?: string;
}) {
  const query: Record<string, unknown> = {};
  if (filters.estado) query.estado = filters.estado;
  if (filters.operacionTipo) query.operacionTipo = filters.operacionTipo;
  if (filters.operacionId) query.operacionId = filters.operacionId;
  if (filters.canal) query.canales = filters.canal;
  return models.notificaciones.find(query).sort({ createdAt: -1 }).limit(200).lean();
}
