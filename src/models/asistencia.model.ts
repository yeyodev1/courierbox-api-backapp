import mongoose, { Document, Schema } from "mongoose";

/**
 * Módulo de asistencia: lo que maneja la asistente de gerencia desde el módulo
 * de gerencia (pendientes, clientes con tarifas, bitácora y recordatorios a
 * Oscar). Su libreta de cuentas por cobrar vive en `cuentas_cobrar` con
 * `ambito: "asistencia"`.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaOpcional = { type: String, default: "", validate: (v: string) => !v || FECHA.test(v) };

// ——— Pendientes (como cuentas por cobrar, pero de tareas) ———

export interface IPendienteAsistencia extends Document {
  titulo: string;
  detalle: string;
  /** Cuándo hay que hacerlo (YYYY-MM-DD). Pasada y sin hacer = atrasado. */
  fechaEjecucion: string;
  /** Cuándo llega el recordatorio por correo (YYYY-MM-DD). */
  fechaRecordatorio: string;
  hecho: boolean;
  /** YYYY-MM-DD en que se marcó hecho. */
  hechoEn: string;
  creadoPor: string;
  actualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const pendienteSchema = new Schema<IPendienteAsistencia>(
  {
    titulo: { type: String, required: true, trim: true },
    detalle: { type: String, default: "", trim: true },
    fechaEjecucion: fechaOpcional,
    fechaRecordatorio: fechaOpcional,
    hecho: { type: Boolean, default: false },
    hechoEn: { type: String, default: "" },
    creadoPor: { type: String, default: "" },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "pendientes_asistencia" }
);

pendienteSchema.index({ hecho: 1, fechaEjecucion: 1 });
pendienteSchema.index({ fechaRecordatorio: 1 });

export const PendienteAsistencia = mongoose.model<IPendienteAsistencia>("PendienteAsistencia", pendienteSchema);

// ——— Clientes con sus tarifas ———

export interface IClienteAsistencia extends Document {
  nombre: string;
  /** Tarifas por libra en USD; null = sin definir. */
  tarifaEstandar: number | null;
  tarifaExpress: number | null;
  tarifaCboxExpress: number | null;
  observaciones: string;
  paquetesEnCurso: boolean;
  creadoPor: string;
  actualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const clienteSchema = new Schema<IClienteAsistencia>(
  {
    nombre: { type: String, required: true, trim: true },
    tarifaEstandar: { type: Number, default: null, min: 0 },
    tarifaExpress: { type: Number, default: null, min: 0 },
    tarifaCboxExpress: { type: Number, default: null, min: 0 },
    observaciones: { type: String, default: "", trim: true },
    paquetesEnCurso: { type: Boolean, default: false },
    creadoPor: { type: String, default: "" },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "clientes_asistencia" }
);

clienteSchema.index({ nombre: 1 });

export const ClienteAsistencia = mongoose.model<IClienteAsistencia>("ClienteAsistencia", clienteSchema);

// ——— Agenda / bitácora de apuntes ———

export interface IApunteAsistencia extends Document {
  /** Día del apunte (YYYY-MM-DD). */
  fecha: string;
  texto: string;
  creadoPor: string;
  actualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const apunteSchema = new Schema<IApunteAsistencia>(
  {
    fecha: { type: String, required: true, match: FECHA },
    texto: { type: String, required: true, trim: true },
    creadoPor: { type: String, default: "" },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "bitacora_asistencia" }
);

apunteSchema.index({ fecha: -1 });

export const ApunteAsistencia = mongoose.model<IApunteAsistencia>("ApunteAsistencia", apunteSchema);

// ——— Recordatorios a gerencia (a Oscar) ———

export interface IRecordatorioGerencia extends Document {
  mensaje: string;
  /** Día en que debe llegarle el correo a gerencia (YYYY-MM-DD). */
  fecha: string;
  enviado: boolean;
  enviadoEn: Date | null;
  creadoPor: string;
  actualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordatorioSchema = new Schema<IRecordatorioGerencia>(
  {
    mensaje: { type: String, required: true, trim: true },
    fecha: { type: String, required: true, match: FECHA },
    enviado: { type: Boolean, default: false },
    enviadoEn: { type: Date, default: null },
    creadoPor: { type: String, default: "" },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "recordatorios_gerencia" }
);

recordatorioSchema.index({ enviado: 1, fecha: 1 });

export const RecordatorioGerencia = mongoose.model<IRecordatorioGerencia>("RecordatorioGerencia", recordatorioSchema);
