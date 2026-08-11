import mongoose, { Schema, type Document } from "mongoose";

/**
 * A counter pickup: one digital signature that releases every package the
 * client is taking in that visit. Replaces the loose paper slips the counter
 * used to file per package.
 */

export interface IRetiroItem {
  paqueteId?: mongoose.Types.ObjectId;
  gestionCompraId?: mongoose.Types.ObjectId;
  envioDomicilioId?: mongoose.Types.ObjectId;
  /** Denormalised so the receipt stays readable even if the source moves on. */
  referencia: string;
  descripcion: string;
  pesoLb: number;
  valor: number;
}

export interface IRetiroCounter extends Document {
  masterClienteId?: mongoose.Types.ObjectId;
  contactoId?: mongoose.Types.ObjectId;
  clienteNombre: string;
  clienteIdentificacion: string;
  clienteEmail: string;
  clienteTelefono: string;
  codigoCasillero: string;

  items: IRetiroItem[];
  totalPaquetes: number;
  totalPesoLb: number;
  totalValor: number;

  /** Whoever physically collected — not always the account holder. */
  retiradoPorNombre: string;
  retiradoPorCedula: string;
  retiradoPorParentesco: string;

  firmaUrl: string;
  firmaPublicId: string;
  comprobanteUrl: string;
  comprobantePublicId: string;

  observaciones: string;
  estado: "firmado" | "anulado";
  anuladoMotivo: string;
  anuladoPor?: mongoose.Types.ObjectId;
  anuladoEn?: Date;

  atendidoPor: mongoose.Types.ObjectId;
  atendidoPorNombre: string;
  firmadoEn: Date;
  createdAt: Date;
  updatedAt: Date;
}

const retiroItemSchema = new Schema<IRetiroItem>(
  {
    paqueteId: { type: Schema.Types.ObjectId, ref: "Paquete" },
    gestionCompraId: { type: Schema.Types.ObjectId, ref: "GestionCompra" },
    envioDomicilioId: { type: Schema.Types.ObjectId, ref: "EnvioDomicilio" },
    referencia: { type: String, default: "" },
    descripcion: { type: String, default: "" },
    pesoLb: { type: Number, default: 0, min: 0 },
    valor: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const retiroCounterSchema = new Schema<IRetiroCounter>(
  {
    masterClienteId: { type: Schema.Types.ObjectId, ref: "MasterCliente" },
    contactoId: { type: Schema.Types.ObjectId, ref: "Contacto" },
    clienteNombre: { type: String, required: true, trim: true },
    clienteIdentificacion: { type: String, default: "", trim: true },
    clienteEmail: { type: String, default: "", trim: true, lowercase: true },
    clienteTelefono: { type: String, default: "", trim: true },
    codigoCasillero: { type: String, default: "", trim: true },

    items: { type: [retiroItemSchema], default: [] },
    totalPaquetes: { type: Number, default: 0, min: 0 },
    totalPesoLb: { type: Number, default: 0, min: 0 },
    totalValor: { type: Number, default: 0, min: 0 },

    retiradoPorNombre: { type: String, default: "", trim: true },
    retiradoPorCedula: { type: String, default: "", trim: true },
    retiradoPorParentesco: { type: String, default: "", trim: true },

    firmaUrl: { type: String, default: "" },
    firmaPublicId: { type: String, default: "" },
    comprobanteUrl: { type: String, default: "" },
    comprobantePublicId: { type: String, default: "" },

    observaciones: { type: String, default: "" },
    estado: { type: String, enum: ["firmado", "anulado"], default: "firmado" },
    anuladoMotivo: { type: String, default: "" },
    anuladoPor: { type: Schema.Types.ObjectId, ref: "User" },
    anuladoEn: { type: Date },

    atendidoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    atendidoPorNombre: { type: String, default: "" },
    firmadoEn: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false }
);

retiroCounterSchema.index({ masterClienteId: 1, firmadoEn: -1 });
retiroCounterSchema.index({ clienteIdentificacion: 1, firmadoEn: -1 });
retiroCounterSchema.index({ firmadoEn: -1 });
retiroCounterSchema.index({ estado: 1, firmadoEn: -1 });
// A package can only be released once, unless the retiro was voided.
retiroCounterSchema.index(
  { "items.paqueteId": 1 },
  { partialFilterExpression: { estado: "firmado" } }
);

export const RetiroCounter = mongoose.model<IRetiroCounter>("RetiroCounter", retiroCounterSchema);
