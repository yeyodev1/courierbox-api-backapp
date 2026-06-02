import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { models } from "../models/index.js";
import { payphoneLinksService } from "../services/payphone.service.js";
import 'dotenv/config';

export async function generatePaymentLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      amount,
      amountWithoutTax,
      amountWithTax,
      tax,
      reference,
      customerEmail,
      customerName,
    } = req.body;

    if (amount == null || amountWithoutTax == null || amountWithTax == null || tax == null || !reference) {
      res.status(400).json({ error: "Missing required payment fields" });
      return;
    }

    const clientTransactionId = crypto.randomBytes(7).toString("hex");

    const { paymentLink, expiresAt } = await payphoneLinksService.createPaymentLink({
      amountCents: amount,
      amountWithoutTaxCents: amountWithoutTax,
      taxCents: tax,
      reference,
      clientTransactionId,
      expireInHours: 24,
    });

    const newPayment = await models.payments.create({
      amount,
      amountWithoutTax,
      amountWithTax,
      tax,
      reference,
      clientTransactionId,
      paymentLink,
      storeId: process.env.PAYPHONE_STORE_ID,
      status: "pending",
      customerEmail,
      customerName,
      currency: "USD",
      expiresAt,
    });

    res.status(201).json({
      message: "Payment link generated successfully",
      payment: newPayment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[payment.controller] generateLink error:", message);
    res.status(500).json({ error: "internal_error", detail: message });
  }
}

export async function getPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payments = await models.payments.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ payments });
  } catch (error) {
    console.error("[payment.controller] getPayments error:", error);
    next(error);
  }
}