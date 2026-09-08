import mongoose, { Document, Schema } from "mongoose";

/** Ajustes globales del sistema, uno por clave (por ejemplo el IVA vigente). */
export interface IConfiguracion extends Document {
  clave: string;
  valor: unknown;
  actualizadoPor: string;
  updatedAt: Date;
}

const configuracionSchema = new Schema<IConfiguracion>(
  {
    clave: { type: String, required: true, unique: true, trim: true },
    valor: { type: Schema.Types.Mixed, default: null },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

export const Configuracion = mongoose.model<IConfiguracion>("Configuracion", configuracionSchema);
