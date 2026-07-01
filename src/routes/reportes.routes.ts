import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { getReporteEjecutivo } from "../controllers/reportes.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole(["admin", "gerencia", "superadmin"]));

router.get("/ejecutivo", getReporteEjecutivo);

export default router;
