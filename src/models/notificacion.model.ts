import mongoose, { Schema, type Document } from "mongoose";

export type NotificacionEvento =
  | "gestion_creada"
  | "pago_confirmado"
  | "compra_realizada"
  | "recepcion_bodega"
  | "envio_en_camino"
  | "entrega_completada";

export interface INotificacion extends Document {
  canal: "email";
  evento: NotificacionEvento;
  destinatario: string;
  operacionTipo: "gestion_compra" | "envio";
  operacionId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  estado: "pendiente" | "enviando" | "enviada" | "fallida";
  intentos: number;
  providerId?: string;
  ultimoError?: string;
  payload: Record<string, unknown>;
  enviadaEn?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificacionSchema = new Schema<INotificacion>(
  {
    canal: { type: String, enum: ["email"], default: "email" },
    evento: {
      type: String,
      enum: ["gestion_creada", "pago_confirmado", "compra_realizada", "recepcion_bodega", "envio_en_camino", "entrega_completada"],
      required: true,
    },
    destinatario: { type: String, required: true, trim: true, lowercase: true },
    operacionTipo: { type: String, enum: ["gestion_compra", "envio"], required: true },
    operacionId: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    estado: { type: String, enum: ["pendiente", "enviando", "enviada", "fallida"], default: "pendiente" },
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
notificacionSchema.index({ idempotencyKey: 1 }, { unique: true });

export const Notificacion = mongoose.model<INotificacion>("Notificacion", notificacionSchema);
