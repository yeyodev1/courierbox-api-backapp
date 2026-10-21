import mongoose, { Document, Schema, Types } from "mongoose";

/** Tipos con los que arranca la libreta; gerencia puede cambiarlos (Configuracion `cuentasCobrar.tipos`). */
export const TIPOS_CUENTA_COBRAR_INICIALES = [
  { valor: "courier", etiqueta: "Courier" },
  { valor: "venta", etiqueta: "Venta" },
  { valor: "gdc", etiqueta: "GDC" },
  { valor: "otros", etiqueta: "Otros" },
];

export interface IAbonoCuentaCobrar {
  _id: Types.ObjectId;
  /** YYYY-MM-DD, hora de Ecuador. */
  fecha: string;
  monto: number;
  nota: string;
  registradoPor: string;
  createdAt: Date;
}

/**
 * Cuentas por cobrar general: la libreta de Oscar y su secretaria. No está
 * enlazada a facturas, paquetes ni gestiones; es lo que ellos anotan a mano,
 * con sus abonos y la fecha en que hay que ir a cobrar (que dispara el correo
 * de recordatorio).
 */
export type AmbitoCuentaCobrar = "gerencia" | "asistencia";

export interface ICuentaCobrar extends Document {
  /** De quién es la libreta: la de Oscar (gerencia) o la de su asistente. */
  ambito: AmbitoCuentaCobrar;
  cliente: string;
  /** Clave de uno de los tipos configurados. */
  tipo: string;
  monto: number;
  /** Cuándo debía pagar el cliente (YYYY-MM-DD). Pasada y con saldo = atrasada. */
  fechaPago: string;
  /** Cuándo hay que gestionar el cobro (YYYY-MM-DD): ese día llega el correo. */
  fechaCobro: string;
  asesor: string;
  notas: string;
  abonos: Types.DocumentArray<IAbonoCuentaCobrar & Document>;
  creadoPor: string;
  actualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const abonoSchema = new Schema<IAbonoCuentaCobrar>(
  {
    fecha: { type: String, required: true, match: FECHA },
    monto: { type: Number, required: true, min: 0.01 },
    nota: { type: String, default: "", trim: true },
    registradoPor: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const cuentaCobrarSchema = new Schema<ICuentaCobrar>(
  {
    // Las cuentas viejas no traen el campo: se tratan como de gerencia.
    ambito: { type: String, enum: ["gerencia", "asistencia"], default: "gerencia", index: true },
    cliente: { type: String, required: true, trim: true },
    tipo: { type: String, default: "courier", trim: true },
    monto: { type: Number, required: true, min: 0 },
    fechaPago: { type: String, default: "", validate: (v: string) => !v || FECHA.test(v) },
    fechaCobro: { type: String, default: "", validate: (v: string) => !v || FECHA.test(v) },
    asesor: { type: String, default: "", trim: true },
    notas: { type: String, default: "", trim: true },
    abonos: { type: [abonoSchema], default: [] },
    creadoPor: { type: String, default: "" },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "cuentas_cobrar" }
);

cuentaCobrarSchema.index({ fechaCobro: 1 });
cuentaCobrarSchema.index({ fechaPago: 1 });

export const CuentaCobrar = mongoose.model<ICuentaCobrar>("CuentaCobrar", cuentaCobrarSchema);
