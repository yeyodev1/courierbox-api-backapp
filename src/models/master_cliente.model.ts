import mongoose, { Document, Schema } from "mongoose";

/**
 * Otros datos a los que un cliente puede pedir que se le facture: el RUC de
 * su empresa, un familiar, etc. Los datos "principales" del cliente son los
 * campos de arriba; estos son alternativas que elige el counter al facturar.
 */
export interface IPerfilFacturacion {
  _id: mongoose.Types.ObjectId;
  etiqueta: string;
  identificacion: string;
  razonSocial: string;
  email: string;
  telefono: string;
  direccion: string;
}

export interface IMasterCliente extends Document {
  codigoCasillero: string;
  cedulaRuc: string;
  nombreOficial: string;
  email: string;
  telefono: string;
  /** Para la factura electrónica; vacío en los clientes importados del manifiesto. */
  direccion: string;
  perfilesFacturacion: IPerfilFacturacion[];
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
    direccion: { type: String, default: "" },
    perfilesFacturacion: {
      type: [
        new Schema<IPerfilFacturacion>(
          {
            etiqueta: { type: String, default: "" },
            identificacion: { type: String, default: "" },
            razonSocial: { type: String, default: "" },
            email: { type: String, default: "" },
            telefono: { type: String, default: "" },
            direccion: { type: String, default: "" },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    subagencyId: { type: String, default: "" },
    notas: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

masterClienteSchema.index({ cedulaRuc: 1 });
masterClienteSchema.index({ nombreOficial: "text" });

export const MasterCliente = mongoose.model<IMasterCliente>("MasterCliente", masterClienteSchema);
