import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { createProduccion, listProduccion, resumenProduccion } from "../controllers/produccion.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "asesor", "gerencia", "superadmin"]));

router.get("/", listProduccion);
router.get("/resumen", resumenProduccion);
router.post("/", createProduccion);

export default router;
