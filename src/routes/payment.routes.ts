import { Router } from "express";
import { generatePaymentLink, getPayments, deletePaymentLink } from "../controllers/payment.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const paymentRouter = Router();

// Protegemos todas las rutas de pagos
paymentRouter.use(requireAuth);

paymentRouter.post("/generate", generatePaymentLink);
paymentRouter.get("/", getPayments);
paymentRouter.delete("/:id", deletePaymentLink);
