import mongoose, { Schema, type Document } from "mongoose";

export type NotificacionEvento =
  | "gestion_creada"
  | "pago_confirmado"
  | "compra_realizada"
  | "recepcion_bodega"
  | "envio_en_camino"
  | "entrega_completada"
  | "retiro_counter"
  | "factura_emitida"
  | "solicitud_recibida";

export const NOTIFICACION_EVENTOS: NotificacionEvento[] = [
  "gestion_creada",
  "pago_confirmado",
  "compra_realizada",
  "recepcion_bodega",
  "envio_en_camino",
  "entrega_completada",
  "retiro_counter",
  "factura_emitida",
  "solicitud_recibida",
];

export type NotificacionCanal = "email" | "whatsapp";
export const NOTIFICACION_CANALES: NotificacionCanal[] = ["email", "whatsapp"];

/**
 * Per-channel outcome.
 * - `omitida`: nothing to do (no address, or no transport configured).
 * - `listo`: the message is composed and waiting for a human to send it. Used
 *   by WhatsApp, which has no automated transport here.
 */
export type EntregaEstado =
  | "pendiente"
  | "enviando"
  | "listo"
  | "enviada"
  | "fallida"
  | "omitida";

export const ENTREGA_ESTADOS: EntregaEstado[] = [
  "pendiente",
  "enviando",
  "listo",
  "enviada",
  "fallida",
  "omitida",
];

export interface INotificacionEntrega {
  canal: NotificacionCanal;
  estado: EntregaEstado;
  intentos: number;
  providerId?: string;
  ultimoError?: string;
  enviadaEn?: Date;
  /** Composed body — WhatsApp only, so the operator sends the agreed copy. */
  mensaje?: string;
  /** Click-to-chat link that opens the message against Courier Box's line. */
  enlace?: string;
  /** Who confirmed the manual send. */
  enviadaPor?: mongoose.Types.ObjectId;
}

export interface INotificacion extends Document {
  /** Legacy single-channel field, kept so old documents keep reading correctly. */
  canal: NotificacionCanal;
  canales: NotificacionCanal[];
  entregas: INotificacionEntrega[];
  evento: NotificacionEvento;
  /** Email address. May be empty when the contact only has a phone. */
  destinatario: string;
  destinatarioTelefono?: string;
  destinatarioNombre?: string;
  operacionTipo: "gestion_compra" | "envio" | "factura" | "solicitud";
  operacionId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  /**
   * Aggregate of `entregas`. `parcial` = some channels landed and others are
   * still failed or awaiting a manual send.
   */
  estado: "pendiente" | "enviando" | "enviada" | "parcial" | "fallida";
  intentos: number;
  providerId?: string;
  ultimoError?: string;
  payload: Record<string, unknown>;
  enviadaEn?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const entregaSchema = new Schema<INotificacionEntrega>(
  {
    canal: { type: String, enum: NOTIFICACION_CANALES, required: true },
    estado: { type: String, enum: ENTREGA_ESTADOS, default: "pendiente" },
    intentos: { type: Number, default: 0, min: 0 },
    providerId: { type: String },
    ultimoError: { type: String },
    enviadaEn: { type: Date },
    mensaje: { type: String, default: "" },
    enlace: { type: String, default: "" },
    enviadaPor: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

const notificacionSchema = new Schema<INotificacion>(
  {
    canal: { type: String, enum: NOTIFICACION_CANALES, default: "email" },
    canales: { type: [String], enum: NOTIFICACION_CANALES, default: () => ["email"] },
    entregas: { type: [entregaSchema], default: () => [] },
    evento: {
      type: String,
      enum: NOTIFICACION_EVENTOS,
      required: true,
    },
    // Not required: a WhatsApp-only contact has no email, and the email channel
    // marks itself `omitida` in that case. Requiring it made save() blow up
    // after the upsert had already created the row.
    destinatario: { type: String, default: "", trim: true, lowercase: true },
    destinatarioTelefono: { type: String, default: "", trim: true },
    destinatarioNombre: { type: String, default: "", trim: true },
    operacionTipo: { type: String, enum: ["gestion_compra", "envio", "factura", "solicitud"], required: true },
    operacionId: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    estado: {
      type: String,
      enum: ["pendiente", "enviando", "enviada", "parcial", "fallida"],
      default: "pendiente",
    },
    intentos: { type: Number, default: 0, min: 0 },
    providerId: { type: String },
    ultimoError: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
    enviadaEn: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

notificacionSchema.index({ operacionTipo: 1, operacionId: 1, createdAt: -1 });
notificacionSchema.index({ estado: 1, updatedAt: 1 });
// idempotencyKey is already unique-indexed by its field definition above.
notificacionSchema.index({ "entregas.canal": 1, "entregas.estado": 1 });

export const Notificacion = mongoose.model<INotificacion>("Notificacion", notificacionSchema);
