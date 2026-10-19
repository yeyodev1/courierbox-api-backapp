import mongoose, { Document, Schema } from "mongoose";

/**
 * Una jornada de control gerencial (auditoría por departamento, cartera,
 * plan de cierre y acta de compromisos). Reemplaza el PDF que Oscar llenaba
 * a mano: la plantilla la arma el front de gerencia y aquí se guarda tal cual
 * se va llenando, para que la vea igual desde cualquier dispositivo.
 */
export interface IJornadaGerencial extends Document {
  titulo: string;
  /** Día de la jornada, YYYY-MM-DD en hora de Ecuador. */
  fecha: string;
  estado: "borrador" | "cerrada";
  /** El contenido completo del formulario; su forma la define el front. */
  datos: Record<string, unknown>;
  actualizadoPor: string;
}

const jornadaGerencialSchema = new Schema<IJornadaGerencial>(
  {
    titulo: { type: String, required: true, trim: true },
    fecha: { type: String, required: true, trim: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    estado: { type: String, enum: ["borrador", "cerrada"], default: "borrador" },
    datos: { type: Schema.Types.Mixed, default: {} },
    actualizadoPor: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, minimize: false, collection: "jornadas_gerenciales" }
);

export const JornadaGerencial = mongoose.model<IJornadaGerencial>("JornadaGerencial", jornadaGerencialSchema);
