import crypto from "crypto";
import { models } from "../models/index";
import { calculateFee } from "./fee.service";
import { sendCompraConfirmacion } from "./email.service";
import type { IPurchaseOrder, ServiceType, IAuditEntry } from "../models/purchase_order.model";

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
  serviceType?: ServiceType;
}

function generateViewToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function auditEntry(action: string, userId: string, userName: string, notes: string = ""): IAuditEntry {
  return { timestamp: new Date(), action, userId, userName, notes };
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

  const viewToken = generateViewToken();
  const entry = auditEntry("creada", input.asesorId, input.clientName, "Orden creada por el asesor");

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
    serviceType: input.serviceType || "compra_total",
    status: "borrador",
    paymentStatus: "pendiente",
    notes: input.notes || "",
    viewToken,
    auditLog: [entry],
  });

  return order;
}

export async function listPurchaseOrders(filters: {
  asesorId?: string;
  status?: string;
  paymentStatus?: string;
  includeShared?: boolean;
  serviceType?: string;
  clientSearch?: string;
  limit?: number;
  offset?: number;
}): Promise<{ orders: IPurchaseOrder[]; total: number }> {
  const query: Record<string, any> = {};
  if (filters.asesorId) {
    if (filters.includeShared) {
      query.$or = [
        { asesorId: filters.asesorId },
        { "sharedWith.asesorId": filters.asesorId },
      ];
    } else {
      query.asesorId = filters.asesorId;
    }
  }
  if (filters.status) query.status = filters.status;
  if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
  if (filters.serviceType) query.serviceType = filters.serviceType;
  if (filters.clientSearch) {
    const regex = new RegExp(filters.clientSearch, "i");
    const clientQuery = {
      $or: [
        { clientName: regex },
        { clientEmail: regex },
        { clientPhone: regex },
      ],
    };
    if (query.$or) {
      query.$and = [{ $or: query.$or }, clientQuery];
      delete query.$or;
    } else {
      query.$or = clientQuery.$or;
    }
  }

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
  adminNotes?: string,
  userId?: string,
  userName?: string,
): Promise<IPurchaseOrder | null> {
  const update: Record<string, any> = { status };
  if (adminNotes !== undefined) update.adminNotes = adminNotes;

  const entry = auditEntry(
    `status_${status}`,
    userId || "",
    userName || "",
    adminNotes || `Estado cambiado a ${status}`
  );

  const order = await models.purchaseOrders
    .findByIdAndUpdate(id, { $set: update, $push: { auditLog: entry } }, { new: true })
    .populate("asesorId", "name email")
    .lean() as IPurchaseOrder | null;

  if (order && status === "comprado" && order.clientEmail) {
    sendCompraConfirmacion({
      to: order.clientEmail,
      clientName: order.clientName,
      orderId: order._id.toString(),
      storeName: order.storeName,
      description: order.description,
      totalAmount: order.totalAmount,
      trackingUsa: order.trackingUsa,
    });
  }

  return order;
}

export async function shareOrder(
  orderId: string,
  targetAsesorId: string,
  userId?: string,
  userName?: string
): Promise<IPurchaseOrder | null> {
  const entry = auditEntry("compartida", userId || "", userName || "", `Compartida con asesor ${targetAsesorId}`);

  return models.purchaseOrders
    .findByIdAndUpdate(
      orderId,
      {
        $addToSet: { sharedWith: { asesorId: targetAsesorId, sharedAt: new Date() } },
        $push: { auditLog: entry },
      },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function unshareOrder(
  orderId: string,
  targetAsesorId: string,
  userId?: string,
  userName?: string
): Promise<IPurchaseOrder | null> {
  const entry = auditEntry("compartir_revocada", userId || "", userName || "", `Acceso revocado a asesor ${targetAsesorId}`);

  return models.purchaseOrders
    .findByIdAndUpdate(
      orderId,
      {
        $pull: { sharedWith: { asesorId: targetAsesorId } },
        $push: { auditLog: entry },
      },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function updatePaymentStatus(
  id: string,
  paymentStatus: IPurchaseOrder["paymentStatus"],
  adminNotes?: string,
  userId?: string,
  userName?: string
): Promise<IPurchaseOrder | null> {
  const update: Record<string, any> = { paymentStatus };
  if (paymentStatus === "pagado") update.paidAt = new Date();
  if (adminNotes !== undefined) update.adminNotes = adminNotes;

  const entry = auditEntry(
    `pago_${paymentStatus}`,
    userId || "",
    userName || "",
    adminNotes || `Estado de pago: ${paymentStatus}`
  );

  return models.purchaseOrders
    .findByIdAndUpdate(id, { $set: update, $push: { auditLog: entry } }, { new: true })
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function attachTransferProof(
  id: string,
  proofUrl: string,
  reference?: string,
  notes?: string,
  userId?: string,
  userName?: string
): Promise<IPurchaseOrder | null> {
  const entry = auditEntry(
    "comprobante_subido",
    userId || "",
    userName || "",
    notes || "Comprobante de transferencia subido"
  );

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
        $push: { auditLog: entry },
      },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function attachPaymentLink(
  id: string,
  paymentLink: string,
  paymentId: string,
  userId?: string,
  userName?: string
): Promise<IPurchaseOrder | null> {
  const entry = auditEntry("link_pago_generado", userId || "", userName || "", "Link de pago generado");

  return models.purchaseOrders
    .findByIdAndUpdate(
      id,
      { $set: { paymentLinkUrl: paymentLink, paymentId }, $push: { auditLog: entry } },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function getOrderByViewToken(token: string): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders
    .findOne({ viewToken: token })
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function markViewTokenUsed(token: string, userId?: string, userName?: string): Promise<IPurchaseOrder | null> {
  const entry = auditEntry("cliente_visto", userId || "", userName || "Cliente", "El cliente visualizó el pedido");
  return models.purchaseOrders
    .findOneAndUpdate(
      { viewToken: token, viewTokenUsed: false },
      { $set: { viewTokenUsed: true }, $push: { auditLog: entry } },
      { new: true }
    )
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function resetViewToken(id: string): Promise<IPurchaseOrder | null> {
  const viewToken = generateViewToken();
  return models.purchaseOrders
    .findByIdAndUpdate(id, { $set: { viewToken, viewTokenUsed: false } }, { new: true })
    .populate("asesorId", "name email")
    .lean() as Promise<IPurchaseOrder | null>;
}

export async function searchClientHistory(query: string): Promise<IPurchaseOrder[]> {
  const regex = new RegExp(query, "i");
  return models.purchaseOrders
    .find({
      $or: [
        { clientName: regex },
        { clientEmail: regex },
        { clientPhone: regex },
      ],
    })
    .populate("asesorId", "name email")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean() as unknown as IPurchaseOrder[];
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
