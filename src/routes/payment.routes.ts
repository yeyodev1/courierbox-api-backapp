import { Router } from "express";
import { generatePaymentLink, getPayments } from "../controllers/payment.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const paymentRouter = Router();

// Protegemos todas las rutas de pagos
paymentRouter.use(requireAuth);

paymentRouter.post("/generate", generatePaymentLink);
paymentRouter.get("/", getPayments);
