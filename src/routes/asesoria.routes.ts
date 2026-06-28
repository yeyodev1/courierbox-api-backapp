import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  postCalculate,
  getFeeConfigs,
  getDefaultFeeConfigController,
  createFeeConfig,
  updateFeeConfig,
  setDefaultFeeConfig,
  deleteFeeConfig,
  listOrders,
  getOrder,
  createOrder,
  patchOrderStatus,
  patchPaymentStatus,
  generateOrderPaymentLink,
  uploadOrderTransfer,
  getStats,
  postShareOrder,
  deleteShareOrder,
  getOrderByToken,
  postResetViewToken,
  searchClients,
} from "../controllers/asesoria.controller.js";

const upload = multer({ storage: multer.memoryStorage() });

export const asesoriaRouter = Router();

// ─── PUBLIC: view order by unique token (no auth) ──────────
asesoriaRouter.get("/orders/view/:token", getOrderByToken);

// ─── AUTHENTICATED ───────────────────────────────
asesoriaRouter.use(requireAuth);
asesoriaRouter.use(requireRole(["admin", "asesor"]));

// Calculator (admin + asesor)
asesoriaRouter.post("/calculate", postCalculate);

// Fee configs (read for all; write admin only)
asesoriaRouter.get("/fee-configs", getFeeConfigs);
asesoriaRouter.get("/fee-configs/default", getDefaultFeeConfigController);
asesoriaRouter.post("/fee-configs", requireRole(["admin"]), createFeeConfig);
asesoriaRouter.patch("/fee-configs/:id", requireRole(["admin"]), updateFeeConfig);
asesoriaRouter.patch("/fee-configs/:id/default", requireRole(["admin"]), setDefaultFeeConfig);
asesoriaRouter.delete("/fee-configs/:id", requireRole(["admin"]), deleteFeeConfig);

// Purchase orders (admin + asesor)
asesoriaRouter.get("/orders", listOrders);
asesoriaRouter.post("/orders", createOrder);
asesoriaRouter.get("/orders/:id", getOrder);
asesoriaRouter.patch("/orders/:id/status", requireRole(["admin"]), patchOrderStatus);
asesoriaRouter.patch("/orders/:id/payment-status", requireRole(["admin"]), patchPaymentStatus);
asesoriaRouter.post("/orders/:id/payment-link", generateOrderPaymentLink);
asesoriaRouter.post("/orders/:id/transfer", upload.single("proof"), uploadOrderTransfer);

// Sharing (owner + admin)
asesoriaRouter.post("/orders/:id/share", postShareOrder);
asesoriaRouter.delete("/orders/:id/share/:targetAsesorId", deleteShareOrder);

// View token management
asesoriaRouter.post("/orders/:id/reset-view-token", postResetViewToken);

// Client search
asesoriaRouter.get("/clientes/search", searchClients);

// Stats
asesoriaRouter.get("/stats", getStats);
