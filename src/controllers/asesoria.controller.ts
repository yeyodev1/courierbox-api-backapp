import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { models } from "../models/index";
import { calculateFee } from "../services/fee.service";
import { payphoneLinksService } from "../services/payphone.service";
import { uploadTransferProof } from "../services/upload.service";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
  updateOrderStatus,
  updatePaymentStatus,
  attachTransferProof,
  attachPaymentLink,
  getAsesorStats,
  shareOrder,
  unshareOrder,
  getOrderByViewToken,
  resetViewToken,
  searchClientHistory,
} from "../services/purchase_order.service";
import type { IFeeConfig } from "../models/fee_config.model";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function isAdmin(req: Request): boolean {
  return getUser(req)?.role === "admin";
}

function isPrivileged(req: Request): boolean {
  return ["admin", "gerencia", "superadmin"].includes(getUser(req)?.role ?? "");
}

function getObjectIdString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id?: unknown })._id ?? "");
  }
  return String(value);
}

function canAccessOrder(req: Request, order: any): boolean {
  const user = getUser(req);
  if (!user) return false;
  if (isPrivileged(req)) return true;

  const ownerId = getObjectIdString(order?.asesorId);
  if (ownerId === user.userId) return true;

  const sharedWith = Array.isArray(order?.sharedWith) ? order.sharedWith : [];
  return sharedWith.some((entry: { asesorId?: unknown }) => getObjectIdString(entry?.asesorId) === user.userId);
}

function asesorFilter(req: Request): { asesorId?: string } {
  const user = getUser(req);
  if (!user) return {};
  if (isPrivileged(req)) return {};
  return { asesorId: user.userId };
}

// ─── CALCULATOR ───────────────────────────────────────────────

export async function postCalculate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productValue, shippingValue, configId } = req.body;
    if (typeof productValue !== "number" || productValue < 0) {
      res.status(400).json({ error: "productValue must be a positive number" });
      return;
    }
    const result = await calculateFee({
      productValue,
      shippingValue: typeof shippingValue === "number" ? shippingValue : 0,
      configId,
    });
    res.status(200).json({ result });
  } catch (error) {
    next(error);
  }
}

// ─── FEE CONFIG ───────────────────────────────────────────────

export async function getFeeConfigs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const configs = await models.feeConfigs.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({ configs });
  } catch (error) {
    next(error);
  }
}

export async function getDefaultFeeConfigController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const config = await models.feeConfigs.findOne({ isDefault: true }).lean();
    res.status(200).json({ config });
  } catch (error) {
    next(error);
  }
}

/** Renders a rule as one line, so the audit trail reads like "10% -> 8%". */
function describirRegla(c: Partial<IFeeConfig> | undefined): string {
  if (!c) return "—";
  const money = (n?: number) => `$${(Number(n) || 0).toFixed(2)}`;
  switch (c.ruleType) {
    case "fixed":
      return money(c.fixedAmount);
    case "percentage":
      return `${Number(c.percentage) || 0}%`;
    case "fixed_plus_percentage":
      return `${money(c.fixedAmount)} + ${Number(c.percentage) || 0}%`;
    case "tiered":
      return `${c.tiers?.length ?? 0} rango(s)`;
    default:
      return "—";
  }
}

function autorDe(req: Request): { userId?: any; userName: string } {
  const u = (req as any).user;
  return { userId: u?.userId ?? u?.id, userName: u?.name || u?.email || "desconocido" };
}

export async function createFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, ruleType, fixedAmount, percentage, minAmount, maxAmount, tiers, currency } = req.body;
    if (!name || !ruleType) {
      res.status(400).json({ error: "name and ruleType are required" });
      return;
    }

    const configData: Partial<IFeeConfig> = {
      name,
      ruleType,
      fixedAmount: fixedAmount ?? 0,
      percentage: percentage ?? 0,
      minAmount: minAmount ?? 0,
      maxAmount: maxAmount ?? 0,
      tiers: tiers || [],
      currency: currency || "USD",
      isDefault: false,
    };

    // Si es la primera configuración, marcarla como default.
    const count = await models.feeConfigs.countDocuments();
    if (count === 0) configData.isDefault = true;

    const autor = autorDe(req);
    configData.historial = [
      {
        fecha: new Date(),
        userId: autor.userId,
        userName: autor.userName,
        accion: "creada",
        resumen: `Creada como ${describirRegla(configData)}`,
      },
    ] as any;

    const config = await models.feeConfigs.create(configData);
    res.status(201).json({ config });
  } catch (error) {
    next(error);
  }
}

