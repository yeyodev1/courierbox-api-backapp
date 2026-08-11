import mongoose, { Schema, type Document } from "mongoose";

/**
 * A purchase request a client submits themselves from the public site.
 *
 * Deliberately separate from GestionCompra: that model requires an `asesorId`
 * and a `contactoId`, which a public visitor has neither of. Forcing one would
 * mean inventing an advisor and a contact for every stranger who fills the
 * form. A solicitud is the intake record; an advisor converts it into a real
 * GestionCompra once they pick it up.
 */

export type SolicitudEstado = "nueva" | "contactada" | "convertida" | "descartada";

export const SOLICITUD_ESTADOS: SolicitudEstado[] = [
  "nueva",
  "contactada",
  "convertida",
  "descartada",
];

export interface ISolicitudItem {
  url: string;
  titulo: string;
  cantidad: number;
  valorProducto: number;
  valorEnvio: number;
  notas: string;
}

export interface ISolicitudCompra extends Document {
  clienteNombre: string;
  clienteEmail: string;
  clienteTelefono: string;
  clienteCedula: string;
  codigoCasillero: string;

  items: ISolicitudItem[];
  /** Products + their US shipping, before our fee. */
  subtotal: number;
  comisionEstimada: number;
  totalEstimado: number;
  /** How the fee was worked out, so the quote can be explained later. */
  comisionDetalle: string;
  feeConfigId?: mongoose.Types.ObjectId;

  estado: SolicitudEstado;
  notasInternas: string;
  atendidaPor?: mongoose.Types.ObjectId;
  gestionCompraId?: mongoose.Types.ObjectId;

  /** Kept for abuse triage on a public, unauthenticated endpoint. */
  origenIp: string;
  createdAt: Date;
  updatedAt: Date;
}

const solicitudItemSchema = new Schema<ISolicitudItem>(
  {
    url: { type: String, required: true, trim: true },
    titulo: { type: String, default: "", trim: true },
    cantidad: { type: Number, default: 1, min: 1 },
    valorProducto: { type: Number, default: 0, min: 0 },
    valorEnvio: { type: Number, default: 0, min: 0 },
    notas: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const solicitudCompraSchema = new Schema<ISolicitudCompra>(
  {
    clienteNombre: { type: String, required: true, trim: true },
    clienteEmail: { type: String, default: "", trim: true, lowercase: true },
    clienteTelefono: { type: String, default: "", trim: true },
    clienteCedula: { type: String, default: "", trim: true },
    codigoCasillero: { type: String, default: "", trim: true, uppercase: true },

    items: { type: [solicitudItemSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    comisionEstimada: { type: Number, default: 0, min: 0 },
    totalEstimado: { type: Number, default: 0, min: 0 },
    comisionDetalle: { type: String, default: "" },
    feeConfigId: { type: Schema.Types.ObjectId, ref: "FeeConfig" },

    estado: { type: String, enum: SOLICITUD_ESTADOS, default: "nueva" },
    notasInternas: { type: String, default: "" },
    atendidaPor: { type: Schema.Types.ObjectId, ref: "User" },
    gestionCompraId: { type: Schema.Types.ObjectId, ref: "GestionCompra" },

    origenIp: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

solicitudCompraSchema.index({ estado: 1, createdAt: -1 });
solicitudCompraSchema.index({ clienteEmail: 1 });
solicitudCompraSchema.index({ createdAt: -1 });

export const SolicitudCompra = mongoose.model<ISolicitudCompra>(
  "SolicitudCompra",
  solicitudCompraSchema
);
