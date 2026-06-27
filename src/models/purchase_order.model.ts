import mongoose, { Document, Schema } from "mongoose";

export type PurchaseOrderStatus =
  | "borrador"
  | "pendiente"
  | "en_proceso"
  | "comprado"
  | "en_envio"
  | "entregado"
  | "cancelado";

export type PurchaseOrderPaymentStatus =
  | "pendiente"
  | "verificando"
  | "pagado"
  | "rechazado";

export interface IPurchaseOrder extends Document {
  asesorId: mongoose.Types.ObjectId;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  storeName: string;
  productUrl?: string;
  description: string;
  productValue: number;
  shippingValue: number;
  weightLb?: number;
  trackingUsa?: string;
  feeAmount: number;
  feeRuleApplied: string;
  totalAmount: number;
  currency: string;
  status: PurchaseOrderStatus;
  paymentStatus: PurchaseOrderPaymentStatus;
  paymentLinkUrl?: string;
  paymentId?: mongoose.Types.ObjectId;
  transferProofUrl?: string;
  transferReference?: string;
  transferNotes?: string;
  notes?: string;
  adminNotes?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    asesorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientName: { type: String, required: true, trim: true },
    clientPhone: { type: String, trim: true, default: "" },
    clientEmail: { type: String, trim: true, default: "" },
    storeName: { type: String, required: true, trim: true, default: "Amazon" },
    productUrl: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    productValue: { type: Number, required: true, min: 0, default: 0 },
    shippingValue: { type: Number, required: true, min: 0, default: 0 },
    weightLb: { type: Number, default: 0 },
    trackingUsa: { type: String, trim: true, default: "" },
    feeAmount: { type: Number, required: true, min: 0, default: 0 },
    feeRuleApplied: { type: String, required: true, default: "" },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: ["borrador", "pendiente", "en_proceso", "comprado", "en_envio", "entregado", "cancelado"],
      default: "borrador",
    },
    paymentStatus: {
      type: String,
      enum: ["pendiente", "verificando", "pagado", "rechazado"],
      default: "pendiente",
    },
    paymentLinkUrl: { type: String, default: "" },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
    transferProofUrl: { type: String, default: "" },
    transferReference: { type: String, default: "" },
    transferNotes: { type: String, default: "" },
    notes: { type: String, default: "" },
    adminNotes: { type: String, default: "" },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

purchaseOrderSchema.index({ asesorId: 1, createdAt: -1 });
purchaseOrderSchema.index({ status: 1 });
purchaseOrderSchema.index({ paymentStatus: 1 });

export const PurchaseOrder = mongoose.model<IPurchaseOrder>("PurchaseOrder", purchaseOrderSchema);
