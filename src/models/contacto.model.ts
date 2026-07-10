import { Schema, model, Document, Types } from "mongoose";

export interface IContacto extends Document {
  nombre: string;
  email?: string;
  telefono?: string;
  notas?: string;
  creadoPor: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ContactoSchema = new Schema<IContacto>(
  {
    nombre: { type: String, required: true, trim: true, index: "text" },
    email: { type: String, trim: true, lowercase: true, sparse: true },
    telefono: { type: String, trim: true },
    notas: { type: String, trim: true },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ContactoSchema.index({ nombre: "text", email: "text", telefono: "text" });
ContactoSchema.index({ email: 1 }, { sparse: true });

export const Contacto = model<IContacto>("Contacto", ContactoSchema);
