import mongoose, { Document, Schema } from "mongoose";

/**
 * Courier Box y los couriers aliados a los que les recibe carga (Gracia Box,
 * AVC, Sunset…). Cada uno define cómo sale su etiqueta 4×6 y, si tiene precio
 * especial, cuánto se le cobra por libra. La bodega los administra sin
 * despliegues: si llega un aliado nuevo, se crea aquí.
 */
export interface IAliado extends Document {
  /** Clave estable en mayúsculas (GRACIABOX); la usan las etiquetas. */
  codigo: string;
  nombre: string;
  /** Lo que va en el encabezado de la etiqueta cuando no hay logo. */
  marca: string;
  logoUrl: string;
  /** Líneas del pie, de izquierda a derecha. */
  pie: string[];
  lema: string;
  barrasAbajo: boolean;
  rotuloTracking: string;
  /** Textos que, apareciendo en la AGENCIA del manifiesto, identifican al aliado. */
  coincidencias: string[];
  /** null = la tarifa base de Courier Box. */
  tarifaFleteLb: number | null;
  tarifaArancelLb: number | null;
  /** Courier Box: la etiqueta y la tarifa de toda caja que no es de un aliado. */
  principal: boolean;
  activo: boolean;
  orden: number;
  actualizadoPor: string;
}

const aliadoSchema = new Schema<IAliado>(
  {
    codigo: { type: String, required: true, unique: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    marca: { type: String, default: "", trim: true },
    logoUrl: { type: String, default: "" },
    pie: { type: [String], default: [] },
    lema: { type: String, default: "", trim: true },
    barrasAbajo: { type: Boolean, default: false },
    rotuloTracking: { type: String, default: "", trim: true },
    coincidencias: { type: [String], default: [] },
    tarifaFleteLb: { type: Number, default: null },
    tarifaArancelLb: { type: Number, default: null },
    principal: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 100 },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

export const Aliado = mongoose.model<IAliado>("Aliado", aliadoSchema);
