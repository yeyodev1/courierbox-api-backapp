import mongoose, { Schema, type Document } from "mongoose";

/**
 * A product the company keeps in stock and resells. Prices, cost and
 * commission are fed here once, then reused when registering a sale so the
 * seller only has to pick the product.
 */
export interface IProductoInventario extends Document {
  nombre: string;
  /** Retail unit price. */
  precio: number;
  /** Wholesale unit price. */
  precioMayorista: number;
  /** Unit cost — internal, never shown to the client. */
  costo: number;
  /** Commission earned per unit — internal, never shown to the client. */
  comision: number;
  stock: number;
  activo: boolean;
  notas: string;
  creadoPor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productoInventarioSchema = new Schema<IProductoInventario>(
  {
    nombre: { type: String, required: true, trim: true },
    precio: { type: Number, default: 0, min: 0 },
    precioMayorista: { type: Number, default: 0, min: 0 },
    costo: { type: Number, default: 0, min: 0 },
    comision: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0 },
    activo: { type: Boolean, default: true, index: true },
    notas: { type: String, default: "" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

productoInventarioSchema.index({ nombre: "text" });

export const ProductoInventario = mongoose.model<IProductoInventario>(
  "ProductoInventario",
  productoInventarioSchema
);
