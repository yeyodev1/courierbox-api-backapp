import mongoose, { Schema, type Document } from "mongoose";

export type MetodoEntrega = "envio" | "retiro_oficina";
export const METODOS_ENTREGA: MetodoEntrega[] = ["envio", "retiro_oficina"];

export type PrecioModo = "automatico" | "manual";

export type VentaAbonoMetodo = "efectivo" | "transferencia" | "tarjeta" | "deposito" | "otro";
export const VENTA_ABONO_METODOS: VentaAbonoMetodo[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "deposito",
  "otro",
];

/**
 * A sale is paid or it is owed, and the difference is arithmetic — not a flag.
 *
 * `pagoConfirmado` used to be the whole story for a cash sale and `abono` the
 * whole story for a credit one, both written once at the till and never
 * touched again. A sale handed over without the money reported `saldo: 0`,
 * because `saldo` only existed when `esCredito` was set, so "¿cuánto me deben
 * por ventas?" had no answer in the data and a client who came back to pay had
 * nowhere to put the second figure.
 *
 * Every sale now carries `valorPagado` and `saldo`, credit or not, and every
 * payment is an entry in `abonos` — the deposit taken at the till is simply the
 * first one. `estadoPago` follows the balance, and `pagoConfirmado` is kept in
 * step for the email templates that still read it.
 */
export type VentaEstadoPago = "pendiente" | "parcial" | "pagado";

/** One payment against a sale, kept whole: who took it, when, and how. */
export interface IVentaAbono {
  _id: mongoose.Types.ObjectId;
  monto: number;
  fecha: Date;
  metodo: VentaAbonoMetodo;
  referencia: string;
  notas: string;
  registradoPor?: mongoose.Types.ObjectId;
  registradoPorNombre: string;
  createdAt: Date;
}

/** One scheduled installment when the sale is sold on credit. */
export interface ICuotaCredito {
  fecha: Date;
  monto: number;
  pagada: boolean;
  /** Set once an in-app reminder has been raised for this date. */
  recordatorioEnviado: boolean;
}

export interface IVentaProducto extends Document {
  fecha: Date;
  vendedorNombre: string;
  vendedorId?: mongoose.Types.ObjectId;
  clienteId?: mongoose.Types.ObjectId;
  clienteNombre: string;
  clienteEmail: string;
  productoId?: mongoose.Types.ObjectId;
  productoNombre: string;
  cantidad: number;
  precioModo: PrecioModo;
  /** Applied unit price (auto from inventory, or manually overridden). */
  precioUnitario: number;
  /** Snapshots taken at sale time — internal only. */
  costoUnitario: number;
  comisionUnitaria: number;
  metodoEntrega: MetodoEntrega;
  valorEnvio: number;
  metodoPago: string;
  /** Derived from `estadoPago`; kept for the email templates that read it. */
  pagoConfirmado: boolean;
  subtotal: number;
  total: number;
  esCredito: boolean;
  /** Legacy: the deposit taken at the till. Superseded by `abonos`. */
  abono: number;
  /** Everything collected so far, across every abono. */
  valorPagado: number;
  /** `total - valorPagado`, on every sale rather than only on credit ones. */
  saldo: number;
  estadoPago: VentaEstadoPago;
  abonos: IVentaAbono[];
  pagoCompletadoEn?: Date;
  cuotas: ICuotaCredito[];
  observacion: string;
  correoAdminEnviado: boolean;
  correoClienteEnviado: boolean;
  creadoPor: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const abonoSchema = new Schema<IVentaAbono>(
  {
    monto: { type: Number, required: true, min: 0 },
    fecha: { type: Date, required: true },
    metodo: { type: String, enum: VENTA_ABONO_METODOS, default: "efectivo" },
    referencia: { type: String, default: "" },
    notas: { type: String, default: "" },
    registradoPor: { type: Schema.Types.ObjectId, ref: "User" },
    registradoPorNombre: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const cuotaSchema = new Schema<ICuotaCredito>(
  {
    fecha: { type: Date, required: true },
    monto: { type: Number, default: 0, min: 0 },
    pagada: { type: Boolean, default: false },
    recordatorioEnviado: { type: Boolean, default: false },
  },
  { _id: true }
);

const ventaProductoSchema = new Schema<IVentaProducto>(
  {
    fecha: { type: Date, default: Date.now },
    vendedorNombre: { type: String, default: "" },
    vendedorId: { type: Schema.Types.ObjectId, ref: "User" },
    clienteId: { type: Schema.Types.ObjectId, ref: "MasterCliente" },
    clienteNombre: { type: String, default: "" },
    clienteEmail: { type: String, default: "" },
    productoId: { type: Schema.Types.ObjectId, ref: "ProductoInventario" },
    productoNombre: { type: String, default: "" },
    cantidad: { type: Number, default: 1, min: 1 },
    precioModo: { type: String, enum: ["automatico", "manual"], default: "automatico" },
    precioUnitario: { type: Number, default: 0, min: 0 },
    costoUnitario: { type: Number, default: 0, min: 0 },
    comisionUnitaria: { type: Number, default: 0, min: 0 },
    metodoEntrega: { type: String, enum: METODOS_ENTREGA, default: "retiro_oficina" },
    valorEnvio: { type: Number, default: 0, min: 0 },
    metodoPago: { type: String, default: "" },
    pagoConfirmado: { type: Boolean, default: false },
    subtotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    esCredito: { type: Boolean, default: false },
    abono: { type: Number, default: 0, min: 0 },
    valorPagado: { type: Number, default: 0, min: 0 },
    saldo: { type: Number, default: 0, min: 0 },
    estadoPago: { type: String, enum: ["pendiente", "parcial", "pagado"], default: "pendiente" },
    abonos: { type: [abonoSchema], default: [] },
    pagoCompletadoEn: { type: Date },
    cuotas: { type: [cuotaSchema], default: [] },
    observacion: { type: String, default: "" },
    correoAdminEnviado: { type: Boolean, default: false },
    correoClienteEnviado: { type: Boolean, default: false },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

ventaProductoSchema.index({ fecha: -1 });
ventaProductoSchema.index({ "cuotas.fecha": 1, "cuotas.pagada": 1 });
/** Drives the "quién me debe" list without scanning the whole collection. */
ventaProductoSchema.index({ estadoPago: 1, fecha: -1 });

export const VentaProducto = mongoose.model<IVentaProducto>("VentaProducto", ventaProductoSchema);