export async function updateFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const update: Partial<IFeeConfig> = { ...req.body };
    delete (update as any)._id;
    delete (update as any).historial;

    // Snapshot the rule before overwriting it, so the change is reconstructable.
    const previo = await models.feeConfigs.findById(id).lean();
    if (!previo) {
      res.status(404).json({ error: "Fee config not found" });
      return;
    }

    const autor = autorDe(req);
    const anterior = {
      ruleType: previo.ruleType,
      fixedAmount: previo.fixedAmount,
      percentage: previo.percentage,
      minAmount: previo.minAmount,
      maxAmount: previo.maxAmount,
      tiers: previo.tiers,
      enabled: previo.enabled,
    };
    const despues = { ...anterior, ...update } as Partial<IFeeConfig>;

    const config = await models.feeConfigs
      .findByIdAndUpdate(
        id,
        {
          $set: update,
          $push: {
            historial: {
              fecha: new Date(),
              userId: autor.userId,
              userName: autor.userName,
              accion: "editada",
              anterior,
              resumen: `${describirRegla(previo)} -> ${describirRegla(despues)}`,
            },
          },
        },
        { new: true }
      )
      .lean();
    if (!config) {
      res.status(404).json({ error: "Fee config not found" });
      return;
    }
    res.status(200).json({ config });
  } catch (error) {
    next(error);
  }
}

export async function setDefaultFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const autor = autorDe(req);
    await models.feeConfigs.updateMany({}, { $set: { isDefault: false } });
    const config = await models.feeConfigs
      .findByIdAndUpdate(
        id,
        {
          $set: { isDefault: true },
          // Which tariff is the default one decides what every public quote
          // charges, so promoting one is itself an auditable event.
          $push: {
            historial: {
              fecha: new Date(),
              userId: autor.userId,
              userName: autor.userName,
              accion: "predeterminada",
              resumen: "Marcada como tarifa predeterminada",
            },
          },
        },
        { new: true }
      )
      .lean();
    if (!config) {
      res.status(404).json({ error: "Fee config not found" });
      return;
    }
    res.status(200).json({ config });
  } catch (error) {
    next(error);
  }
}

export async function deleteFeeConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const config = await models.feeConfigs.findByIdAndDelete(id).lean();
    if (!config) {
      res.status(404).json({ error: "Fee config not found" });
      return;
    }
    res.status(200).json({ message: "Fee config deleted" });
  } catch (error) {
    next(error);
  }
}

// ─── PURCHASE ORDERS ──────────────────────────────────────────

export async function listOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, paymentStatus, limit, offset, includeShared } = req.query;
    const filters = {
      ...asesorFilter(req),
      status: status as string | undefined,
      paymentStatus: paymentStatus as string | undefined,
      includeShared: includeShared === "true",
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    };
    const data = await listPurchaseOrders(filters);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const order = await getPurchaseOrderById(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!canAccessOrder(req, order)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.status(200).json({ order });
  } catch (error) {
    next(error);
  }
}

export async function createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const {
      clientName,
      clientPhone,
      clientEmail,
      storeName,
      productUrl,
      description,
      productValue,
      shippingValue,
      weightLb,
      trackingUsa,
      notes,
      configId,
      manualFeeAmount,
      manualTotalAmount,
      serviceType,
    } = req.body;

    if (!clientName || !description || typeof productValue !== "number") {
      res.status(400).json({ error: "clientName, description and productValue are required" });
      return;
    }

    const order = await createPurchaseOrder({
      asesorId: user.userId,
      clientName,
      clientPhone,
      clientEmail,
      storeName: storeName || "Amazon",
      productUrl,
      description,
      productValue,
      shippingValue: shippingValue || 0,
      weightLb,
      trackingUsa,
      notes,
      configId,
      manualFeeAmount: typeof manualFeeAmount === "number" ? manualFeeAmount : undefined,
      manualTotalAmount: typeof manualTotalAmount === "number" ? manualTotalAmount : undefined,
      serviceType,
    });

    res.status(201).json({ order });
  } catch (error) {
    next(error);
  }
}

export async function patchOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const { status, adminNotes } = req.body;
    if (!status) {
      res.status(400).json({ error: "status is required" });
      return;
    }
    const user = getUser(req);
    const order = await updateOrderStatus(id, status, adminNotes, user?.userId, user?.email);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.status(200).json({ order });
  } catch (error) {
    next(error);
  }
}

export async function patchPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const { paymentStatus, adminNotes } = req.body;
    if (!paymentStatus) {
      res.status(400).json({ error: "paymentStatus is required" });
      return;
    }
    const user = getUser(req);
    const order = await updatePaymentStatus(id, paymentStatus, adminNotes, user?.userId, user?.email);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.status(200).json({ order });
  } catch (error) {
    next(error);
  }
}

// ─── PAYMENT LINK ─────────────────────────────────────────────

