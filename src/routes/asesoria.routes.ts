import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
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
  getStats,
  getOrderByToken,
  searchClients,
  legacyOrderReadOnly,
} from "../controllers/asesoria.controller";

export const asesoriaRouter = Router();

// ─── PUBLIC: view order by unique token (no auth) ──────────
asesoriaRouter.get("/orders/view/:token", getOrderByToken);

// ─── AUTHENTICATED ───────────────────────────────
asesoriaRouter.use(requireAuth);
asesoriaRouter.use(requireRole(["admin", "asesor", "gerencia", "superadmin"]));

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
asesoriaRouter.post("/orders", legacyOrderReadOnly);
asesoriaRouter.get("/orders/:id", getOrder);
asesoriaRouter.patch("/orders/:id/status", legacyOrderReadOnly);
asesoriaRouter.patch("/orders/:id/payment-status", legacyOrderReadOnly);
asesoriaRouter.post("/orders/:id/payment-link", legacyOrderReadOnly);
asesoriaRouter.post("/orders/:id/transfer", legacyOrderReadOnly);

// Sharing (owner + admin)
asesoriaRouter.post("/orders/:id/share", legacyOrderReadOnly);
asesoriaRouter.delete("/orders/:id/share/:targetAsesorId", legacyOrderReadOnly);

// View token management
asesoriaRouter.post("/orders/:id/reset-view-token", legacyOrderReadOnly);

// Client search
asesoriaRouter.get("/clientes/search", searchClients);

// Stats
asesoriaRouter.get("/stats", getStats);
