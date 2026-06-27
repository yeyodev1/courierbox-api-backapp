import mongoose, { Document, Schema } from "mongoose";

export type EstadoFactura =
  | "pendiente"
  | "verificando"
  | "pagada"
  | "cancelada";

export interface IFactura extends Document {
  numeroFactura: string;
  masterClienteId: mongoose.Types.ObjectId;
  paquetes: mongoose.Types.ObjectId[];
  pesoTotalLb: number;
  totalFlete: number;
  totalArancel: number;
  totalGeneral: number;
  iva: number;
  pdfUrl: string;
  contificoResponse: object;
  estado: EstadoFactura;
  referenciaPago: string;
  comprobanteUrl: string;
  pagadaEn: Date;
  createdAt: Date;
  updatedAt: Date;
}

const facturaSchema = new Schema<IFactura>(
  {
    numeroFactura: { type: String, default: "" },
    masterClienteId: { type: Schema.Types.ObjectId, ref: "MasterCliente", required: true },
    paquetes: [{ type: Schema.Types.ObjectId, ref: "Paquete" }],
    pesoTotalLb: { type: Number, default: 0 },
    totalFlete: { type: Number, default: 0 },
    totalArancel: { type: Number, default: 0 },
    totalGeneral: { type: Number, default: 0 },
    iva: { type: Number, default: 0 },
    pdfUrl: { type: String, default: "" },
    contificoResponse: { type: Schema.Types.Mixed, default: {} },
    estado: {
      type: String,
      enum: ["pendiente", "verificando", "pagada", "cancelada"],
      default: "pendiente",
    },
    referenciaPago: { type: String, default: "" },
    comprobanteUrl: { type: String, default: "" },
    pagadaEn: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

facturaSchema.index({ masterClienteId: 1 });
facturaSchema.index({ estado: 1 });
facturaSchema.index({ numeroFactura: 1 });

export const Factura = mongoose.model<IFactura>("Factura", facturaSchema);
