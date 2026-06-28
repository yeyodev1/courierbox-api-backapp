import mongoose, { Schema, type Document } from "mongoose";

export interface IEnvioDomicilio extends Document {
  paqueteId: mongoose.Types.ObjectId;
  clienteNombre: string;
  clienteDireccion: string;
  clienteTelefono: string;
  tipoTransportista: "propio" | "externo";
  transportistaNombre: string;
  costoEnvio: number;
  trackingLocal: string;
  estado: "pendiente" | "asignado" | "en_ruta" | "entregado" | "fallido";
  evidenciaUrl: string;
  notas: string;
  creadoPor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const envioDomicilioSchema = new Schema<IEnvioDomicilio>(
  {
    paqueteId: {
      type: Schema.Types.ObjectId,
      ref: "Paquete",
      required: true,
    },
    clienteNombre: { type: String, required: true },
    clienteDireccion: { type: String, required: true },
    clienteTelefono: { type: String, default: "" },
    tipoTransportista: {
      type: String,
      enum: ["propio", "externo"],
      default: "externo",
    },
    transportistaNombre: { type: String, default: "" },
    costoEnvio: { type: Number, default: 0 },
    trackingLocal: { type: String, default: "" },
    estado: {
      type: String,
      enum: ["pendiente", "asignado", "en_ruta", "entregado", "fallido"],
      default: "pendiente",
    },
    evidenciaUrl: { type: String, default: "" },
    notas: { type: String, default: "" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

envioDomicilioSchema.index({ paqueteId: 1 });
envioDomicilioSchema.index({ estado: 1 });

export const EnvioDomicilio = mongoose.model<IEnvioDomicilio>(
  "EnvioDomicilio",
  envioDomicilioSchema
);
