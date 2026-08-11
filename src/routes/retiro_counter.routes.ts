import { Router, json } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  anular,
  comprobante,
  create,
  detail,
  disponibles,
  list,
} from "../controllers/retiro_counter.controller";

const router = Router();

// The signature arrives as a base64 PNG data URL, which outgrows the app-wide 1mb JSON limit.
router.use(json({ limit: "4mb" }));
router.use(requireAuth);

// Counter staff (bodega) sign pickups; admins audit and void them.
router.get("/", requireRole(["admin", "gerencia", "superadmin", "bodega"]), list);
// Declared before "/:id" so "disponibles" is not swallowed as an id.
router.get("/disponibles", requireRole(["admin", "gerencia", "superadmin", "bodega"]), disponibles);
router.post("/", requireRole(["admin", "gerencia", "superadmin", "bodega"]), create);
router.get("/:id", requireRole(["admin", "gerencia", "superadmin", "bodega"]), detail);
router.get("/:id/comprobante", requireRole(["admin", "gerencia", "superadmin", "bodega"]), comprobante);
router.post("/:id/anular", requireRole(["admin", "gerencia", "superadmin"]), anular);

export default router;
