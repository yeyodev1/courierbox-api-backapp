import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { models } from "../models/index.js";
import { payphoneService } from "../services/payphone.service.js";
import { env } from "../config/env.js";

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

    const paymentLink = await payphoneService.generateLink({
      amount,
      amountWithoutTax,
      amountWithTax,
      tax,
      reference,
      clientTransactionId,
      currency: "USD",
      expireIn: 24,
    });

    const newPayment = await models.payments.create({
      amount,
      amountWithoutTax,
      amountWithTax,
      tax,
      reference,
      clientTransactionId,
      storeId: env.PAYPHONE_STORE_ID,
      paymentLink,
      status: "pending",
      customerEmail,
      customerName,
      currency: "USD"
    });

    res.status(201).json({
      message: "Payment link generated successfully",
      payment: newPayment,
    });
  } catch (error) {
    console.error("[payment.controller] generateLink error:", error);
    next(error);
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
