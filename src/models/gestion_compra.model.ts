import { Schema, model, Document, Types } from "mongoose";
import crypto from "crypto";

export type GestionCompraEstado = "borrador" | "activa" | "completado" | "cancelado";
export type GestionCompraStage = "solicitada" | "revisando" | "comprada" | "en_transito" | "entregada";
export type GestionCompraPagoEstado = "pendiente" | "verificando" | "parcial" | "confirmado" | "rechazado" | "reembolsado";
export type AbonoMetodo = "efectivo" | "transferencia" | "tarjeta" | "deposito" | "otro";
export type GestionCompraCompraEstado = "pendiente" | "asignada" | "comprando" | "comprada" | "cancelada";
export type GestionCompraBodegaEstado = "pendiente" | "recibida" | "preparando_despacho" | "despachada";
export type GestionCompraEntregaEstado = "sin_envio" | "pendiente" | "asignada" | "en_ruta" | "entregada" | "fallida" | "reprogramada";

export interface IGestionProducto {
  tienda: string;
  enlace: string;
  descripcion: string;
  cantidad: number;
  variante?: string;
  valorUnitario: number;
  valorEnvio: number;
  peso?: number;
  trackingUsa?: string;
  numeroOrden?: string;
}

export interface IAuditEntryGC {
  timestamp: Date;
  action: string;
  userId: string;
  userName: string;
  notes?: string;
}

/**
 * A payment against the balance. The screen only knew how to confirm a payment
 * once — a second one had nowhere to go, so a client who paid a deposit and then
 * settled up left the gestión reading as if the deposit were the whole thing, and
 * "cuánto me deben por gestiones de compra" could not be answered from the data.
 *
 * Each abono is kept whole, with who took it and when, rather than being folded
 * into a running total: the total is recoverable from the entries, the entries
 * are not recoverable from the total.
 */
export interface IGestionAbono {
  _id: Types.ObjectId;
  monto: number;
  fecha: Date;
  metodo: AbonoMetodo;
  referencia?: string;
  notas?: string;
  registradoPor: Types.ObjectId;
  registradoPorNombre: string;
  createdAt: Date;
}

export interface IGestionCompraFoto {
  url: string;
  title?: string;
  createdAt: Date;
}

export interface IGestionCompra extends Document {
  asesorId: Types.ObjectId;
  contactoId: Types.ObjectId;
  compradorAsignadoId?: Types.ObjectId;
  tipoServicio: "logistica" | "compra_total";
  prioridad: "normal" | "alta" | "urgente";
  fechaLimiteCompra?: Date;
  productos: IGestionProducto[];

  // Financials — solo admin puede editar post-creación
  valorTotal: number;
  valorReserva: number;
  valorPagado: number;
  abonos: IGestionAbono[];
  cuentaBancariaId?: Types.ObjectId;
  reservaConfirmada: boolean;
  costoVenta: number;
  valorComision: number;
  feeConfigId?: Types.ObjectId;
  estadoPago: GestionCompraPagoEstado;
  pagoConfirmadoEn?: Date;
  pagoConfirmadoPor?: Types.ObjectId;
  comprobantePagoUrl?: string;

  // Purchase details
  paginaCompra: string;
  fechaEntregaTentativa: Date;
  imagenCompraUrl?: string;
  fotosRelacionadas: IGestionCompraFoto[];
  stage: GestionCompraStage;
  estadoCompra: GestionCompraCompraEstado;
  estadoBodega: GestionCompraBodegaEstado;
  estadoEntrega: GestionCompraEntregaEstado;

  // Lifecycle
  estado: GestionCompraEstado;

  // Notification
  viewToken: string;
  viewTokenExpiresAt: Date;
  notificacionEnviada: boolean;

