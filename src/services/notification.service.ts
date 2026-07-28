import { models } from "../models/index";
import type { NotificacionEvento } from "../models/notificacion.model";
import {
  sendEntregaConfirmacion,
  sendEnvioEnCaminoCliente,
  sendGestionCompraConfirmacion,
  sendGestionLifecycleEmail,
  sendRecepcionBodegaCliente,
  type EmailDeliveryResult,
} from "./email.service";

interface NotificationInput {
  evento: NotificacionEvento;
  destinatario: string;
  operacionTipo: "gestion_compra" | "envio";
  operacionId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  force?: boolean;
}

async function deliver(evento: NotificacionEvento, payload: Record<string, unknown>): Promise<EmailDeliveryResult> {
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
    default:
      return { success: false, error: `Evento ${evento} todavía no tiene plantilla` };
  }
}

export async function createAndSendNotification(input: NotificationInput) {
  const idempotencyKey = input.idempotencyKey ?? `${input.operacionTipo}:${input.operacionId}:${input.evento}`;
  const { force, ...persistedInput } = input;
  const update = force
    ? {
        $setOnInsert: { canal: "email", evento: input.evento, operacionTipo: input.operacionTipo, operacionId: input.operacionId, idempotencyKey, intentos: 0 },
        $set: { destinatario: input.destinatario, payload: input.payload, estado: "pendiente" },
      }
    : { $setOnInsert: { canal: "email", ...persistedInput, idempotencyKey, estado: "pendiente", intentos: 0 } };
  const notification = await models.notificaciones.findOneAndUpdate(
    { idempotencyKey },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (notification.estado === "enviada") return notification.toObject();
  return retryNotification(String(notification._id));
}

export async function retryNotification(id: string) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const notification = await models.notificaciones.findOneAndUpdate(
    { _id: id, $or: [{ estado: { $ne: "enviando" } }, { estado: "enviando", updatedAt: { $lt: staleBefore } }] },
    { $set: { estado: "enviando", ultimoError: "" }, $inc: { intentos: 1 } },
    { new: true }
  );
  if (!notification) throw new Error("Notificación no encontrada o en proceso");

  const result = await deliver(notification.evento, notification.payload);
  notification.estado = result.success ? "enviada" : "fallida";
  notification.providerId = result.providerId;
  notification.ultimoError = result.error;
  notification.enviadaEn = result.success ? new Date() : undefined;
  await notification.save();
  return notification.toObject();
}

export async function listNotifications(filters: { estado?: string; operacionTipo?: string; operacionId?: string }) {
  const query: Record<string, unknown> = {};
  if (filters.estado) query.estado = filters.estado;
  if (filters.operacionTipo) query.operacionTipo = filters.operacionTipo;
  if (filters.operacionId) query.operacionId = filters.operacionId;
  return models.notificaciones.find(query).sort({ createdAt: -1 }).limit(200).lean();
}