export async function generateOrderPaymentLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = String(req.params.id);
    const order = await getPurchaseOrderById(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!canAccessOrder(req, order)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const totalCents = Math.round(order.totalAmount * 100);
    const taxCents = 0; // Servicio de gestión sin IVA por defecto; ajustar si aplica.
    const amountWithoutTaxCents = totalCents;
    const clientTransactionId = crypto.randomBytes(7).toString("hex");

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents: totalCents,
      amountWithoutTaxCents,
      taxCents,
      reference: `OC-${order._id.toString().slice(-6)}`,
      clientTransactionId,
      expireInHours: 72,
    });

    const payment = await models.payments.create({
      amount: totalCents,
      amountWithoutTax: amountWithoutTaxCents,
      amountWithTax: 0,
      tax: taxCents,
      currency: "USD",
      reference: `OC-${order._id.toString().slice(-6)}`,
      clientTransactionId,
      paymentLink,
      storeId: process.env.PAYPHONE_STORE_ID,
      status: "pending",
      customerEmail: order.clientEmail,
      customerName: order.clientName,
      expiresAt,
      createdBy: getUser(req)?.userId,
    });

    const updatedOrder = await attachPaymentLink(id, paymentLink, payment._id.toString());

    res.status(201).json({ payment, order: updatedOrder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[asesoria] generateOrderPaymentLink error:", message);
    res.status(500).json({ error: "internal_error", detail: message });
  }
}

// ─── TRANSFER UPLOAD ──────────────────────────────────────────

export async function uploadOrderTransfer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const { reference, notes } = req.body;

    const order = await getPurchaseOrderById(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!canAccessOrder(req, order)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!req.file && !req.body.proofBase64) {
      res.status(400).json({ error: "proof file or proofBase64 is required" });
      return;
    }

    let buffer: Buffer;
    if (req.file) {
      buffer = req.file.buffer;
    } else {
      const base64 = req.body.proofBase64.replace(/^data:image\/\w+;base64,/, "");
      buffer = Buffer.from(base64, "base64");
    }

    const uploadResult = await uploadTransferProof(buffer);
    if (!uploadResult.url) {
      res.status(500).json({ error: "Upload failed or Cloudinary not configured" });
      return;
    }

    const updatedOrder = await attachTransferProof(id, uploadResult.url, reference, notes);
    res.status(200).json({ order: updatedOrder, upload: uploadResult });
  } catch (error) {
    next(error);
  }
}

// ─── STATS ────────────────────────────────────────────────────

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filter = asesorFilter(req);
    const stats = await getAsesorStats(filter.asesorId);
    res.status(200).json({ stats });
  } catch (error) {
    next(error);
  }
}

// ─── SHARING ──────────────────────────────────────────

export async function postShareOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = String(req.params.id);
    const { targetAsesorId } = req.body;
    if (!targetAsesorId) {
      res.status(400).json({ error: "targetAsesorId is required" });
      return;
    }

    const order = await getPurchaseOrderById(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const isOwner = order.asesorId.toString() === user.userId;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Only the owner or admin can share this order" });
      return;
    }

    const updated = await shareOrder(id, targetAsesorId, user.userId, user.email);
    res.status(200).json({ order: updated });
  } catch (error) {
    next(error);
  }
}

export async function deleteShareOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = String(req.params.id);
    const targetAsesorId = String(req.params.targetAsesorId);

    const order = await getPurchaseOrderById(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const isOwner = order.asesorId.toString() === user.userId;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: "Only the owner or admin can unshare this order" });
      return;
    }

    const updated = await unshareOrder(id, targetAsesorId, user.userId, user.email);
    res.status(200).json({ order: updated });
  } catch (error) {
    next(error);
  }
}

// ─── VIEW TOKEN (public) ─────────────────────────────

export async function getOrderByToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = String(req.params.token);
    const order = await getOrderByViewToken(token);
    if (!order) {
      res.status(404).json({ error: "Order not found or invalid token" });
      return;
    }

    const wasAlreadyUsed = order.viewTokenUsed;

    res.status(200).json({
      order: {
        _id: order._id,
        clientName: order.clientName,
        storeName: order.storeName,
        description: order.description,
        productValue: order.productValue,
        shippingValue: order.shippingValue,
        totalAmount: order.totalAmount,
        currency: order.currency,
        serviceType: order.serviceType,
        status: order.status,
        trackingUsa: order.trackingUsa,
        auditLog: order.auditLog,
        createdAt: order.createdAt,
        wasAlreadyUsed,
      },
    });
  } catch (error) {
    next(error);
  }
}

export function legacyOrderReadOnly(_req: Request, res: Response): void {
  res.status(410).json({
    error: "legacy_read_only",
    message: "Esta orden es histórica y no puede modificarse. Las operaciones nuevas usan Gestión de Compra.",
  });
}

// ─── RESET VIEW TOKEN ────────────────────────────────

export async function postResetViewToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    const order = await resetViewToken(id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.status(200).json({ order });
  } catch (error) {
    next(error);
  }
}

// ─── CLIENT SEARCH ────────────────────────────────────

export async function searchClients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      res.status(400).json({ error: "q query param is required" });
      return;
    }
    const orders = await searchClientHistory(q);
    res.status(200).json({ orders });
  } catch (error) {
    next(error);
  }
}
