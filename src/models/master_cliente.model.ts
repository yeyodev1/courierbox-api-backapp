import mongoose, { Document, Schema } from "mongoose";

export interface IMasterCliente extends Document {
  codigoCasillero: string;
  cedulaRuc: string;
  nombreOficial: string;
  email: string;
  telefono: string;
  subagencyId: string;
  notas: string;
  createdAt: Date;
  updatedAt: Date;
}

const masterClienteSchema = new Schema<IMasterCliente>(
  {
    codigoCasillero: { type: String, required: true, unique: true, uppercase: true, trim: true },
    cedulaRuc: { type: String, default: "" },
    nombreOficial: { type: String, required: true },
    email: { type: String, default: "" },
    telefono: { type: String, default: "" },
    subagencyId: { type: String, default: "" },
    notas: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

masterClienteSchema.index({ cedulaRuc: 1 });
masterClienteSchema.index({ nombreOficial: "text" });

export const MasterCliente = mongoose.model<IMasterCliente>("MasterCliente", masterClienteSchema);
