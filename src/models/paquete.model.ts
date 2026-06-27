import mongoose, { Document, Schema } from "mongoose";

export type EstadoPaquete =
  | "importado"
  | "pendiente_validacion"
  | "validado"
  | "facturado"
  | "pagado"
  | "despachado";

export interface IPaquete extends Document {
  wr: string;
  sh: string;
  mg: string;
  trackingOriginal: string;
  pesoLb: number;
  contenido: string;
  statusProveedor: string;
  notas: string;
  notasExtraidas: string;
  consigneeNombre: string;
  consigneeLimpio: string;
  subagencyId: string;
  masterClienteId: mongoose.Types.ObjectId | null;
  estado: EstadoPaquete;
  facturaId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const paqueteSchema = new Schema<IPaquete>(
  {
    wr: { type: String, default: "" },
    sh: { type: String, default: "", uppercase: true, trim: true },
    mg: { type: String, default: "" },
    trackingOriginal: { type: String, default: "" },
    pesoLb: { type: Number, default: 0 },
    contenido: { type: String, default: "" },
    statusProveedor: { type: String, default: "" },
    notas: { type: String, default: "" },
    notasExtraidas: { type: String, default: "" },
    consigneeNombre: { type: String, default: "" },
    consigneeLimpio: { type: String, default: "" },
    subagencyId: { type: String, default: "" },
    masterClienteId: { type: Schema.Types.ObjectId, ref: "MasterCliente", default: null },
    estado: {
      type: String,
      enum: ["importado", "pendiente_validacion", "validado", "facturado", "pagado", "despachado"],
      default: "importado",
    },
    facturaId: { type: Schema.Types.ObjectId, ref: "Factura", default: null },
  },
  { timestamps: true, versionKey: false }
);

paqueteSchema.index({ wr: 1 });
paqueteSchema.index({ sh: 1 });
paqueteSchema.index({ masterClienteId: 1 });
paqueteSchema.index({ estado: 1 });

export const Paquete = mongoose.model<IPaquete>("Paquete", paqueteSchema);
