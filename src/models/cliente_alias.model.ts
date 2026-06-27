import mongoose, { Document, Schema } from "mongoose";

export interface IClienteAlias extends Document {
  masterId: mongoose.Types.ObjectId;
  variacion: string;
  ultimaVezVisto: Date;
  createdAt: Date;
  updatedAt: Date;
}

const clienteAliasSchema = new Schema<IClienteAlias>(
  {
    masterId: { type: Schema.Types.ObjectId, ref: "MasterCliente", required: true },
    variacion: { type: String, required: true },
    ultimaVezVisto: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

clienteAliasSchema.index({ masterId: 1 });
clienteAliasSchema.index({ variacion: "text" });

export const ClienteAlias = mongoose.model<IClienteAlias>("ClienteAlias", clienteAliasSchema);
