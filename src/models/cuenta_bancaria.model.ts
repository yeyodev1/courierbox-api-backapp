import { Schema, model, Document } from "mongoose";

export interface ICuentaBancaria extends Document {
  banco: string;
  numeroCuenta: string;
  titular: string;
  tipoCuenta: "corriente" | "ahorros";
  activa: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CuentaBancariaSchema = new Schema<ICuentaBancaria>(
  {
    banco: { type: String, required: true, trim: true },
    numeroCuenta: { type: String, required: true, trim: true },
    titular: { type: String, required: true, trim: true },
    tipoCuenta: { type: String, enum: ["corriente", "ahorros"], default: "corriente" },
    activa: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const CuentaBancaria = model<ICuentaBancaria>("CuentaBancaria", CuentaBancariaSchema);
