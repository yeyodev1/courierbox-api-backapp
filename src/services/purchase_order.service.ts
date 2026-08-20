import { Types } from "mongoose";
import { models } from "../models/index";
import type { IPurchaseOrder, ServiceType } from "../models/purchase_order.model";

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

function legacyReadOnly(): never {
  throw new Error("PurchaseOrder es histórico de solo lectura; use GestionCompra");
}

export async function createPurchaseOrder(_input: CreateOrderInput): Promise<IPurchaseOrder> {
  return legacyReadOnly();
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
    query[filters.includeShared ? "$or" : "asesorId"] = filters.includeShared
      ? [{ asesorId: filters.asesorId }, { "sharedWith.asesorId": filters.asesorId }]
      : filters.asesorId;
  }
  if (filters.status) query.status = filters.status;
  if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
  if (filters.serviceType) query.serviceType = filters.serviceType;
  if (filters.clientSearch) {
    const escaped = filters.clientSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clientQuery = { $or: ["clientName", "clientEmail", "clientPhone"].map((field) => ({ [field]: new RegExp(escaped, "i") })) };
    if (query.$or) {
      query.$and = [{ $or: query.$or }, clientQuery];
      delete query.$or;
    } else query.$or = clientQuery.$or;
  }
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const [orders, total] = await Promise.all([
    models.purchaseOrders.find(query).populate("asesorId", "name email").sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    models.purchaseOrders.countDocuments(query),
  ]);
  return { orders: orders as unknown as IPurchaseOrder[], total };
}

export async function getPurchaseOrderById(id: string): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders.findById(id).populate("asesorId", "name email").lean() as Promise<IPurchaseOrder | null>;
}

export async function updateOrderStatus(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function updatePaymentStatus(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function attachTransferProof(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function attachPaymentLink(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function shareOrder(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function unshareOrder(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function markViewTokenUsed(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }
export async function resetViewToken(..._args: unknown[]): Promise<IPurchaseOrder | null> { return legacyReadOnly(); }

export async function getOrderByViewToken(token: string): Promise<IPurchaseOrder | null> {
  return models.purchaseOrders.findOne({ viewToken: token }).populate("asesorId", "name email").lean() as Promise<IPurchaseOrder | null>;
}

export async function searchClientHistory(query: string): Promise<IPurchaseOrder[]> {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  return models.purchaseOrders.find({ $or: [{ clientName: regex }, { clientEmail: regex }, { clientPhone: regex }] })
    .populate("asesorId", "name email").sort({ createdAt: -1 }).limit(50).lean() as unknown as IPurchaseOrder[];
}

export async function getAsesorStats(asesorId?: string): Promise<{
  totalOrders: number;
  pendingPayment: number;
  totalSold: number;
  recentOrders: IPurchaseOrder[];
}> {
  const query: Record<string, any> = asesorId ? { asesorId } : {};
  // aggregate() no castea el string a ObjectId como find()/countDocuments(); sin
  // esto el $match no coincide y totalSold sale en 0 al filtrar por asesor.
  const aggQuery: Record<string, any> =
    asesorId && Types.ObjectId.isValid(asesorId) ? { asesorId: new Types.ObjectId(asesorId) } : {};
  const [totalOrders, pendingPayment, totalSoldAgg, recentOrders] = await Promise.all([
    models.purchaseOrders.countDocuments(query),
    models.purchaseOrders.countDocuments({ ...query, paymentStatus: { $in: ["pendiente", "verificando"] } }),
    models.purchaseOrders.aggregate([{ $match: { ...aggQuery, paymentStatus: "pagado" } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
    models.purchaseOrders.find(query).populate("asesorId", "name email").sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  return { totalOrders, pendingPayment, totalSold: Number(totalSoldAgg[0]?.total || 0), recentOrders: recentOrders as unknown as IPurchaseOrder[] };
}
