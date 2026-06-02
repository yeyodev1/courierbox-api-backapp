import mongoose, { Document, Schema } from "mongoose";

export interface IPayment extends Document {
  amount: number;
  amountWithoutTax: number;
  amountWithTax: number;
  tax: number;
  currency: string;
  reference: string;
  clientTransactionId: string;
  storeId: string;
  paymentLink: string;
  status: "pending" | "paid" | "approved" | "canceled";
  expiresAt?: Date;
  customerEmail?: string;
  customerName?: string;
  createdBy?: mongoose.Types.ObjectId | any;
}

const paymentSchema = new Schema<IPayment>(
  {
    amount: { type: Number, required: true },
    amountWithoutTax: { type: Number, required: true },
    amountWithTax: { type: Number, required: true },
    tax: { type: Number, required: true },
    currency: { type: String, required: true, default: "USD" },
    reference: { type: String, required: true },
    clientTransactionId: { type: String, required: true, unique: true },
    storeId: { type: String, required: true },
    paymentLink: { type: String, required: true },
    status: { type: String, enum: ["pending", "paid", "approved", "canceled"], default: "pending" },
    expiresAt: { type: Date },
    customerEmail: { type: String },
    customerName: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
