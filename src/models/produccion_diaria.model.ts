import mongoose, { Schema, type Document } from "mongoose";

export interface IProduccionDiaria extends Document {
  fecha: Date;
  supervisorNombre: string;
  facturado: number;
  clientesNuevos: number;
  notas: string;
  creadoPor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const produccionDiariaSchema = new Schema<IProduccionDiaria>(
  {
    fecha: { type: Date, default: Date.now },
    supervisorNombre: { type: String, default: "" },
    facturado: { type: Number, default: 0, min: 0 },
    clientesNuevos: { type: Number, default: 0, min: 0 },
    notas: { type: String, default: "" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

produccionDiariaSchema.index({ fecha: -1 });

export const ProduccionDiaria = mongoose.model<IProduccionDiaria>("ProduccionDiaria", produccionDiariaSchema);
