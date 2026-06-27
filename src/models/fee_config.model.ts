import mongoose, { Document, Schema } from "mongoose";

export type FeeRuleType = "fixed" | "percentage" | "fixed_plus_percentage" | "tiered";

export interface IFeeTier {
  from: number;
  to: number;
  fixedAmount?: number;
  percentage?: number;
}

export interface IFeeConfig extends Document {
  name: string;
  isDefault: boolean;
  currency: string;
  ruleType: FeeRuleType;
  fixedAmount?: number;
  percentage?: number;
  minAmount?: number;
  maxAmount?: number;
  tiers?: IFeeTier[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const feeTierSchema = new Schema<IFeeTier>(
  {
    from: { type: Number, required: true, default: 0 },
    to: { type: Number, required: true },
    fixedAmount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
  },
  { _id: false }
);

const feeConfigSchema = new Schema<IFeeConfig>(
  {
    name: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    currency: { type: String, default: "USD" },
    ruleType: {
      type: String,
      enum: ["fixed", "percentage", "fixed_plus_percentage", "tiered"],
      required: true,
      default: "fixed_plus_percentage",
    },
    fixedAmount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    minAmount: { type: Number, default: 0 },
    maxAmount: { type: Number, default: 0 },
    tiers: { type: [feeTierSchema], default: [] },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

feeConfigSchema.index({ isDefault: 1 });

export const FeeConfig = mongoose.model<IFeeConfig>("FeeConfig", feeConfigSchema);
