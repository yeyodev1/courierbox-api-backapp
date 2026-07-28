import mongoose, { Schema, type Document } from "mongoose";

export interface IGasto extends Document {
  tipo: "operacional" | "logistico" | "envio";
  categoria: string;
  monto: number;
  descripcion: string;
  fecha: Date;
  proveedor: string;
  proveedorId?: mongoose.Types.ObjectId;
  referencia: string;
  comprobanteUrl: string;
  comprobantePublicId?: string;
  comprobanteResourceType?: string;
  numeroFactura: string;
  fechaFactura?: Date;
  libras: number;
  valorPorLibra: number;
  valorTotal: number;
  valorPagado: number;
  paqueteId?: mongoose.Types.ObjectId;
  creadoPor: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const gastoSchema = new Schema<IGasto>(
  {
    tipo: {
      type: String,
      enum: ["operacional", "logistico", "envio"],
      required: true,
    },
    categoria: { type: String, required: true },
    monto: { type: Number, required: true, min: 0 },
    descripcion: { type: String, required: true },
    fecha: { type: Date, required: true, default: Date.now },
    proveedor: { type: String, default: "" },
    proveedorId: { type: Schema.Types.ObjectId, ref: "Proveedor" },
    referencia: { type: String, default: "" },
    comprobanteUrl: { type: String, default: "" },
    comprobantePublicId: { type: String, default: "" },
    comprobanteResourceType: { type: String, default: "" },
    numeroFactura: { type: String, default: "" },
    fechaFactura: { type: Date },
    libras: { type: Number, default: 0, min: 0 },
    valorPorLibra: { type: Number, default: 0, min: 0 },
    valorTotal: { type: Number, default: 0, min: 0 },
    valorPagado: { type: Number, default: 0, min: 0 },
    paqueteId: { type: Schema.Types.ObjectId, ref: "Paquete" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    idempotencyKey: { type: String, sparse: true },
  },
  { timestamps: true }
);

gastoSchema.index({ tipo: 1, fecha: -1 });
gastoSchema.index({ fecha: -1 });
gastoSchema.index({ categoria: 1 });
gastoSchema.index({ proveedor: 1, fecha: -1 });
gastoSchema.index({ proveedorId: 1, fecha: -1 });
gastoSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const Gasto = mongoose.model<IGasto>("Gasto", gastoSchema);
