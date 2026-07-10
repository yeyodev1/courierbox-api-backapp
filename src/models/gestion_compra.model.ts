import { Schema, model, Document, Types } from "mongoose";
import crypto from "crypto";

export type GestionCompraEstado = "borrador" | "activa" | "completado" | "cancelado";

export interface IAuditEntryGC {
  timestamp: Date;
  action: string;
  userId: string;
  userName: string;
  notes?: string;
}

export interface IGestionCompra extends Document {
  asesorId: Types.ObjectId;
  contactoId: Types.ObjectId;

  // Financials — solo admin puede editar post-creación
  valorTotal: number;
  valorReserva: number;
  cuentaBancariaId: Types.ObjectId;
  reservaConfirmada: boolean;
  costoVenta: number;
  valorComision: number;
  feeConfigId?: Types.ObjectId;

  // Purchase details
  paginaCompra: string;
  fechaEntregaTentativa: Date;
  imagenCompraUrl?: string;

  // Lifecycle
  estado: GestionCompraEstado;

  // Notification
  viewToken: string;
  notificacionEnviada: boolean;

  notas?: string;
  auditLog: IAuditEntryGC[];
  createdAt: Date;
  updatedAt: Date;
}

const AuditEntrySchema = new Schema<IAuditEntryGC>(
  {
    timestamp: { type: Date, default: () => new Date() },
    action: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    notes: { type: String },
  },
  { _id: false }
);

const GestionCompraSchema = new Schema<IGestionCompra>(
  {
    asesorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    contactoId: { type: Schema.Types.ObjectId, ref: "Contacto", required: true },

    valorTotal: { type: Number, required: true, min: 0 },
    valorReserva: { type: Number, required: true, min: 0, default: 0 },
    cuentaBancariaId: { type: Schema.Types.ObjectId, ref: "CuentaBancaria", required: true },
    reservaConfirmada: { type: Boolean, default: false },
    costoVenta: { type: Number, required: true, min: 0, default: 0 },
    valorComision: { type: Number, required: true, min: 0, default: 0 },
    feeConfigId: { type: Schema.Types.ObjectId, ref: "FeeConfig" },

    paginaCompra: { type: String, required: true, trim: true },
    fechaEntregaTentativa: { type: Date, required: true },
    imagenCompraUrl: { type: String, trim: true },

    estado: {
      type: String,
      enum: ["borrador", "activa", "completado", "cancelado"],
      default: "activa",
    },

    viewToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(20).toString("hex"),
    },
    notificacionEnviada: { type: Boolean, default: false },

    notas: { type: String, trim: true },
    auditLog: { type: [AuditEntrySchema], default: [] },
  },
  { timestamps: true }
);

GestionCompraSchema.index({ asesorId: 1, createdAt: -1 });
GestionCompraSchema.index({ estado: 1 });
GestionCompraSchema.index({ viewToken: 1 }, { unique: true });
GestionCompraSchema.index({ contactoId: 1 });
GestionCompraSchema.index({ createdAt: 1 }); // for monthly stats

export const GestionCompra = model<IGestionCompra>("GestionCompra", GestionCompraSchema);
