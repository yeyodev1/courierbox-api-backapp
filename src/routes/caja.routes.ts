import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { listCaja, createCaja, resumenCaja } from "../controllers/caja.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/", listCaja);
router.get("/resumen", resumenCaja);
router.post("/", createCaja);

export default router;
