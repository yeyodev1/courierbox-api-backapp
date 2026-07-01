import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { listCaja, createCaja, resumenCaja } from "../controllers/caja.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/", listCaja);
router.get("/resumen", resumenCaja);
router.post("/", createCaja);

export default router;
