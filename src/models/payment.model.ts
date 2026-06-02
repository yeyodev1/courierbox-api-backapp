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
  status: "pending" | "paid" | "canceled";
  customerEmail?: string;
  customerName?: string;
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
    status: { type: String, enum: ["pending", "paid", "canceled"], default: "pending" },
    customerEmail: { type: String },
    customerName: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
