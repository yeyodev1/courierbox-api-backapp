import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { models } from "../models/index.js";
import { calculateFee } from "../services/fee.service.js";
import { payphoneLinksService } from "../services/payphone.service.js";
import { uploadTransferProof } from "../services/upload.service.js";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
  updateOrderStatus,
  updatePaymentStatus,
  attachTransferProof,
  attachPaymentLink,
  getAsesorStats,
} from "../services/purchase_order.service.js";
import type { IFeeConfig } from "../models/fee_config.model.js";

function getUser(req: Request) {
  return req.user as { userId: string; email: string; role: string } | undefined;
}

function isAdmin(req: Request): boolean {
  return getUser(req)?.role === "admin";
}

function asesorFilter(req: Request): { asesorId?: string } {
  const user = getUser(req);
  if (!user) return {};
  if (user.role === "admin") return {};
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

    const config = await models.feeConfigs.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
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
    await models.feeConfigs.updateMany({}, { $set: { isDefault: false } });
    const config = await models.feeConfigs.findByIdAndUpdate(id, { $set: { isDefault: true } }, { new: true }).lean();
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
    const { status, paymentStatus, limit, offset } = req.query;
    const filters = {
      ...asesorFilter(req),
      status: status as string | undefined,
      paymentStatus: paymentStatus as string | undefined,
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
    if (!isAdmin(req) && order.asesorId.toString() !== getUser(req)?.userId) {
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
    const order = await updateOrderStatus(id, status, adminNotes);
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
    const order = await updatePaymentStatus(id, paymentStatus, adminNotes);
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
    if (!isAdmin(req) && order.asesorId.toString() !== getUser(req)?.userId) {
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
    if (!isAdmin(req) && order.asesorId.toString() !== getUser(req)?.userId) {
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
