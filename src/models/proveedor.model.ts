import mongoose, { Schema, type Document } from "mongoose";

export interface IProveedor extends Document {
  nombre: string;
  nombreNormalizado: string;
  tipo: string;
  pais: string;
  ciudad: string;
  contacto: string;
  telefono: string;
  email: string;
  notas: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const proveedorSchema = new Schema<IProveedor>(
  {
    nombre: { type: String, required: true },
    nombreNormalizado: { type: String, required: true },
    tipo: { type: String, default: "" },
    pais: { type: String, default: "" },
    ciudad: { type: String, default: "" },
    contacto: { type: String, default: "" },
    telefono: { type: String, default: "" },
    email: { type: String, default: "" },
    notas: { type: String, default: "" },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

proveedorSchema.index({ tipo: 1 });
proveedorSchema.index({ nombre: 1 });
proveedorSchema.index({ nombreNormalizado: 1 });

export const Proveedor = mongoose.model<IProveedor>("Proveedor", proveedorSchema);
