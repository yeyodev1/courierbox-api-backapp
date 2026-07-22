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
  paqueteId?: mongoose.Types.ObjectId;
  gestionCompraId?: mongoose.Types.ObjectId;
  modo: "local" | "interprovincial";
  clienteNombre: string;
  clienteDireccion: string;
  clienteTelefono: string;
  clienteEmail: string;
  asignadoA?: mongoose.Types.ObjectId;
  asignadoNombre: string;
  numeroInvoice: string;
  ciudadDestino: string;
  proveedorUtilizado: string;
  valorCobrado: number;
  valorPagadoProveedor: number;
  guiaUrl: string;
  fotoEntregaUrl: string;
  firmaUrl: string;
  novedad: string;
  recibidoPorNombre: string;
  recibidoPorApellido: string;
  recibidoPorCedula: string;
  recibidoPorContacto: string;
  entregadoEn?: Date;
  entregadoPor?: mongoose.Types.ObjectId;
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
    },
    gestionCompraId: {
      type: Schema.Types.ObjectId,
      ref: "GestionCompra",
    },
    modo: { type: String, enum: ["local", "interprovincial"], default: "local" },
    clienteNombre: { type: String, required: true },
    clienteDireccion: { type: String, required: true },
    clienteTelefono: { type: String, default: "" },
    clienteEmail: { type: String, default: "" },
    asignadoA: { type: Schema.Types.ObjectId, ref: "User" },
    asignadoNombre: { type: String, default: "" },
    numeroInvoice: { type: String, default: "" },
    ciudadDestino: { type: String, default: "" },
    proveedorUtilizado: { type: String, default: "" },
    valorCobrado: { type: Number, default: 0, min: 0 },
    valorPagadoProveedor: { type: Number, default: 0, min: 0 },
    guiaUrl: { type: String, default: "" },
    fotoEntregaUrl: { type: String, default: "" },
    firmaUrl: { type: String, default: "" },
    novedad: { type: String, default: "" },
    recibidoPorNombre: { type: String, default: "" },
    recibidoPorApellido: { type: String, default: "" },
    recibidoPorCedula: { type: String, default: "" },
    recibidoPorContacto: { type: String, default: "" },
    entregadoEn: { type: Date },
    entregadoPor: { type: Schema.Types.ObjectId, ref: "User" },
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
envioDomicilioSchema.index({ modo: 1, createdAt: -1 });
envioDomicilioSchema.index({ asignadoA: 1, estado: 1, createdAt: -1 });

export const EnvioDomicilio = mongoose.model<IEnvioDomicilio>(
  "EnvioDomicilio",
  envioDomicilioSchema
);
