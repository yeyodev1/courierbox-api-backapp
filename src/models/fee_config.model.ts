import mongoose, { Document, Schema } from "mongoose";

export type FeeRuleType = "fixed" | "percentage" | "fixed_plus_percentage" | "tiered";

export interface IFeeTier {
  from: number;
  to: number;
  fixedAmount?: number;
  percentage?: number;
}

/**
 * One entry per change to the tariff. Commission is money the client is quoted,
 * so "who set 8% and when, and what was it before" has to be answerable — the
 * timestamps alone only ever showed the latest value.
 */
export interface IFeeConfigCambio {
  fecha: Date;
  userId?: mongoose.Types.ObjectId;
  userName: string;
  accion: "creada" | "editada" | "predeterminada" | "habilitada" | "deshabilitada";
  /** The rule as it stood before this change. Empty on creation. */
  anterior?: {
    ruleType?: FeeRuleType;
    fixedAmount?: number;
    percentage?: number;
    minAmount?: number;
    maxAmount?: number;
    tiers?: IFeeTier[];
    enabled?: boolean;
  };
  /** Human-readable summary, e.g. "10% -> 8%". */
  resumen: string;
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
  historial: IFeeConfigCambio[];
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

const feeConfigCambioSchema = new Schema<IFeeConfigCambio>(
  {
    fecha: { type: Date, default: () => new Date() },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    userName: { type: String, default: "" },
    accion: {
      type: String,
      enum: ["creada", "editada", "predeterminada", "habilitada", "deshabilitada"],
      required: true,
    },
    anterior: { type: Schema.Types.Mixed },
    resumen: { type: String, default: "" },
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
    historial: { type: [feeConfigCambioSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

feeConfigSchema.index({ isDefault: 1 });

export const FeeConfig = mongoose.model<IFeeConfig>("FeeConfig", feeConfigSchema);
