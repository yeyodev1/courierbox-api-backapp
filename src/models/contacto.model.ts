import { Schema, model, Document, Types } from "mongoose";

export interface IContacto extends Document {
  nombre: string;
  email?: string;
  telefono?: string;
  cedula?: string;
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
    cedula: { type: String, trim: true, sparse: true },
    notas: { type: String, trim: true },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ContactoSchema.index({ nombre: "text", email: "text", telefono: "text", cedula: "text" });
ContactoSchema.index({ email: 1 }, { sparse: true });
ContactoSchema.index({ telefono: 1 }, { sparse: true });
ContactoSchema.index({ cedula: 1 }, { sparse: true });

export const Contacto = model<IContacto>("Contacto", ContactoSchema);
