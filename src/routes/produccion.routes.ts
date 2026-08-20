import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { createProduccion, listProduccion, resumenProduccion, comparativoMensual } from "../controllers/produccion.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/", listProduccion);
router.get("/resumen", resumenProduccion);
router.get("/comparativo", comparativoMensual);
router.post("/", createProduccion);

export default router;
