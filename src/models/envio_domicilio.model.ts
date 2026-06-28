import mongoose, { Schema, type Document } from "mongoose";

export interface ITrayectoPago {
  proveedorId?: mongoose.Types.ObjectId;
  proveedorNombre: string;
  tracking: string;
  costo: number;
  pagado: boolean;
  fechaPago?: Date;
  comprobanteUrl: string;
  notas: string;
}

export interface IEnvioDomicilio extends Document {
  paqueteId: mongoose.Types.ObjectId;
  clienteNombre: string;
  clienteDireccion: string;
  clienteTelefono: string;
  trayectoUsa: ITrayectoPago;
  trayectoLocal: ITrayectoPago;
  estado: "pendiente" | "asignado" | "en_ruta" | "entregado" | "fallido";
  evidenciaUrl: string;
  notas: string;
  creadoPor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const trayectoSchema = new Schema<ITrayectoPago>(
  {
    proveedorId: { type: Schema.Types.ObjectId, ref: "Proveedor" },
    proveedorNombre: { type: String, default: "" },
    tracking: { type: String, default: "" },
    costo: { type: Number, default: 0 },
    pagado: { type: Boolean, default: false },
    fechaPago: { type: Date },
    comprobanteUrl: { type: String, default: "" },
    notas: { type: String, default: "" },
  },
  { _id: false }
);

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
    trayectoUsa: { type: trayectoSchema, default: () => ({}) },
    trayectoLocal: { type: trayectoSchema, default: () => ({}) },
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
