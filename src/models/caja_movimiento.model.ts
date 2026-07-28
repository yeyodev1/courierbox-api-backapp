import mongoose, { Schema, type Document } from "mongoose";

export interface ICajaMovimiento extends Document {
  tipo: "ingreso" | "egreso";
  categoria: string;
  monto: number;
  clienteNombre: string;
  clienteId?: mongoose.Types.ObjectId;
  descripcion: string;
  referencia: string;
  comprobanteUrl: string;
  fecha: Date;
  creadoPor: mongoose.Types.ObjectId;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cajaMovimientoSchema = new Schema<ICajaMovimiento>(
  {
    tipo: { type: String, enum: ["ingreso", "egreso"], required: true },
    categoria: { type: String, required: true },
    monto: { type: Number, required: true, min: 0 },
    clienteNombre: { type: String, default: "" },
    clienteId: { type: Schema.Types.ObjectId, ref: "MasterCliente" },
    descripcion: { type: String, default: "" },
    referencia: { type: String, default: "" },
    comprobanteUrl: { type: String, default: "" },
    fecha: { type: Date, default: Date.now },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    idempotencyKey: { type: String, sparse: true },
  },
  { timestamps: true }
);

cajaMovimientoSchema.index({ tipo: 1, fecha: -1 });
cajaMovimientoSchema.index({ categoria: 1, fecha: -1 });
cajaMovimientoSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const CajaMovimiento = mongoose.model<ICajaMovimiento>("CajaMovimiento", cajaMovimientoSchema);
