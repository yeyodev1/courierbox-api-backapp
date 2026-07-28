import mongoose, { Schema, type Document } from "mongoose";

export interface IMovimientoFinanciero extends Document {
  direccion: "ingreso" | "egreso";
  base: "devengado" | "caja";
  origen: "gestion" | "envio" | "factura" | "caja" | "gasto" | "pago";
  origenId: string;
  concepto: string;
  categoria: string;
  monto: number;
  estado: "pendiente" | "confirmado" | "anulado";
  fechaOperacion: Date;
  fechaPago?: Date;
  clienteId?: mongoose.Types.ObjectId;
  proveedorId?: mongoose.Types.ObjectId;
  asesorId?: mongoose.Types.ObjectId;
  creadoPor: mongoose.Types.ObjectId;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const movimientoFinancieroSchema = new Schema<IMovimientoFinanciero>(
  {
    direccion: { type: String, enum: ["ingreso", "egreso"], required: true },
    base: { type: String, enum: ["devengado", "caja"], required: true },
    origen: { type: String, enum: ["gestion", "envio", "factura", "caja", "gasto", "pago"], required: true },
    origenId: { type: String, required: true },
    concepto: { type: String, required: true },
    categoria: { type: String, required: true },
    monto: { type: Number, required: true, min: 0 },
    estado: { type: String, enum: ["pendiente", "confirmado", "anulado"], default: "pendiente" },
    fechaOperacion: { type: Date, required: true, default: Date.now },
    fechaPago: { type: Date },
    clienteId: { type: Schema.Types.ObjectId },
    proveedorId: { type: Schema.Types.ObjectId, ref: "Proveedor" },
    asesorId: { type: Schema.Types.ObjectId, ref: "User" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

movimientoFinancieroSchema.index({ origen: 1, origenId: 1, concepto: 1 }, { unique: true });
movimientoFinancieroSchema.index({ fechaOperacion: -1, direccion: 1, estado: 1 });
movimientoFinancieroSchema.index({ asesorId: 1, fechaOperacion: -1 });

export const MovimientoFinanciero = mongoose.model<IMovimientoFinanciero>("MovimientoFinanciero", movimientoFinancieroSchema);
