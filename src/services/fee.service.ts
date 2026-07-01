import { models } from "../models/index";
import type { IFeeConfig, IFeeTier } from "../models/fee_config.model";

export interface CalculateFeeInput {
  productValue: number;
  shippingValue: number;
  configId?: string;
}

export interface CalculateFeeResult {
  baseAmount: number;
  feeAmount: number;
  totalAmount: number;
  configId?: string;
  configName: string;
  ruleType: string;
  currency: string;
  breakdown: string;
}

export async function getDefaultFeeConfig(): Promise<IFeeConfig | null> {
  return models.feeConfigs.findOne({ isDefault: true, enabled: true }).lean();
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (typeof min === "number" && min > 0 && result < min) result = min;
  if (typeof max === "number" && max > 0 && result > max) result = max;
  return parseFloat(result.toFixed(2));
}

function applyTier(base: number, tier: IFeeTier): number {
  let fee = tier.fixedAmount || 0;
  if (tier.percentage) {
    fee += base * (tier.percentage / 100);
  }
  return fee;
}

export function calculateFeeFromConfig(
  config: IFeeConfig,
  productValue: number,
  shippingValue: number
): CalculateFeeResult {
  const baseAmount = productValue + shippingValue;
  let feeAmount = 0;
  let breakdown = "";

  switch (config.ruleType) {
    case "fixed": {
      feeAmount = config.fixedAmount || 0;
      breakdown = `Fee fijo: $${feeAmount.toFixed(2)}`;
      break;
    }
    case "percentage": {
      const raw = baseAmount * ((config.percentage || 0) / 100);
      feeAmount = clamp(raw, config.minAmount, config.maxAmount);
      breakdown = `${config.percentage}% de $${baseAmount.toFixed(2)} = $${raw.toFixed(2)}`;
      if (config.minAmount || config.maxAmount) {
        breakdown += ` (ajustado a rango $${config.minAmount || 0} - $${config.maxAmount || "∞"})`;
      }
      break;
    }
    case "fixed_plus_percentage": {
      const pct = baseAmount * ((config.percentage || 0) / 100);
      const raw = (config.fixedAmount || 0) + pct;
      feeAmount = clamp(raw, config.minAmount, config.maxAmount);
      breakdown = `$${config.fixedAmount || 0} fijo + ${config.percentage}% de $${baseAmount.toFixed(2)} = $${raw.toFixed(2)}`;
      if (config.minAmount || config.maxAmount) {
        breakdown += ` (ajustado a rango)`;
      }
      break;
    }
    case "tiered": {
      const tiers = config.tiers || [];
      const tier = tiers.find((t) => baseAmount >= t.from && baseAmount <= t.to);
      if (tier) {
        const raw = applyTier(baseAmount, tier);
        feeAmount = clamp(raw, config.minAmount, config.maxAmount);
        breakdown = `Rango $${tier.from} - $${tier.to}: $${tier.fixedAmount || 0} + ${tier.percentage || 0}%`;
      } else {
        const last = tiers[tiers.length - 1];
        if (last) {
          feeAmount = clamp(applyTier(baseAmount, last), config.minAmount, config.maxAmount);
          breakdown = `Fuera de rango definido, aplica último rango $${last.from} - $${last.to}`;
        } else {
          feeAmount = 0;
          breakdown = "Sin rangos configurados";
        }
      }
      break;
    }
    default:
      feeAmount = 0;
      breakdown = "Tipo de fee desconocido";
  }

  feeAmount = parseFloat(feeAmount.toFixed(2));
  const totalAmount = parseFloat((baseAmount + feeAmount).toFixed(2));

  return {
    baseAmount: parseFloat(baseAmount.toFixed(2)),
    feeAmount,
    totalAmount,
    configId: config._id?.toString(),
    configName: config.name,
    ruleType: config.ruleType,
    currency: config.currency,
    breakdown,
  };
}

export async function calculateFee(input: CalculateFeeInput): Promise<CalculateFeeResult> {
  let config: IFeeConfig | null = null;
  if (input.configId) {
    config = await models.feeConfigs.findById(input.configId).lean();
  }
  if (!config) {
    config = await getDefaultFeeConfig();
  }
  if (!config) {
    // Configuración de emergencia: fee cero hasta que el admin configure.
    return {
      baseAmount: parseFloat((input.productValue + input.shippingValue).toFixed(2)),
      feeAmount: 0,
      totalAmount: parseFloat((input.productValue + input.shippingValue).toFixed(2)),
      configName: "Sin configurar",
      ruleType: "none",
      currency: "USD",
      breakdown: "El administrador aún no configura la calculadora de fees.",
    };
  }

  return calculateFeeFromConfig(config, input.productValue, input.shippingValue);
}
