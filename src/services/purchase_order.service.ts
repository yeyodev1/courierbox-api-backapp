import { models } from "../models/index.js";
import { calculateFee } from "./fee.service.js";
import type { IPurchaseOrder } from "../models/purchase_order.model.js";

export interface CreateOrderInput {
  asesorId: string;
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
  notes?: string;
  configId?: string;
  manualFeeAmount?: number;
  manualTotalAmount?: number;
}

export async function createPurchaseOrder(input: CreateOrderInput): Promise<IPurchaseOrder> {
  let feeResult: Awaited<ReturnType<typeof calculateFee>>;

  const manualFeeAmount = input.manualFeeAmount;
  const manualTotalAmount = input.manualTotalAmount;
  const useManualFee =
    typeof manualFeeAmount === "number" &&
    typeof manualTotalAmount === "number" &&
    manualTotalAmount >= 0;

  if (useManualFee) {
    feeResult = {
      baseAmount: parseFloat((input.productValue + input.shippingValue).toFixed(2)),
      feeAmount: parseFloat(manualFeeAmount.toFixed(2)),
      totalAmount: parseFloat(manualTotalAmount.toFixed(2)),
      configName: "Manual",
      ruleType: "manual",
      currency: "USD",
      breakdown: "Fee ingresado manualmente por el asesor.",
    };
  } else {
    feeResult = await calculateFee({
      productValue: input.productValue,
      shippingValue: input.shippingValue,
      configId: input.configId,
    });
  }

  const order = await models.purchaseOrders.create({
    asesorId: input.asesorId,
    clientName: input.clientName,
    clientPhone: input.clientPhone || "",
    clientEmail: input.clientEmail || "",
    storeName: input.storeName,
    productUrl: input.productUrl || "",
    description: input.description,
    productValue: input.productValue,
    shippingValue: input.shippingValue,
    weightLb: input.weightLb || 0,
    trackingUsa: input.trackingUsa || "",
    feeAmount: feeResult.feeAmount,
    feeRuleApplied: `${feeResult.configName} (${feeResult.ruleType})`,
    totalAmount: feeResult.totalAmount,
    currency: feeResult.currency,
    status: "borrador",
    paymentStatus: "pendiente",
    notes: input.notes || "",
  });

  return order;
}

export async function listPurchaseOrders(filters: {
  asesorId?: string;
  status?: string;
  paymentStatus?: string;
  limit?: number;
  offset?: number;
}): Promise<{ orders: IPurchaseOrder[]; total: number }> {
  const query: Record<string, any> = {};
  if (filters.asesorId) query.asesorId = filters.asesorId;
  if (filters.status) query.status = filters.status;
  if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [orders, total] = await Promise.all([
    models.purchaseOrders
      .find(query)
      .populate("asesorId", "name email")
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    models.purchaseOrders.countDocuments(query),
  ]);

  return { orders: orders as unknown as IPurchaseOrder[], total };
}

export async function getPurchaseOrderById(id: string): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders.findById(id).populate("asesorId", "name email").lean() as Promise<IPurchaseOrder | null>;
}

export async function updateOrderStatus(
  id: string,
  status: IPurchaseOrder["status"],
  adminNotes?: string
): Promise<IPurchaseOrder | null> {
  const update: Record<string, any> = { status };
  if (adminNotes !== undefined) update.adminNotes = adminNotes;
  return models.purchaseOrders
    .findByIdAndUpdate(id, { $set: update }, { new: true })
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function updatePaymentStatus(
  id: string,
  paymentStatus: IPurchaseOrder["paymentStatus"],
  adminNotes?: string
): Promise<IPurchaseOrder | null> {
  const update: Record<string, any> = { paymentStatus };
  if (paymentStatus === "pagado") update.paidAt = new Date();
  if (adminNotes !== undefined) update.adminNotes = adminNotes;
  return models.purchaseOrders
    .findByIdAndUpdate(id, { $set: update }, { new: true })
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function attachTransferProof(
  id: string,
  proofUrl: string,
  reference?: string,
  notes?: string
): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders
    .findByIdAndUpdate(
      id,
      {
        $set: {
          transferProofUrl: proofUrl,
          transferReference: reference || "",
          transferNotes: notes || "",
          paymentStatus: "verificando",
        },
      },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function attachPaymentLink(
  id: string,
  paymentLink: string,
  paymentId: string
): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders
    .findByIdAndUpdate(
      id,
      { $set: { paymentLinkUrl: paymentLink, paymentId } },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function getAsesorStats(asesorId?: string): Promise<{
  totalOrders: number;
  pendingPayment: number;
  totalSold: number;
  recentOrders: IPurchaseOrder[];
}> {
  const query: Record<string, any> = {};
  if (asesorId) query.asesorId = asesorId;

  const [totalOrders, pendingPayment, totalSoldAgg, recentOrders] = await Promise.all([
    models.purchaseOrders.countDocuments(query),
    models.purchaseOrders.countDocuments({ ...query, paymentStatus: { $in: ["pendiente", "verificando"] } }),
    models.purchaseOrders.aggregate([
      { $match: { ...query, paymentStatus: "pagado" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    models.purchaseOrders
      .find(query)
      .populate("asesorId", "name email")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  return {
    totalOrders,
    pendingPayment,
    totalSold: totalSoldAgg[0]?.total || 0,
    recentOrders: recentOrders as unknown as IPurchaseOrder[],
  };
}
