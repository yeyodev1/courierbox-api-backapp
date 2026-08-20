import mongoose, { Schema, type Document } from "mongoose";

export type MetodoEntrega = "envio" | "retiro_oficina";
export const METODOS_ENTREGA: MetodoEntrega[] = ["envio", "retiro_oficina"];

export type PrecioModo = "automatico" | "manual";

/** One scheduled installment when the sale is sold on credit (abono + saldo). */
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
  pagoConfirmado: boolean;
  subtotal: number;
  total: number;
  esCredito: boolean;
  abono: number;
  saldo: number;
  cuotas: ICuotaCredito[];
  observacion: string;
  correoAdminEnviado: boolean;
  correoClienteEnviado: boolean;
  creadoPor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

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
    saldo: { type: Number, default: 0, min: 0 },
    cuotas: { type: [cuotaSchema], default: [] },
    observacion: { type: String, default: "" },
    correoAdminEnviado: { type: Boolean, default: false },
    correoClienteEnviado: { type: Boolean, default: false },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

ventaProductoSchema.index({ fecha: -1 });
ventaProductoSchema.index({ "cuotas.fecha": 1, "cuotas.pagada": 1 });

export const VentaProducto = mongoose.model<IVentaProducto>("VentaProducto", ventaProductoSchema);