  notas?: string;
  auditLog: IAuditEntryGC[];
  legacyPurchaseOrderId?: Types.ObjectId;
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

const AbonoSchema = new Schema<IGestionAbono>(
  {
    monto: { type: Number, required: true, min: 0.01 },
    fecha: { type: Date, required: true, default: () => new Date() },
    metodo: {
      type: String,
      enum: ["efectivo", "transferencia", "tarjeta", "deposito", "otro"],
      default: "transferencia",
    },
    referencia: { type: String, trim: true },
    notas: { type: String, trim: true },
    registradoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    registradoPorNombre: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const GestionProductoSchema = new Schema<IGestionProducto>(
  {
    tienda: { type: String, required: true, trim: true },
    enlace: { type: String, default: "", trim: true },
    descripcion: { type: String, required: true, trim: true },
    cantidad: { type: Number, default: 1, min: 1 },
    variante: { type: String, trim: true },
    valorUnitario: { type: Number, default: 0, min: 0 },
    valorEnvio: { type: Number, default: 0, min: 0 },
    peso: { type: Number, min: 0 },
    trackingUsa: { type: String, trim: true },
    numeroOrden: { type: String, trim: true },
  },
  { _id: true }
);

const GestionCompraSchema = new Schema<IGestionCompra>(
  {
    asesorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    contactoId: { type: Schema.Types.ObjectId, ref: "Contacto", required: true },
    compradorAsignadoId: { type: Schema.Types.ObjectId, ref: "User" },
    tipoServicio: { type: String, enum: ["logistica", "compra_total"], default: "compra_total" },
    prioridad: { type: String, enum: ["normal", "alta", "urgente"], default: "normal" },
    fechaLimiteCompra: { type: Date },
    productos: { type: [GestionProductoSchema], default: [] },

    valorTotal: { type: Number, required: true, min: 0 },
    valorReserva: { type: Number, required: true, min: 0, default: 0 },
    valorPagado: { type: Number, required: true, min: 0, default: 0 },
    abonos: { type: [AbonoSchema], default: [] },
    cuentaBancariaId: { type: Schema.Types.ObjectId, ref: "CuentaBancaria" },
    reservaConfirmada: { type: Boolean, default: false },
    costoVenta: { type: Number, required: true, min: 0, default: 0 },
    valorComision: { type: Number, required: true, min: 0, default: 0 },
    feeConfigId: { type: Schema.Types.ObjectId, ref: "FeeConfig" },
    estadoPago: {
      type: String,
      enum: ["pendiente", "verificando", "parcial", "confirmado", "rechazado", "reembolsado"],
      default: "pendiente",
    },
    pagoConfirmadoEn: { type: Date },
    pagoConfirmadoPor: { type: Schema.Types.ObjectId, ref: "User" },
    comprobantePagoUrl: { type: String, trim: true },

    paginaCompra: { type: String, required: true, trim: true },
    fechaEntregaTentativa: { type: Date, required: true },
    imagenCompraUrl: { type: String, trim: true },
    fotosRelacionadas: {
      type: [
        new Schema<IGestionCompraFoto>(
          {
            url: { type: String, required: true, trim: true },
            title: { type: String, trim: true },
            createdAt: { type: Date, default: () => new Date() },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    stage: {
      type: String,
      enum: ["solicitada", "revisando", "comprada", "en_transito", "entregada"],
      default: "solicitada",
    },
    estadoCompra: {
      type: String,
      enum: ["pendiente", "asignada", "comprando", "comprada", "cancelada"],
      default: "pendiente",
    },
    estadoBodega: {
      type: String,
      enum: ["pendiente", "recibida", "preparando_despacho", "despachada"],
      default: "pendiente",
    },
    estadoEntrega: {
      type: String,
      enum: ["sin_envio", "pendiente", "asignada", "en_ruta", "entregada", "fallida", "reprogramada"],
      default: "sin_envio",
    },

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
    viewTokenExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      index: true,
    },
    notificacionEnviada: { type: Boolean, default: false },

    notas: { type: String, trim: true },
    auditLog: { type: [AuditEntrySchema], default: [] },
    legacyPurchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" },
  },
  { timestamps: true }
);

GestionCompraSchema.index({ asesorId: 1, createdAt: -1 });
GestionCompraSchema.index({ estado: 1 });
GestionCompraSchema.index({ viewToken: 1 }, { unique: true });
GestionCompraSchema.index({ contactoId: 1 });
GestionCompraSchema.index({ createdAt: 1 }); // for monthly stats
GestionCompraSchema.index({ legacyPurchaseOrderId: 1 }, { unique: true, sparse: true });
GestionCompraSchema.index({ estadoPago: 1, createdAt: -1 });
GestionCompraSchema.index({ estadoCompra: 1, prioridad: 1, createdAt: -1 });

export const GestionCompra = model<IGestionCompra>("GestionCompra", GestionCompraSchema);
